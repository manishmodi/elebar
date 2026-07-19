"""apps/payroll/salary.py — working-day math, salary calc, process/void."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.operations.models import DailyLog
from apps.payroll.models import PayConfig, PayRecord, SalaryAdvance, SalaryPayment
from apps.payroll.salary import (
    calculate_rider,
    daily_rate,
    process_payment,
    scheduled_working_days,
    void_payment,
    working_days_in_month,
)
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


# --- working_days_in_month / Saturday exclusion -----------------------------

def test_working_days_in_month_excludes_saturdays():
    # July 2026: 31 days, Saturdays on 4/11/18/25 -> 27 working days.
    assert working_days_in_month(2026, 7) == 27


def test_working_days_in_month_varies_by_month_layout():
    # August 2026: 31 days, Saturdays on 1/8/15/22/29 -> 26 working days.
    assert working_days_in_month(2026, 8) == 26


# --- daily_rate two-month averaging ------------------------------------------

def test_daily_rate_single_month():
    rate = daily_rate(Decimal("27000"), date(2026, 7, 1), date(2026, 7, 15))
    assert rate == Decimal("27000") / 27


def test_daily_rate_averages_across_two_months():
    # Period spans July (27 working days) and August (26 working days).
    rate = daily_rate(Decimal("26000"), date(2026, 7, 25), date(2026, 8, 5))
    july_rate = Decimal("26000") / 27
    august_rate = Decimal("26000") / 26
    assert rate == (july_rate + august_rate) / 2


def test_daily_rate_zero_for_no_salary():
    assert daily_rate(None, date(2026, 7, 1), date(2026, 7, 15)) == Decimal("0")


# --- calculate_rider: legacy vs VPE -------------------------------------------

def _log(rider, vehicle, day, rides=25, target_miss=False, allowance=0, cash_check=0):
    return DailyLog.objects.create(
        rider=rider, vehicle=vehicle, english_date=day, is_draft=False,
        rides_completed=(rider.daily_ride_target - 1) if target_miss else rides,
        daily_allowance=Decimal(str(allowance)), cash_check=Decimal(str(cash_check)),
    )


def test_calculate_rider_legacy_uses_daily_rate_times_days_worked():
    rider = RiderFactory(fleet_pilot=False, monthly_salary=Decimal("27000"), daily_ride_target=20)
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    for d in (1, 2, 3):
        _log(rider, vehicle, date(2026, 7, d))

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["pay_model"] == SalaryPayment.PayModel.LEGACY
    assert calc["days_worked"] == 3
    expected_rate = daily_rate(rider.monthly_salary, period_from, period_to)
    assert calc["base_salary"] == (expected_rate * 3).quantize(Decimal("0.01"))
    assert calc["final_salary"] == calc["base_salary"]


def test_calculate_rider_vpe_sums_locked_pay_records_only():
    rider = RiderFactory(fleet_pilot=True, monthly_salary=None)
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)

    PayRecord.objects.create(
        rider=rider, english_date=date(2026, 7, 1),
        daily_pay=Decimal("900"), status=PayRecord.Status.LOCKED,
    )
    PayRecord.objects.create(
        rider=rider, english_date=date(2026, 7, 2),
        daily_pay=Decimal("800"), status=PayRecord.Status.LOCKED,
    )
    # Computed-but-not-locked row must NOT be counted.
    PayRecord.objects.create(
        rider=rider, english_date=date(2026, 7, 3),
        daily_pay=Decimal("500"), status=PayRecord.Status.COMPUTED,
    )
    # Outside the period must NOT be counted.
    PayRecord.objects.create(
        rider=rider, english_date=date(2026, 6, 30),
        daily_pay=Decimal("777"), status=PayRecord.Status.LOCKED,
    )

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["pay_model"] == SalaryPayment.PayModel.VPE
    assert calc["base_salary"] == Decimal("1700")


def test_calculate_rider_target_miss_counting_and_flagged():
    rider = RiderFactory(fleet_pilot=False, daily_ride_target=20, monthly_salary=Decimal("20000"))
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    for d, miss in [(1, True), (2, True), (3, True), (4, False), (5, False)]:
        _log(rider, vehicle, date(2026, 7, d), target_miss=miss)

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["times_target_missed"] == 3
    assert calc["flagged"] is True


def test_calculate_rider_not_flagged_below_threshold():
    rider = RiderFactory(fleet_pilot=False, daily_ride_target=20, monthly_salary=Decimal("20000"))
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    for d, miss in [(1, True), (2, True), (3, False)]:
        _log(rider, vehicle, date(2026, 7, d), target_miss=miss)

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["times_target_missed"] == 2
    assert calc["flagged"] is False


def test_calculate_rider_deducts_only_in_period_unapplied_advances():
    rider = RiderFactory(fleet_pilot=False, monthly_salary=Decimal("27000"))
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    _log(rider, vehicle, date(2026, 7, 1))

    in_period = SalaryAdvance.objects.create(rider=rider, date=date(2026, 7, 5), amount=Decimal("500"))
    # Outside the period — not deducted.
    SalaryAdvance.objects.create(rider=rider, date=date(2026, 6, 1), amount=Decimal("999"))
    # Already applied — not deducted a second time.
    SalaryAdvance.objects.create(
        rider=rider, date=date(2026, 7, 6), amount=Decimal("333"),
        applied_at=timezone.make_aware(timezone.datetime(2026, 7, 6)),
    )

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["total_advances"] == Decimal("500")
    assert [a["id"] for a in calc["pending_advances"]] == [str(in_period.uuid)]


def test_calculate_rider_vpe_monthly_floor_top_up_when_full_schedule():
    rider = RiderFactory(fleet_pilot=True, monthly_salary=None)
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 6), date(2026, 7, 10)  # Mon-Fri, no Saturday
    assert scheduled_working_days(period_from, period_to) == 5

    for d in range(6, 11):
        _log(rider, vehicle, date(2026, 7, d))
    for d in range(6, 11):
        PayRecord.objects.create(
            rider=rider, english_date=date(2026, 7, d),
            daily_pay=Decimal("500"), status=PayRecord.Status.LOCKED,
        )
    # base = 2500, days_worked(5) >= scheduled(5), final(2500) < floor(17500) -> top up.

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["floor_applied"] is True
    assert calc["final_salary"] == Decimal("17500")


def test_calculate_rider_vpe_no_floor_top_up_when_schedule_incomplete():
    rider = RiderFactory(fleet_pilot=True, monthly_salary=None)
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 6), date(2026, 7, 10)  # 5 scheduled days
    # Only worked 2 of the 5 scheduled days.
    for d in (6, 7):
        _log(rider, vehicle, date(2026, 7, d))
        PayRecord.objects.create(
            rider=rider, english_date=date(2026, 7, d),
            daily_pay=Decimal("500"), status=PayRecord.Status.LOCKED,
        )

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["floor_applied"] is False
    assert calc["final_salary"] == Decimal("1000")


def test_calculate_rider_floor_uses_configured_effective_dated_value():
    rider = RiderFactory(fleet_pilot=True, monthly_salary=None)
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 6), date(2026, 7, 10)
    PayConfig.objects.create(
        parameter=PayConfig.Parameter.MONTHLY_FLOOR, value="1000", effective_from=date(2026, 1, 1)
    )
    for d in range(6, 11):
        _log(rider, vehicle, date(2026, 7, d))
        PayRecord.objects.create(
            rider=rider, english_date=date(2026, 7, d),
            daily_pay=Decimal("100"), status=PayRecord.Status.LOCKED,
        )
    # base = 500, floor configured to 1000 (below default 17500) -> top up to 1000.

    calc = calculate_rider(rider, period_from, period_to)

    assert calc["floor_applied"] is True
    assert calc["final_salary"] == Decimal("1000")


# --- process_payment / void_payment ------------------------------------------

def test_process_payment_duplicate_period_raises_unless_forced():
    rider = RiderFactory(fleet_pilot=False, monthly_salary=Decimal("20000"))
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    process_payment(rider, period_from, period_to, processed_by="tester")

    with pytest.raises(ValueError):
        process_payment(rider, period_from, period_to, processed_by="tester")

    # force=True re-processes without raising.
    payment2 = process_payment(rider, period_from, period_to, processed_by="tester", force=True)
    assert payment2.pk is not None
    assert SalaryPayment.objects.filter(rider=rider, period_from=period_from, period_to=period_to).count() == 2


def test_process_payment_requires_notes_when_processed_differs():
    rider = RiderFactory(fleet_pilot=False, monthly_salary=Decimal("20000"))
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    _log(rider, vehicle, date(2026, 7, 1))

    with pytest.raises(ValueError):
        process_payment(
            rider, period_from, period_to, processed_by="tester",
            salary_processed=Decimal("999999"),
        )

    payment = process_payment(
        rider, period_from, period_to, processed_by="tester",
        salary_processed=Decimal("999999"), notes="manual override",
    )
    assert payment.salary_processed == Decimal("999999")
    assert payment.salary_difference == Decimal("999999") - payment.final_salary


def test_process_payment_marks_advances_applied_and_linked():
    rider = RiderFactory(fleet_pilot=False, monthly_salary=Decimal("30000"))
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    _log(rider, vehicle, date(2026, 7, 1))
    advance = SalaryAdvance.objects.create(rider=rider, date=date(2026, 7, 2), amount=Decimal("500"))

    payment = process_payment(rider, period_from, period_to, processed_by="tester")

    advance.refresh_from_db()
    assert advance.applied_at is not None
    assert advance.salary_payment_id == payment.pk


def test_void_payment_unapplies_advances_and_deletes_payment():
    rider = RiderFactory(fleet_pilot=False, monthly_salary=Decimal("30000"))
    vehicle = VehicleFactory()
    period_from, period_to = date(2026, 7, 1), date(2026, 7, 10)
    _log(rider, vehicle, date(2026, 7, 1))
    advance = SalaryAdvance.objects.create(rider=rider, date=date(2026, 7, 2), amount=Decimal("500"))
    payment = process_payment(rider, period_from, period_to, processed_by="tester")

    void_payment(payment)

    advance.refresh_from_db()
    assert advance.applied_at is None
    assert advance.salary_payment_id is None
    assert not SalaryPayment.objects.filter(pk=payment.pk).exists()
