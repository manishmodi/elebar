from decimal import Decimal

from django.db import models

from apps.common.models import BaseModel

MONEY = dict(max_digits=12, decimal_places=2, null=True, blank=True)
MONEY0 = dict(max_digits=12, decimal_places=2, default=Decimal("0"))


class SalaryAdvance(BaseModel):
    """Cash advance to a rider. Deducted from the salary run whose period
    contains it; once applied it links to the payment and cannot be deleted
    (voiding the payment un-applies it)."""

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="salary_advances")
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    notes = models.TextField(blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    salary_payment = models.ForeignKey(
        "payroll.SalaryPayment", null=True, blank=True, on_delete=models.SET_NULL, related_name="advances"
    )


class SalaryPayment(BaseModel):
    class PayModel(models.TextChoices):
        LEGACY = "legacy"  # daily rate x days worked
        VPE = "vpe"        # sum of locked pay_records

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="salary_payments")
    period_from = models.DateField()
    period_to = models.DateField()
    days_worked = models.PositiveIntegerField(default=0)
    times_target_missed = models.PositiveIntegerField(default=0)
    base_salary = models.DecimalField(max_digits=12, decimal_places=2)
    total_allowances = models.DecimalField(**MONEY0)
    total_advances = models.DecimalField(**MONEY0)
    total_cash_variance = models.DecimalField(**MONEY0)
    final_salary = models.DecimalField(max_digits=12, decimal_places=2)
    # What was actually paid out; a difference requires notes.
    salary_processed = models.DecimalField(**MONEY)
    salary_difference = models.DecimalField(**MONEY)
    pay_model = models.CharField(max_length=16, choices=PayModel.choices, default=PayModel.LEGACY)
    flagged = models.BooleanField(default=False)  # >=3 target misses in period
    processed_at = models.DateTimeField(auto_now_add=True)
    processed_by = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        indexes = [models.Index(fields=["rider", "period_from", "period_to"])]


class PayConfig(BaseModel):
    """Versioned Variable Pay Engine parameter: the value effective for a day
    is the row with the latest effective_from <= that day. Never mutate old
    rows — add a new effective_from so historical recomputes stay stable."""

    class Parameter(models.TextChoices):
        FLEET_ENABLED = "fleet_enabled"
        BASE_AMOUNT = "base_amount"
        BASE_MIN_HOURS = "base_min_hours"
        BASE_MIN_RIDES = "base_min_rides"
        COMMISSION_RATE = "commission_rate"
        REVENUE_CAP = "revenue_cap"
        GROWTH_RATE = "growth_rate"
        RAMP = "ramp"
        STREAK_LENGTH = "streak_length"
        STREAK_BONUS = "streak_bonus"
        MONTHLY_FLOOR = "monthly_floor"
        YANGO_BONUS_TABLE = "yango_bonus_table"

    parameter = models.CharField(max_length=32, choices=Parameter.choices)
    value = models.TextField()  # scalar or JSON depending on the parameter
    effective_from = models.DateField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["parameter", "effective_from"], name="uniq_payconfig_param_date"),
        ]

    @classmethod
    def resolve(cls, parameter, on_date):
        row = (
            cls.objects.filter(parameter=parameter, effective_from__lte=on_date)
            .order_by("-effective_from")
            .first()
        )
        return row.value if row else None


class PayRecord(BaseModel):
    """One computed/locked Variable Pay Engine row per fleet-pilot rider-day.
    daily_pay = base + commission + prize + growth (+ streak bonus on the
    completing day). Locked when finance approves the day's cash collection;
    later admin edits recompute with an audit entry."""

    class Status(models.TextChoices):
        COMPUTED = "computed"
        LOCKED = "locked"

    rider = models.ForeignKey("riders.Rider", on_delete=models.PROTECT, related_name="pay_records")
    english_date = models.DateField()
    base = models.DecimalField(**MONEY0)
    commission = models.DecimalField(**MONEY0)
    prize = models.DecimalField(**MONEY0)
    growth = models.DecimalField(**MONEY0)
    daily_pay = models.DecimalField(**MONEY0)
    # Snapshot of resolved config + gate evaluation + inputs used.
    gates_applied = models.JSONField(default=dict, blank=True)
    flags = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.COMPUTED)
    computed_at = models.DateTimeField(null=True, blank=True)
    locked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["rider", "english_date"], name="uniq_pay_record_rider_date"),
        ]


class Streak(BaseModel):
    """Consecutive qualifying days. Advances only on first lock of a day —
    recomputes never retroactively change an awarded streak bonus."""

    rider = models.OneToOneField("riders.Rider", on_delete=models.CASCADE, related_name="streak")
    current_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    last_qualifying_date = models.DateField(null=True, blank=True)


class ExpenseCategory(BaseModel):
    name = models.CharField(max_length=128)
    description = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "expense categories"

    def __str__(self):
        return self.name


class Expense(BaseModel):
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="expenses")
    date = models.DateField(db_index=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    notes = models.TextField(blank=True)
    rider = models.ForeignKey(
        "riders.Rider", null=True, blank=True, on_delete=models.PROTECT, related_name="expenses"
    )
    vehicle = models.ForeignKey(
        "fleet.Vehicle", null=True, blank=True, on_delete=models.PROTECT, related_name="expenses"
    )
    created_by = models.CharField(max_length=255, blank=True)
