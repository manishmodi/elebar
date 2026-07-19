from django.db import models

from apps.common.models import BaseModel

MONEY = dict(max_digits=12, decimal_places=2, null=True, blank=True)
MONEY0 = dict(max_digits=12, decimal_places=2, default=0)


class DailyLog(BaseModel):
    """One rider-day of Yango ride/earnings data. Rows arrive as drafts from
    the Yango sync and are confirmed by ops; the payroll engine only ever
    reads confirmed rows."""

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="daily_logs")
    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.PROTECT, related_name="daily_logs")
    nepali_date = models.CharField(max_length=16, blank=True)
    english_date = models.DateField(db_index=True)
    check_in_time = models.CharField(max_length=16, blank=True)
    check_out_time = models.CharField(max_length=16, blank=True)
    daily_bonus_set = models.PositiveIntegerField(null=True, blank=True)
    total_rides_received = models.PositiveIntegerField(null=True, blank=True)
    rides_completed = models.PositiveIntegerField(null=True, blank=True)
    acceptance_rate = models.CharField(max_length=16, blank=True)
    bonus_target_completion = models.BooleanField(null=True, blank=True)
    total_ride_distance_km = models.CharField(max_length=16, blank=True)
    total_ride_hours = models.CharField(max_length=16, blank=True)
    total_app_online = models.CharField(max_length=16, blank=True)
    cash_as_per_app = models.DecimalField(**MONEY)
    goal_bonus = models.DecimalField(**MONEY)
    promotion_bonus_other = models.DecimalField(**MONEY)
    total_income = models.DecimalField(**MONEY)
    cash_given_by_driver = models.DecimalField(**MONEY)
    cash_transferred_online = models.DecimalField(**MONEY)
    # Cash variance for the day: positive = rider short (deducted at payroll).
    cash_check = models.DecimalField(**MONEY)
    daily_allowance = models.DecimalField(**MONEY)
    additional_expenses = models.DecimalField(**MONEY)
    remarks = models.TextField(blank=True)
    is_draft = models.BooleanField(default=False)
    yango_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["rider", "english_date"], name="uniq_daily_log_rider_date"),
        ]


class Attendance(BaseModel):
    """Canonical rider-day attendance row; also carries the guard shift-log
    (battery/odometer/times). Guard-log fields freeze after a verified
    check-in — only admins may edit them, and edits recompute pay."""

    class Type(models.TextChoices):
        PRESENT = "present"
        ABSENT = "absent"
        LEAVE = "leave"
        HOLIDAY = "holiday"
        HALF_DAY = "half_day"

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="attendance")
    date = models.DateField(db_index=True)
    nepali_date = models.CharField(max_length=16, blank=True)
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.PRESENT)
    remarks = models.TextField(blank=True)
    vehicle = models.ForeignKey(
        "fleet.Vehicle", null=True, blank=True, on_delete=models.PROTECT, related_name="attendance"
    )
    battery_out = models.PositiveSmallIntegerField(null=True, blank=True)  # 0-100
    battery_in = models.PositiveSmallIntegerField(null=True, blank=True)
    scooter_out = models.CharField(max_length=16, blank=True)
    scooter_in = models.CharField(max_length=16, blank=True)
    rider_time_in = models.CharField(max_length=16, blank=True)
    rider_time_out = models.CharField(max_length=16, blank=True)
    # Historical naming is inverted and kept for continuity:
    # morning_odometer = source "distance_in", evening_odometer = "distance_out".
    morning_odometer = models.PositiveIntegerField(null=True, blank=True)
    evening_odometer = models.PositiveIntegerField(null=True, blank=True)
    vehicle_override_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["rider", "date"], name="uniq_attendance_rider_date"),
        ]

    GUARD_LOCKED_FIELDS = (
        "battery_out", "battery_in", "scooter_out", "scooter_in",
        "rider_time_in", "rider_time_out", "morning_odometer", "evening_odometer",
    )

    @property
    def day_closed(self):
        """A verified check-in closed the day (evening leg recorded)."""
        return self.evening_odometer is not None or bool(self.rider_time_out)


class CashCollection(BaseModel):
    """Evening cash reconciliation with denomination breakdown and an
    approve/disapprove workflow. Approval locks the day's pay record."""

    class ApprovalStatus(models.TextChoices):
        PENDING = "pending"
        APPROVED = "approved"
        DISAPPROVED = "disapproved"

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="cash_collections")
    english_date = models.DateField(db_index=True)
    nepali_date = models.CharField(max_length=16, blank=True)

    denom_1000 = models.PositiveIntegerField(default=0)
    denom_500 = models.PositiveIntegerField(default=0)
    denom_100 = models.PositiveIntegerField(default=0)
    denom_50 = models.PositiveIntegerField(default=0)
    denom_20 = models.PositiveIntegerField(default=0)
    denom_10 = models.PositiveIntegerField(default=0)

    cash_total = models.DecimalField(**MONEY0)
    wallet_amount = models.DecimalField(**MONEY0)
    grand_total = models.DecimalField(**MONEY0)
    note = models.TextField(blank=True)

    submitted_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    submitted_by_name = models.CharField(max_length=255, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    approval_status = models.CharField(
        max_length=16, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING, db_index=True
    )
    approved_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    approved_by_name = models.CharField(max_length=255, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approval_note = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["rider", "english_date"], name="uniq_cash_collection_rider_date"),
        ]

    DENOMS = ((1000, "denom_1000"), (500, "denom_500"), (100, "denom_100"),
              (50, "denom_50"), (20, "denom_20"), (10, "denom_10"))

    def compute_totals(self):
        self.cash_total = sum(value * getattr(self, field) for value, field in self.DENOMS)
        self.grand_total = self.cash_total + (self.wallet_amount or 0)


class FleetHandover(BaseModel):
    """Staged rider-app submission (checkout / exchange / checkin) awaiting
    guard verification. Verification projects it into the canonical
    Attendance row; check-in verification also creates the CashCollection."""

    class Kind(models.TextChoices):
        CHECKOUT = "checkout"
        EXCHANGE = "exchange"
        CHECKIN = "checkin"

    class Status(models.TextChoices):
        PENDING = "pending"
        VERIFIED = "verified"
        REJECTED = "rejected"

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="handovers")
    english_date = models.DateField()
    kind = models.CharField(max_length=16, choices=Kind.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    idempotency_key = models.CharField(max_length=128, unique=True)
    # Kind-specific data: odometer/battery/goalTier/cash/photoPaths; exchange
    # payloads hold both closing and opening legs.
    payload = models.JSONField()
    vehicle = models.ForeignKey(
        "fleet.Vehicle", null=True, blank=True, on_delete=models.PROTECT, related_name="handovers"
    )
    cash_expected = models.DecimalField(**MONEY)
    cash_variance = models.DecimalField(**MONEY)
    submitted_at = models.DateTimeField(auto_now_add=True)
    verified_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    verified_by_name = models.CharField(max_length=255, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["rider", "english_date"]),
            models.Index(fields=["status"]),
        ]


class RiderDailyTarget(BaseModel):
    """Auto-computed daily ride target (Yango targeting engine)."""

    rider = models.ForeignKey("riders.Rider", on_delete=models.CASCADE, related_name="daily_targets")
    date = models.DateField()
    working_day_count = models.PositiveIntegerField(default=0)
    avg_7day = models.CharField(max_length=16, blank=True)
    tier = models.CharField(max_length=16, default="new")
    tier_adj = models.IntegerField(default=0)
    tier_c_streak = models.PositiveIntegerField(default=0)
    improvement_streak = models.PositiveIntegerField(default=0)
    tier_c_accel = models.BooleanField(default=False)
    calculated_target = models.PositiveIntegerField()
    final_target = models.PositiveIntegerField()
    needs_hr_review = models.BooleanField(default=False)
    computed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["rider", "date"], name="uniq_daily_target_rider_date"),
        ]


class RiderRideStats(BaseModel):
    rider = models.ForeignKey("riders.Rider", on_delete=models.CASCADE, related_name="ride_stats")
    date = models.DateField()
    rides_completed = models.PositiveIntegerField(default=0)
    rides_received = models.PositiveIntegerField(default=0)
    pulled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "rider ride stats"
        constraints = [
            models.UniqueConstraint(fields=["rider", "date"], name="uniq_ride_stats_rider_date"),
        ]


class RiderTargetOverride(BaseModel):
    rider = models.ForeignKey("riders.Rider", on_delete=models.CASCADE, related_name="target_overrides")
    date = models.DateField()
    overridden_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    overridden_by_name = models.CharField(max_length=255, blank=True)
    from_target = models.PositiveIntegerField()
    to_target = models.PositiveIntegerField()
    reason = models.TextField()
