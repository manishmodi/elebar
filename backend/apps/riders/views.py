from django.db.models import ProtectedError, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import ActivityLog, log_activity
from apps.authz.permissions import SectionPermission
from apps.authz.sections import Section
from apps.common.pagination import AdminPageNumberPagination

from .models import Rider
from .serializers import RiderListSerializer, RiderSerializer
from .services import rider_stats


class RiderViewSet(viewsets.ModelViewSet):
    section = Section.RIDERS
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    queryset = Rider.objects.all().order_by("full_name")

    def get_serializer_class(self):
        return RiderListSerializer if self.action == "list" else RiderSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action != "list":
            return qs
        if rider_status := self.request.query_params.get("status"):
            qs = qs.filter(status=rider_status)
        if search := self.request.query_params.get("search"):
            qs = qs.filter(Q(full_name__icontains=search) | Q(phone_number__icontains=search))
        return qs

    def perform_create(self, serializer):
        rider = serializer.save()
        log_activity(self.request.user, ActivityLog.Action.CREATED, Section.RIDERS,
                     f"Created rider {rider.full_name}")

    def perform_update(self, serializer):
        rider = serializer.save()
        log_activity(self.request.user, ActivityLog.Action.UPDATED, Section.RIDERS,
                     f"Updated rider {rider.full_name}")

    def destroy(self, request, *args, **kwargs):
        # PROTECT FKs are the source of truth for "has linked records" — an
        # enumerated exists() list would silently rot as relations are added.
        rider = self.get_object()
        try:
            response = super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Rider has linked records — set status to inactive instead of deleting."},
                status=status.HTTP_409_CONFLICT,
            )
        log_activity(request.user, ActivityLog.Action.DELETED, Section.RIDERS,
                     f"Deleted rider {rider.full_name}")
        return response

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Average rides/revenue per working day with prev-period growth."""
        return Response(rider_stats(
            date_from=request.query_params.get("date_from"),
            date_to=request.query_params.get("date_to"),
        ))
