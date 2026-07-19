from django.db import models, transaction
from django.db.models import Q

from apps.common.models import BaseModel

MONEY = dict(max_digits=12, decimal_places=2, null=True, blank=True)

# Servicing thresholds (km since last service)
SERVICE_INTERVAL_KM = 2000
SERVICE_DUE_SOON_KM = 1500


class Vehicle(BaseModel):
    class Status(models.TextChoices):
        ACTIVE = "active"
        MAINTENANCE = "maintenance"
        INACTIVE = "inactive"

    vehicle_number = models.CharField(max_length=16, unique=True)  # V-001, auto-assigned
    plate_number = models.CharField(max_length=32)
    vehicle_type = models.CharField(max_length=64, blank=True)
    brand = models.CharField(max_length=64, blank=True)
    model = models.CharField(max_length=64, blank=True)
    manufacture_year = models.PositiveIntegerField(null=True, blank=True)
    color = models.CharField(max_length=32, blank=True)
    purchase_date = models.DateField(null=True, blank=True)
    purchase_cost = models.DecimalField(**MONEY)
    battery_details = models.CharField(max_length=255, blank=True)
    insurance_issue_date = models.DateField(null=True, blank=True)
    insurance_expiry = models.DateField(null=True, blank=True)
    tax_expiry = models.DateField(null=True, blank=True)
    service_due_date = models.DateField(null=True, blank=True)
    last_service_date = models.DateField(null=True, blank=True)
    last_service_odometer = models.PositiveIntegerField(null=True, blank=True)
    servicing_payment = models.CharField(max_length=64, blank=True)
    odometer_reading = models.CharField(max_length=32, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    location_branch = models.CharField(max_length=128, blank=True)
    gps_installed = models.CharField(max_length=16, blank=True)
    gps_number = models.CharField(max_length=64, blank=True)
    gps_id_password = models.CharField(max_length=128, blank=True)
    scooter_branding = models.CharField(max_length=128, blank=True)
    yango_branding_date = models.DateField(null=True, blank=True)
    branding_payment = models.CharField(max_length=64, blank=True)
    brandwrap_expire_date = models.DateField(null=True, blank=True)
    bluebook_issue_date = models.DateField(null=True, blank=True)
    bluebook_expiry_date = models.DateField(null=True, blank=True)
    # Set while the vehicle is away at the workshop; cleared when service logged.
    in_servicing_since = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.vehicle_number} ({self.plate_number})"

    @classmethod
    def next_vehicle_number(cls):
        """V-001-style sequence. Called under the create transaction; the
        unique constraint is the final arbiter on races."""
        last = (
            cls.objects.filter(vehicle_number__regex=r"^V-[0-9]+$")
            .order_by("-id")
            .values_list("vehicle_number", flat=True)
        )
        highest = max((int(n.split("-")[1]) for n in last), default=0)
        return f"V-{highest + 1:03d}"


class Assignment(BaseModel):
    """Rider <-> vehicle pairing. At most one ACTIVE assignment per rider and
    per vehicle — enforced by partial unique constraints, not just app code."""

    class Shift(models.TextChoices):
        MORNING = "morning"
        DAY = "day"
        EVENING = "evening"
        NIGHT = "night"

    class Status(models.TextChoices):
        ACTIVE = "active"
        ENDED = "ended"

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="assignments")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="assignments")
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    shift_type = models.CharField(max_length=16, choices=Shift.choices, default=Shift.DAY)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["rider"], condition=Q(status="active"), name="uniq_active_assignment_per_rider"
            ),
            models.UniqueConstraint(
                fields=["vehicle"], condition=Q(status="active"), name="uniq_active_assignment_per_vehicle"
            ),
        ]


class Maintenance(BaseModel):
    class Type(models.TextChoices):
        BATTERY_SERVICE = "battery_service"
        TIRE_REPLACEMENT = "tire_replacement"
        BRAKE_SERVICE = "brake_service"
        ELECTRICAL_REPAIR = "electrical_repair"
        ACCIDENT_REPAIR = "accident_repair"

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="maintenance_records")
    maintenance_type = models.CharField(max_length=32, choices=Type.choices)
    date = models.DateField()
    cost = models.DecimalField(**MONEY)
    description = models.TextField(blank=True)
    next_service_date = models.DateField(null=True, blank=True)


class ServiceHistory(BaseModel):
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="service_history")
    service_date = models.DateField()
    odometer_at_service = models.PositiveIntegerField()
    notes = models.TextField(blank=True)
    cost = models.DecimalField(**MONEY)

    class Meta:
        verbose_name_plural = "service histories"

    @transaction.atomic
    def apply_to_vehicle(self):
        """Logging a service updates the vehicle's service state and brings it
        back from the workshop."""
        Vehicle.objects.filter(pk=self.vehicle_id).update(
            last_service_date=self.service_date,
            last_service_odometer=self.odometer_at_service,
            in_servicing_since=None,
        )
