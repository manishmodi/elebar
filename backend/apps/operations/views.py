from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ActivityLog, log_activity
from apps.authz.permissions import SectionPermission
from apps.authz.sections import Section
from apps.common.pagination import AdminPageNumberPagination
from apps.fleet.models import Vehicle
from apps.payroll.engine import recompute_if_locked
from apps.riders.models import Rider

from . import dashboards
from .handovers import HandoverError, reject_handover, verify_handover
from .models import Attendance, CashCollection, DailyLog, FleetHandover
from .serializers import (
    AttendanceSerializer,
    CashCollectionSerializer,
    DailyLogSerializer,
    FleetHandoverSerializer,
)

CASH_EDIT_WINDOW = timedelta(minutes=5)


def _date_range_filter(qs, params, field="english_date"):
    if date_from := params.get("date_from"):
        qs = qs.filter(**{f"{field}__gte": date_from})
    if date_to := params.get("date_to"):
        qs = qs.filter(**{f"{field}__lte": date_to})
    return qs


class DailyLogViewSet(viewsets.ModelViewSet):
    section = Section.DAILY_LOGS
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = DailyLogSerializer
    queryset = DailyLog.objects.select_related("rider", "vehicle").order_by("-english_date")

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if rider := params.get("rider"):
            qs = qs.filter(rider__uuid=rider)
        if vehicle := params.get("vehicle"):
            qs = qs.filter(vehicle__uuid=vehicle)
        return _date_range_filter(qs, params)

    def perform_create(self, serializer):
        log = serializer.save()
        log_activity(self.request.user, ActivityLog.Action.CREATED, Section.DAILY_LOGS,
                     f"Daily log for {log.rider.full_name} on {log.english_date}")

    def perform_update(self, serializer):
        # A manual edit confirms the row; if the day's pay was already locked,
        # recompute it with the corrected inputs.
        log = serializer.save(is_draft=False)
        recompute_if_locked(log.rider, log.english_date, actor=self.request.user)
        log_activity(self.request.user, ActivityLog.Action.UPDATED, Section.DAILY_LOGS,
                     f"Daily log for {log.rider.full_name} on {log.english_date}")


class AttendanceViewSet(viewsets.ModelViewSet):
    section = Section.ATTENDANCE
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = AttendanceSerializer
    queryset = Attendance.objects.select_related("rider", "vehicle").order_by("-date")

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if rider := params.get("rider"):
            qs = qs.filter(rider__uuid=rider)
        if vehicle := params.get("vehicle"):
            qs = qs.filter(vehicle__uuid=vehicle)
        return _date_range_filter(qs, params, field="date")

    def perform_update(self, serializer):
        instance = self.get_object()
        # Guard-log fields freeze once a verified check-in closed the day —
        # only admins may correct them, and corrections recompute pay.
        if instance.day_closed and not self.request.user.is_admin:
            changed = [
                f for f in Attendance.GUARD_LOCKED_FIELDS
                if f in serializer.validated_data
                and serializer.validated_data[f] != getattr(instance, f)
            ]
            if changed:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied(
                    f"Day is closed; only admins can edit guard-log fields ({', '.join(changed)})."
                )
        row = serializer.save()
        recompute_if_locked(row.rider, row.date, actor=self.request.user)
        log_activity(self.request.user, ActivityLog.Action.UPDATED, Section.ATTENDANCE,
                     f"Attendance for {row.rider.full_name} on {row.date}")


class CashCollectionViewSet(viewsets.ModelViewSet):
    section = Section.CASH_COLLECTION
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = CashCollectionSerializer
    queryset = CashCollection.objects.select_related("rider").order_by("-english_date")

    @property
    def section_action_overrides(self):
        # Approval state changes are edits, not creates — POST here must not be
        # reachable with only cash-collection:create.
        if getattr(self, "action", None) in ("approve", "disapprove"):
            return {"POST": "edit"}
        return {}

    def get_queryset(self):
        return _date_range_filter(super().get_queryset(), self.request.query_params)

    def list(self, request, *args, **kwargs):
        """Enrich each row with the expected cash from the day's log:
        expected = cash_given_by_driver - daily_allowance."""
        response = super().list(request, *args, **kwargs)
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        keys = {(row["rider"], str(row["english_date"])) for row in rows}
        logs = {
            (str(l.rider.uuid), str(l.english_date)): l
            for l in DailyLog.objects.select_related("rider").filter(
                english_date__in=[k[1] for k in keys]
            )
        }
        for row in rows:
            log = logs.get((row["rider"], str(row["english_date"])))
            expected = None
            if log and log.cash_given_by_driver is not None:
                expected = (log.cash_given_by_driver or 0) - (log.daily_allowance or 0)
            row["cash_expected"] = expected
            row["cash_variance"] = (
                float(expected) - float(row["grand_total"]) if expected is not None else None
            )
        return response

    def perform_create(self, serializer):
        collection = serializer.save(
            submitted_by=self.request.user, submitted_by_name=self.request.user.full_name
        )
        collection.compute_totals()
        collection.save()
        log_activity(self.request.user, ActivityLog.Action.CREATED, Section.CASH_COLLECTION,
                     f"Cash collection for {collection.rider.full_name} on {collection.english_date}")

    def perform_update(self, serializer):
        instance = self.get_object()
        if not self.request.user.is_admin:
            if timezone.now() - instance.submitted_at > CASH_EDIT_WINDOW:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("The 5-minute edit window has passed; ask an admin.")
        collection = serializer.save()
        collection.compute_totals()
        collection.save()

    @action(detail=True, methods=["post"])
    def approve(self, request, uuid=None):
        collection = self.get_object()
        collection.approval_status = CashCollection.ApprovalStatus.APPROVED
        collection.approved_by = request.user
        collection.approved_by_name = request.user.full_name
        collection.approved_at = timezone.now()
        collection.approval_note = request.data.get("note", "")
        collection.save()
        # Finance approval is the pay-lock trigger for fleet pilots.
        from apps.payroll.engine import lock_day
        lock_day(collection.rider, collection.english_date, actor=request.user)
        log_activity(request.user, ActivityLog.Action.UPDATED, Section.CASH_COLLECTION,
                     f"Approved cash collection {collection.uuid}")
        return Response(CashCollectionSerializer(collection).data)

    @action(detail=True, methods=["post"])
    def disapprove(self, request, uuid=None):
        collection = self.get_object()
        collection.approval_status = CashCollection.ApprovalStatus.DISAPPROVED
        collection.approved_by = request.user
        collection.approved_by_name = request.user.full_name
        collection.approved_at = timezone.now()
        collection.approval_note = request.data.get("note", "")
        collection.save()
        # Approval was the pay-lock trigger — withdrawing it must also take the
        # day's pay record out of salary runs (amounts kept for audit).
        from apps.payroll.models import PayRecord
        PayRecord.objects.filter(
            rider=collection.rider,
            english_date=collection.english_date,
            status=PayRecord.Status.LOCKED,
        ).update(status=PayRecord.Status.COMPUTED, locked_at=None)
        log_activity(request.user, ActivityLog.Action.UPDATED, Section.CASH_COLLECTION,
                     f"Disapproved cash collection {collection.uuid}")
        return Response(CashCollectionSerializer(collection).data)


class PendingHandoversView(APIView):
    """Guard console queue (polled by the frontend)."""

    section = Section.ATTENDANCE
    permission_classes = [SectionPermission]

    def get(self, request):
        rows = (
            FleetHandover.objects.filter(status=FleetHandover.Status.PENDING)
            .select_related("rider", "vehicle")
            .order_by("submitted_at")
        )
        return Response(FleetHandoverSerializer(rows, many=True).data)


class HandoverVerifyView(APIView):
    section = Section.ATTENDANCE
    permission_classes = [SectionPermission]
    section_action_overrides = {"POST": "edit"}

    def post(self, request, uuid):
        handover = get_object_or_404(FleetHandover, uuid=uuid)
        try:
            handover = verify_handover(handover, request.user,
                                       corrections=request.data.get("corrections"))
        except HandoverError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        log_activity(request.user, ActivityLog.Action.UPDATED, Section.ATTENDANCE,
                     f"Verified {handover.kind} handover for {handover.rider.full_name}")
        return Response(FleetHandoverSerializer(handover).data)


class HandoverRejectView(APIView):
    section = Section.ATTENDANCE
    permission_classes = [SectionPermission]
    section_action_overrides = {"POST": "edit"}

    def post(self, request, uuid):
        handover = get_object_or_404(FleetHandover, uuid=uuid)
        reason = request.data.get("reason", "")
        if not reason:
            return Response({"detail": "A reject reason is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            handover = reject_handover(handover, request.user, reason)
        except HandoverError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(FleetHandoverSerializer(handover).data)


# --- Dashboards / performance ----------------------------------------------

class DashboardSummaryView(APIView):
    section = Section.DASHBOARD
    permission_classes = [SectionPermission]

    def get(self, request):
        return Response(dashboards.dashboard_summary())


class FleetStatsView(APIView):
    section = Section.DASHBOARD
    permission_classes = [SectionPermission]

    def get(self, request):
        return Response(dashboards.fleet_stats(
            request.query_params.get("date_from"), request.query_params.get("date_to")
        ))


class RiderDashboardView(APIView):
    section = Section.DASHBOARD
    permission_classes = [SectionPermission]

    def get(self, request, uuid):
        rider = get_object_or_404(Rider, uuid=uuid)
        return Response(dashboards.rider_dashboard(rider))


class VehicleDashboardView(APIView):
    section = Section.DASHBOARD
    permission_classes = [SectionPermission]

    def get(self, request, uuid):
        vehicle = get_object_or_404(Vehicle, uuid=uuid)
        return Response(dashboards.vehicle_dashboard(vehicle))


class PerformanceView(APIView):
    section = Section.PERFORMANCE
    permission_classes = [SectionPermission]

    def get(self, request):
        return Response(dashboards.performance_report(
            request.query_params.get("date_from"), request.query_params.get("date_to")
        ))


class RiderPerformanceView(APIView):
    section = Section.PERFORMANCE
    permission_classes = [SectionPermission]

    def get(self, request, uuid):
        rider = get_object_or_404(Rider, uuid=uuid)
        return Response(dashboards.rider_performance_detail(
            rider, request.query_params.get("date_from"), request.query_params.get("date_to")
        ))
