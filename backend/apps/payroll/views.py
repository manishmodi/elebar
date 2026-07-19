import csv
from datetime import date

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ActivityLog, log_activity
from apps.authz.permissions import IsAdmin, SectionPermission
from apps.authz.sections import Section
from apps.common.pagination import AdminPageNumberPagination
from apps.riders.models import Rider

from . import salary as salary_service
from .engine import DEFAULT_PARAMS
from .models import Expense, ExpenseCategory, PayConfig, PayRecord, SalaryAdvance, SalaryPayment
from .serializers import (
    ExpenseCategorySerializer,
    ExpenseSerializer,
    PayConfigSerializer,
    SalaryAdvanceSerializer,
    SalaryPaymentSerializer,
)


def _parse_date(value, name):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a YYYY-MM-DD date.")


class SalaryAdvanceViewSet(viewsets.ModelViewSet):
    section = Section.SALARY
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = SalaryAdvanceSerializer
    queryset = SalaryAdvance.objects.select_related("rider").order_by("-date")
    http_method_names = ["get", "post", "delete", "head", "options"]

    def destroy(self, request, *args, **kwargs):
        advance = self.get_object()
        if advance.applied_at is not None:
            return Response(
                {"detail": "This advance was applied to a salary payment and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class SalaryCalculateView(APIView):
    section = Section.SALARY
    permission_classes = [SectionPermission]

    def get(self, request):
        try:
            period_from = _parse_date(request.query_params.get("date_from"), "date_from")
            period_to = _parse_date(request.query_params.get("date_to"), "date_to")
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(salary_service.calculate_period(period_from, period_to))


class SalaryProcessView(APIView):
    """POST {period_from, period_to, riders: [{rider, salary_processed?, notes?}], force?}"""

    section = Section.SALARY
    permission_classes = [SectionPermission]

    def post(self, request):
        try:
            period_from = _parse_date(request.data.get("period_from"), "period_from")
            period_to = _parse_date(request.data.get("period_to"), "period_to")
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        force = bool(request.data.get("force"))
        rows = request.data.get("riders") or []
        if not rows:
            return Response({"detail": "riders is required."}, status=status.HTTP_400_BAD_REQUEST)

        results, errors = [], []
        for row in rows:
            rider = Rider.objects.filter(uuid=row.get("rider")).first()
            if rider is None:
                errors.append({"rider": row.get("rider"), "detail": "Unknown rider."})
                continue
            try:
                payment = salary_service.process_payment(
                    rider=rider,
                    period_from=period_from,
                    period_to=period_to,
                    processed_by=request.user.full_name,
                    salary_processed=row.get("salary_processed"),
                    notes=row.get("notes", ""),
                    force=force,
                )
            except ValueError as exc:
                errors.append({"rider": str(rider.uuid), "detail": str(exc)})
                continue
            results.append(SalaryPaymentSerializer(payment).data)

        log_activity(request.user, ActivityLog.Action.CREATED, Section.SALARY,
                     f"Processed salary for {len(results)} rider(s), period {period_from}..{period_to}")
        code = status.HTTP_207_MULTI_STATUS if errors else status.HTTP_201_CREATED
        return Response({"processed": results, "errors": errors}, status=code)


class SalaryHistoryView(APIView):
    section = Section.SALARY
    permission_classes = [SectionPermission]

    def get(self, request):
        qs = SalaryPayment.objects.select_related("rider").order_by("-processed_at")[:500]
        return Response(SalaryPaymentSerializer(qs, many=True).data)


class SalaryPaymentVoidView(APIView):
    section = Section.SALARY
    permission_classes = [SectionPermission]

    def delete(self, request, uuid):
        payment = get_object_or_404(SalaryPayment, uuid=uuid)
        log_activity(request.user, ActivityLog.Action.DELETED, Section.SALARY,
                     f"Voided salary payment {payment.uuid} for {payment.rider.full_name}")
        salary_service.void_payment(payment)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PayConfigView(APIView):
    section = Section.SALARY
    permission_classes = [SectionPermission]
    section_action_overrides = {"POST": "edit"}

    def get(self, request):
        rows = PayConfig.objects.order_by("parameter", "-effective_from")
        return Response({
            "rows": PayConfigSerializer(rows, many=True).data,
            "defaults": DEFAULT_PARAMS,
        })

    def post(self, request):
        serializer = PayConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if PayConfig.objects.filter(
            parameter=serializer.validated_data["parameter"],
            effective_from=serializer.validated_data["effective_from"],
        ).exists():
            return Response(
                {"detail": "A value for this parameter and effective date already exists."},
                status=status.HTTP_409_CONFLICT,
            )
        row = serializer.save()
        log_activity(request.user, ActivityLog.Action.CREATED, Section.SALARY,
                     f"Pay config {row.parameter}={row.value} effective {row.effective_from}")
        return Response(PayConfigSerializer(row).data, status=status.HTTP_201_CREATED)


class PayRecordsCsvView(APIView):
    """Day-by-day Variable Pay Engine audit export."""

    section = Section.SALARY
    permission_classes = [SectionPermission]

    def get(self, request):
        qs = PayRecord.objects.select_related("rider").order_by("rider__full_name", "english_date")
        if rider := request.query_params.get("rider"):
            qs = qs.filter(rider__uuid=rider)
        if date_from := request.query_params.get("date_from"):
            qs = qs.filter(english_date__gte=date_from)
        if date_to := request.query_params.get("date_to"):
            qs = qs.filter(english_date__lte=date_to)

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="pay-records.csv"'
        writer = csv.writer(response)
        writer.writerow(["rider", "date", "base", "commission", "prize", "growth",
                         "daily_pay", "status", "locked_at"])
        for r in qs.iterator():
            writer.writerow([r.rider.full_name, r.english_date, r.base, r.commission,
                             r.prize, r.growth, r.daily_pay, r.status, r.locked_at])
        return response


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    """Reads need expenses:view; category management is admin-only."""

    section = Section.EXPENSES
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = ExpenseCategorySerializer
    queryset = ExpenseCategory.objects.order_by("name")

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [SectionPermission()]
        return [IsAdmin()]


class ExpenseViewSet(viewsets.ModelViewSet):
    section = Section.EXPENSES
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = ExpenseSerializer
    queryset = Expense.objects.select_related("category", "rider", "vehicle").order_by("-date")

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if category := params.get("category"):
            qs = qs.filter(category__uuid=category)
        if date_from := params.get("date_from"):
            qs = qs.filter(date__gte=date_from)
        if date_to := params.get("date_to"):
            qs = qs.filter(date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        expense = serializer.save(created_by=self.request.user.full_name)
        log_activity(self.request.user, ActivityLog.Action.CREATED, Section.EXPENSES,
                     f"Expense {expense.amount} ({expense.category.name})")
