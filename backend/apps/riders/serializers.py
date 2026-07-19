from apps.common.serializers import UuidModelSerializer

from .models import Rider


class RiderSerializer(UuidModelSerializer):
    class Meta:
        model = Rider
        exclude = ["uuid"]
        read_only_fields = ["created_at", "updated_at"]


class RiderListSerializer(UuidModelSerializer):
    """Slim list shape — the KYC detail stays on the detail endpoint."""

    class Meta:
        model = Rider
        fields = [
            "id", "full_name", "phone_number", "status", "employment_type",
            "joining_date", "monthly_salary", "daily_ride_target",
            "assigned_supervisor", "fleet_pilot", "yango_driver_id", "created_at",
        ]
