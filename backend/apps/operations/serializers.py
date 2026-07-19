from rest_framework import serializers

from apps.common.serializers import UuidModelSerializer, UuidRelatedField
from apps.fleet.models import Vehicle
from apps.riders.models import Rider

from .models import Attendance, CashCollection, DailyLog, FleetHandover


class DailyLogSerializer(UuidModelSerializer):
    rider = UuidRelatedField(queryset=Rider.objects.all())
    vehicle = UuidRelatedField(queryset=Vehicle.objects.all())
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    vehicle_number = serializers.CharField(source="vehicle.vehicle_number", read_only=True)
    plate_number = serializers.CharField(source="vehicle.plate_number", read_only=True)

    class Meta:
        model = DailyLog
        exclude = ["uuid"]
        read_only_fields = ["yango_synced_at", "created_at", "updated_at"]


class AttendanceSerializer(UuidModelSerializer):
    rider = UuidRelatedField(queryset=Rider.objects.all())
    vehicle = UuidRelatedField(queryset=Vehicle.objects.all(), required=False, allow_null=True)
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    vehicle_number = serializers.CharField(source="vehicle.vehicle_number", read_only=True)
    day_closed = serializers.BooleanField(read_only=True)

    class Meta:
        model = Attendance
        exclude = ["uuid"]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        for field in ("battery_out", "battery_in"):
            if attrs.get(field) is not None and not 0 <= attrs[field] <= 100:
                raise serializers.ValidationError({field: "Battery must be 0-100."})
        return attrs


class CashCollectionSerializer(UuidModelSerializer):
    rider = UuidRelatedField(queryset=Rider.objects.all())
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    submitted_by = UuidRelatedField(read_only=True)
    approved_by = UuidRelatedField(read_only=True)

    class Meta:
        model = CashCollection
        exclude = ["uuid"]
        read_only_fields = [
            "cash_total", "grand_total",
            "submitted_by", "submitted_by_name", "submitted_at",
            "approval_status", "approved_by", "approved_by_name", "approved_at", "approval_note",
            "created_at", "updated_at",
        ]


class FleetHandoverSerializer(UuidModelSerializer):
    rider = UuidRelatedField(read_only=True)
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    vehicle = UuidRelatedField(read_only=True)
    vehicle_number = serializers.CharField(source="vehicle.vehicle_number", read_only=True)
    verified_by = UuidRelatedField(read_only=True)

    class Meta:
        model = FleetHandover
        exclude = ["uuid"]
