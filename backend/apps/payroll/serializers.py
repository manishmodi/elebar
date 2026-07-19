import json

from rest_framework import serializers

from apps.common.serializers import UuidModelSerializer, UuidRelatedField
from apps.fleet.models import Vehicle
from apps.riders.models import Rider

from .models import Expense, ExpenseCategory, PayConfig, SalaryAdvance, SalaryPayment


class SalaryAdvanceSerializer(UuidModelSerializer):
    rider = UuidRelatedField(queryset=Rider.objects.all())
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)

    class Meta:
        model = SalaryAdvance
        exclude = ["uuid"]
        read_only_fields = ["applied_at", "salary_payment", "created_at", "updated_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Advance amount must be positive.")
        return value


class SalaryPaymentSerializer(UuidModelSerializer):
    rider = UuidRelatedField(read_only=True)
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)

    class Meta:
        model = SalaryPayment
        exclude = ["uuid"]


class PayConfigSerializer(UuidModelSerializer):
    class Meta:
        model = PayConfig
        exclude = ["uuid"]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        parameter, value = attrs.get("parameter"), attrs.get("value", "")
        if parameter in (PayConfig.Parameter.RAMP, PayConfig.Parameter.YANGO_BONUS_TABLE):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise serializers.ValidationError({"value": f"Must be valid JSON: {exc}"})
            if parameter == PayConfig.Parameter.RAMP and not isinstance(parsed, list):
                raise serializers.ValidationError({"value": "Ramp must be a JSON array of tiers."})
        return attrs


class ExpenseCategorySerializer(UuidModelSerializer):
    class Meta:
        model = ExpenseCategory
        exclude = ["uuid"]
        read_only_fields = ["created_at", "updated_at"]


class ExpenseSerializer(UuidModelSerializer):
    category = UuidRelatedField(queryset=ExpenseCategory.objects.all())
    category_name = serializers.CharField(source="category.name", read_only=True)
    rider = UuidRelatedField(queryset=Rider.objects.all(), required=False, allow_null=True)
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    vehicle = UuidRelatedField(queryset=Vehicle.objects.all(), required=False, allow_null=True)
    vehicle_number = serializers.CharField(source="vehicle.vehicle_number", read_only=True)

    class Meta:
        model = Expense
        exclude = ["uuid"]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Expense amount must be positive.")
        return value
