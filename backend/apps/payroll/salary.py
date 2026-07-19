"""
Salary run: calculate a period for every active rider, then process payments.

Rules (carried over from the legacy system — do not regress):
- Working days = calendar days minus Saturdays (Nepal weekly off).
- Daily rate = monthly_salary / working-days-in-that-calendar-month; a period
  spanning two months averages the two months' rates.
- days_worked = confirmed daily_log count in the period.
- times_target_missed = days where rides_completed < (daily_bonus_set or the
  rider's daily_ride_target); flagged when >= 3.
- final = max(0, base - allowances - advances - cash_variance).
- Legacy track: base = daily_rate * days_worked.
- VPE track (fleet pilots): base = sum of LOCKED pay_records.daily_pay in the
  period, with a wage-law floor: if the rider worked the full schedule and
  final < monthly_floor, top up to the floor.
- Advances dated inside the period are deducted and marked applied on
  processing; voiding a payment un-applies them.
"""

import calendar
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.operations.models import DailyLog
from apps.riders.models import Rider

from .engine import resolve_param
from .models import PayRecord, SalaryAdvance, SalaryPayment

SATURDAY = 5  # date.weekday()

ZERO = Decimal("0")


def working_days_in_month(year, month):
    days = calendar.monthrange(year, month)[1]
    return sum(1 for d in range(1, days + 1) if date(year, month, d).weekday() != SATURDAY)


def daily_rate(monthly_salary, period_from, period_to):
    """Average the per-month rate across the months the period touches."""
    if not monthly_salary:
        return ZERO
    months = {(period_from.year, period_from.month), (period_to.year, period_to.month)}
    rates = [Decimal(monthly_salary) / working_days_in_month(y, m) for y, m in months]
    return sum(rates) / len(rates)


def scheduled_working_days(period_from, period_to):
    d, count = period_from, 0
    while d <= period_to:
        if d.weekday() != SATURDAY:
            count += 1
        d += timedelta(days=1)
    return count


def calculate_rider(rider, period_from, period_to, advances=None):
    """Compute one rider's salary for the period. `advances` may be passed in
    (already-locked rows from process_payment) so the amounts deducted are
    exactly the rows later marked applied."""
    logs = list(
        DailyLog.objects.filter(
            rider=rider, is_draft=False,
            english_date__gte=period_from, english_date__lte=period_to,
        )
    )
    days_worked = len(logs)

    times_target_missed = 0
    allowances = ZERO
    cash_variance = ZERO
    for log in logs:
        target = log.daily_bonus_set or rider.daily_ride_target
        if target and (log.rides_completed or 0) < target:
            times_target_missed += 1
        allowances += log.daily_allowance or ZERO
        cash_variance += log.cash_check or ZERO  # positive = rider short

    if advances is None:
        advances = list(
            SalaryAdvance.objects.filter(
                rider=rider, applied_at__isnull=True,
                date__gte=period_from, date__lte=period_to,
            )
        )
    total_advances = sum((a.amount for a in advances), ZERO)

    pay_model = SalaryPayment.PayModel.VPE if rider.fleet_pilot else SalaryPayment.PayModel.LEGACY
    if pay_model == SalaryPayment.PayModel.VPE:
        base = sum(
            (r.daily_pay for r in PayRecord.objects.filter(
                rider=rider, status=PayRecord.Status.LOCKED,
                english_date__gte=period_from, english_date__lte=period_to,
            )),
            ZERO,
        )
    else:
        base = (daily_rate(rider.monthly_salary, period_from, period_to) * days_worked).quantize(
            Decimal("0.01")
        )

    final = max(ZERO, base - allowances - total_advances - cash_variance)

    floor_applied = False
    if pay_model == SalaryPayment.PayModel.VPE:
        floor = Decimal(resolve_param("monthly_floor", period_to) or "0")
        if days_worked >= scheduled_working_days(period_from, period_to) and final < floor:
            final, floor_applied = floor, True

    return {
        "rider": str(rider.uuid),
        "rider_name": rider.full_name,
        "pay_model": pay_model,
        "days_worked": days_worked,
        "times_target_missed": times_target_missed,
        "flagged": times_target_missed >= 3,
        "base_salary": base,
        "total_allowances": allowances,
        "total_advances": total_advances,
        "total_cash_variance": cash_variance,
        "final_salary": final,
        "floor_applied": floor_applied,
        "pending_advances": [
            {"id": str(a.uuid), "date": a.date, "amount": a.amount, "notes": a.notes}
            for a in advances
        ],
    }


def calculate_period(period_from, period_to):
    riders = Rider.objects.filter(status=Rider.Status.ACTIVE).order_by("full_name")
    return [calculate_rider(r, period_from, period_to) for r in riders]


@transaction.atomic
def process_payment(rider, period_from, period_to, processed_by, salary_processed=None,
                    notes="", force=False):
    """Persist one rider's salary run and mark the period's advances applied.

    The rider row is locked as the per-rider processing mutex (duplicate check
    and advance application must be atomic against a concurrent submit), and
    the advances are locked so exactly the deducted rows get marked applied."""
    rider = Rider.objects.select_for_update().get(pk=rider.pk)

    duplicate = SalaryPayment.objects.filter(
        rider=rider, period_from=period_from, period_to=period_to
    ).exists()
    if duplicate and not force:
        raise ValueError("A payment for this rider and period already exists.")

    advances = list(
        SalaryAdvance.objects.select_for_update().filter(
            rider=rider, applied_at__isnull=True,
            date__gte=period_from, date__lte=period_to,
        )
    )
    calc = calculate_rider(rider, period_from, period_to, advances=advances)
    final = calc["final_salary"]
    processed = Decimal(str(salary_processed)) if salary_processed is not None else final
    difference = processed - final
    if difference != 0 and not notes:
        raise ValueError("Notes are required when the processed amount differs from the calculated salary.")

    payment = SalaryPayment.objects.create(
        rider=rider,
        period_from=period_from,
        period_to=period_to,
        days_worked=calc["days_worked"],
        times_target_missed=calc["times_target_missed"],
        base_salary=calc["base_salary"],
        total_allowances=calc["total_allowances"],
        total_advances=calc["total_advances"],
        total_cash_variance=calc["total_cash_variance"],
        final_salary=final,
        salary_processed=processed,
        salary_difference=difference,
        pay_model=calc["pay_model"],
        flagged=calc["flagged"],
        processed_by=processed_by,
        notes=notes,
    )
    SalaryAdvance.objects.filter(pk__in=[a.pk for a in advances]).update(
        applied_at=timezone.now(), salary_payment=payment
    )
    return payment


@transaction.atomic
def void_payment(payment):
    """Voiding a payment releases its applied advances back to pending."""
    payment.advances.update(applied_at=None, salary_payment=None)
    payment.delete()
