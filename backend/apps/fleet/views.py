from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ActivityLog, log_activity
from apps.authz.permissions import SectionPermission
from apps.authz.sections import Section
from apps.common.pagination import AdminPageNumberPagination

from .models import Assignment, Maintenance, ServiceHistory, Vehicle
from .serializers import (
    AssignmentSerializer,
    MaintenanceSerializer,
    ServiceHistorySerializer,
    VehicleSerializer,
)
from .services import servicing_status


class VehicleViewSet(viewsets.ModelViewSet):
    section = Section.VEHICLES
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = VehicleSerializer
    queryset = Vehicle.objects.all().order_by("vehicle_number")

    def get_queryset(self):
        qs = super().get_queryset()
        if vehicle_status := self.request.query_params.get("status"):
            qs = qs.filter(status=vehicle_status)
        if search := self.request.query_params.get("search"):
            qs = qs.filter(plate_number__icontains=search) | qs.filter(vehicle_number__icontains=search)
        return qs

    def perform_create(self, serializer):
        # Auto vehicle number with a couple of retries on unique-clash races.
        for _ in range(3):
            try:
                with transaction.atomic():
                    vehicle = serializer.save(vehicle_number=Vehicle.next_vehicle_number())
                break
            except IntegrityError:
                continue
        else:
            raise IntegrityError("Could not allocate a vehicle number")
        log_activity(self.request.user, ActivityLog.Action.CREATED, Section.VEHICLES,
                     f"Created vehicle {vehicle.vehicle_number}")

    def perform_update(self, serializer):
        vehicle = serializer.save()
        log_activity(self.request.user, ActivityLog.Action.UPDATED, Section.VEHICLES,
                     f"Updated vehicle {vehicle.vehicle_number}")

    def destroy(self, request, *args, **kwargs):
        vehicle = self.get_object()
        try:
            response = super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Vehicle has linked records — set status to inactive instead of deleting."},
                status=status.HTTP_409_CONFLICT,
            )
        log_activity(request.user, ActivityLog.Action.DELETED, Section.VEHICLES,
                     f"Deleted vehicle {vehicle.vehicle_number}")
        return response


class AssignmentViewSet(viewsets.ModelViewSet):
    section = Section.ASSIGNMENTS
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = AssignmentSerializer
    queryset = Assignment.objects.select_related("rider", "vehicle").order_by("-start_date")

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if a_status := params.get("status"):
            qs = qs.filter(status=a_status)
        if rider := params.get("rider"):
            qs = qs.filter(rider__uuid=rider)
        if vehicle := params.get("vehicle"):
            qs = qs.filter(vehicle__uuid=vehicle)
        return qs


class MaintenanceViewSet(viewsets.ModelViewSet):
    section = Section.MAINTENANCE
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = MaintenanceSerializer
    queryset = Maintenance.objects.select_related("vehicle").order_by("-date")

    def get_queryset(self):
        qs = super().get_queryset()
        if vehicle := self.request.query_params.get("vehicle"):
            qs = qs.filter(vehicle__uuid=vehicle)
        if mtype := self.request.query_params.get("type"):
            qs = qs.filter(maintenance_type=mtype)
        return qs


class ServicingStatusView(APIView):
    section = Section.MAINTENANCE
    permission_classes = [SectionPermission]

    def get(self, request):
        return Response(servicing_status())


class ServiceHistoryViewSet(viewsets.ModelViewSet):
    section = Section.MAINTENANCE
    permission_classes = [SectionPermission]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    serializer_class = ServiceHistorySerializer
    queryset = ServiceHistory.objects.select_related("vehicle").order_by("-service_date")
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if vehicle := self.request.query_params.get("vehicle"):
            qs = qs.filter(vehicle__uuid=vehicle)
        return qs

    def perform_create(self, serializer):
        record = serializer.save()
        record.apply_to_vehicle()
        log_activity(self.request.user, ActivityLog.Action.CREATED, Section.MAINTENANCE,
                     f"Logged service for {record.vehicle.vehicle_number} @ {record.odometer_at_service} km")


class ServicingSendView(APIView):
    """Flag a vehicle as away at the workshop."""

    section = Section.MAINTENANCE
    permission_classes = [SectionPermission]
    section_action_overrides = {"POST": "edit"}

    def post(self, request):
        vehicle = self._vehicle(request)
        vehicle.in_servicing_since = timezone.now()
        vehicle.save(update_fields=["in_servicing_since"])
        return Response({"detail": "Vehicle sent for servicing."})

    @staticmethod
    def _vehicle(request):
        from django.shortcuts import get_object_or_404
        return get_object_or_404(Vehicle, uuid=request.data.get("vehicle"))


class ServicingCancelView(ServicingSendView):
    def post(self, request):
        vehicle = self._vehicle(request)
        vehicle.in_servicing_since = None
        vehicle.save(update_fields=["in_servicing_since"])
        return Response({"detail": "Servicing cancelled."})
