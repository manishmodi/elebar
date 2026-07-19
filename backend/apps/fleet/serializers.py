from rest_framework import serializers

from apps.common.serializers import UuidModelSerializer, UuidRelatedField
from apps.riders.models import Rider

from .models import Assignment, Maintenance, ServiceHistory, Vehicle


class VehicleSerializer(UuidModelSerializer):
    # Tracker credential: writable by vehicles:edit, never readable via the API.
    gps_id_password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Vehicle
        exclude = ["uuid"]
        read_only_fields = ["vehicle_number", "created_at", "updated_at", "in_servicing_since"]


class AssignmentSerializer(UuidModelSerializer):
    rider = UuidRelatedField(queryset=Rider.objects.all())
    vehicle = UuidRelatedField(queryset=Vehicle.objects.all())
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    vehicle_number = serializers.CharField(source="vehicle.vehicle_number", read_only=True)
    plate_number = serializers.CharField(source="vehicle.plate_number", read_only=True)

    class Meta:
        model = Assignment
        exclude = ["uuid"]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        """One active assignment per rider and per vehicle. The DB partial
        unique constraints back this up; the check here gives clean 400s."""
        status = attrs.get("status", getattr(self.instance, "status", Assignment.Status.ACTIVE))
        if status != Assignment.Status.ACTIVE:
            return attrs
        rider = attrs.get("rider", getattr(self.instance, "rider", None))
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        active = Assignment.objects.filter(status=Assignment.Status.ACTIVE)
        if self.instance:
            active = active.exclude(pk=self.instance.pk)
        if rider and active.filter(rider=rider).exists():
            raise serializers.ValidationError({"rider": "Rider already has an active assignment."})
        if vehicle and active.filter(vehicle=vehicle).exists():
            raise serializers.ValidationError({"vehicle": "Vehicle already has an active assignment."})
        return attrs


class MaintenanceSerializer(UuidModelSerializer):
    vehicle = UuidRelatedField(queryset=Vehicle.objects.all())
    vehicle_number = serializers.CharField(source="vehicle.vehicle_number", read_only=True)
    plate_number = serializers.CharField(source="vehicle.plate_number", read_only=True)

    class Meta:
        model = Maintenance
        exclude = ["uuid"]
        read_only_fields = ["created_at", "updated_at"]


class ServiceHistorySerializer(UuidModelSerializer):
    vehicle = UuidRelatedField(queryset=Vehicle.objects.all())
    vehicle_number = serializers.CharField(source="vehicle.vehicle_number", read_only=True)

    class Meta:
        model = ServiceHistory
        exclude = ["uuid"]
        read_only_fields = ["created_at", "updated_at"]
