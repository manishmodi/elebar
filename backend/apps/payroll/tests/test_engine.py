"""apps/payroll/engine.py — compute_day math, ramp tiers, lock_day gating,
streak advance/reset/bonus, recompute semantics, PayConfig.resolve."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.operations.models import Attendance, DailyLog
from apps.payroll.engine import compute_day, lock_day
from apps.payroll.models import PayConfig, PayRecord, Streak
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def _rider(tenure_days_before=30, **kwargs):
    """A fleet pilot whose joining_date puts `on_date` at the given tenure."""
    on_date = kwargs.pop("on_date", date(2026, 7, 13))
    joining = on_date - timedelta(days=tenure_days_before - 1)
    return RiderFactory(fleet_pilot=True, joining_date=joining, **kwargs), on_date


def _daily_log(rider, vehicle, on_date, rides=30, app_cash="4000", goal_bonus="0", promo="0", draft=False):
    return DailyLog.objects.create(
        rider=rider, vehicle=vehicle, english_date=on_date, is_draft=draft,
        rides_completed=rides, cash_as_per_app=Decimal(app_cash),
        goal_bonus=Decimal(goal_bonus), promotion_bonus_other=Decimal(promo),
    )


def _attendance(rider, vehicle, on_date, time_in="08:00", time_out="17:00"):
    return Attendance.objects.create(
        rider=rider, vehicle=vehicle, date=on_date,
        rider_time_in=time_in, rider_time_out=time_out,
    )


# --- compute_day: base/commission/prize/growth + revenue cap ----------------

def test_compute_day_full_breakdown_and_revenue_cap():
    rider, on_date = _rider(tenure_days_before=30)  # tenure >= 8 -> steady-state tier
    vehicle = VehicleFactory()
    log = _daily_log(rider, vehicle, on_date, rides=30, app_cash="4000")
    attendance = _attendance(rider, vehicle, on_date)  # 9 hours

    amounts, snapshot, gate_ok = compute_day(rider, log, attendance, on_date)

    assert amounts["base"] == Decimal("600")  # hours>=8 and rides>=22
    assert amounts["commission"] == Decimal("625.00")  # 0.20 * min(4000, 3125)
    assert amounts["growth"] == Decimal("350.00")  # 0.40 * (4000 - 3125)
    assert amounts["prize"] == Decimal("300")  # tier3 gate: rides>=28, cash>=2500
    assert amounts["daily_pay"] == Decimal("1875.00")
    assert gate_ok is True
    assert snapshot["gates"]["base_ok"] is True


def test_compute_day_base_fails_below_min_hours_or_rides():
    rider, on_date = _rider(tenure_days_before=30)
    vehicle = VehicleFactory()
    log = _daily_log(rider, vehicle, on_date, rides=10, app_cash="500")
    attendance = _attendance(rider, vehicle, on_date, time_in="08:00", time_out="12:00")  # 4h

    amounts, snapshot, gate_ok = compute_day(rider, log, attendance, on_date)

    assert amounts["base"] == Decimal("0")
    assert snapshot["gates"]["base_ok"] is False
    assert gate_ok is False  # rides/cash below every tier's gate


def test_compute_day_no_growth_below_revenue_cap():
    rider, on_date = _rider(tenure_days_before=30)
    vehicle = VehicleFactory()
    log = _daily_log(rider, vehicle, on_date, rides=30, app_cash="2000")
    attendance = _attendance(rider, vehicle, on_date)

    amounts, _, _ = compute_day(rider, log, attendance, on_date)

    assert amounts["growth"] == Decimal("0")
    assert amounts["commission"] == Decimal("400.00")  # 0.20 * 2000


# --- ramp tier by tenure -------------------------------------------------

@pytest.mark.parametrize(
    "tenure_days,expected_from_day",
    [(1, 1), (3, 1), (4, 4), (7, 4), (8, 8), (30, 8)],
)
def test_ramp_tier_selected_by_tenure_day(tenure_days, expected_from_day):
    rider, on_date = _rider(tenure_days_before=tenure_days)
    vehicle = VehicleFactory()
    log = _daily_log(rider, vehicle, on_date, rides=30, app_cash="4000")
    attendance = _attendance(rider, vehicle, on_date)

    _, snapshot, _ = compute_day(rider, log, attendance, on_date)

    assert snapshot["inputs"]["tenure_tier"]["from_day"] == expected_from_day


# --- lock_day: gating -----------------------------------------------------

def test_lock_day_noop_for_draft_daily_log():
    rider, on_date = _rider()
    vehicle = VehicleFactory()
    _daily_log(rider, vehicle, on_date, draft=True)
    _attendance(rider, vehicle, on_date)

    assert lock_day(rider, on_date) is None
    assert not PayRecord.objects.filter(rider=rider, english_date=on_date).exists()


def test_lock_day_noop_for_non_fleet_pilot():
    rider = RiderFactory(fleet_pilot=False)
    vehicle = VehicleFactory()
    on_date = date(2026, 7, 13)
    _daily_log(rider, vehicle, on_date)
    _attendance(rider, vehicle, on_date)

    assert lock_day(rider, on_date) is None
    assert not PayRecord.objects.filter(rider=rider, english_date=on_date).exists()


def test_lock_day_noop_when_fleet_disabled():
    rider, on_date = _rider()
    vehicle = VehicleFactory()
    _daily_log(rider, vehicle, on_date)
    _attendance(rider, vehicle, on_date)
    PayConfig.objects.create(
        parameter=PayConfig.Parameter.FLEET_ENABLED, value="false", effective_from=date(2026, 1, 1)
    )

    assert lock_day(rider, on_date) is None


def test_lock_day_noop_without_confirmed_daily_log():
    rider, on_date = _rider()
    vehicle = VehicleFactory()
    _attendance(rider, vehicle, on_date)

    assert lock_day(rider, on_date) is None


def test_lock_day_locks_and_computes_amounts():
    rider, on_date = _rider(tenure_days_before=30)
    vehicle = VehicleFactory()
    _daily_log(rider, vehicle, on_date, rides=30, app_cash="4000")
    _attendance(rider, vehicle, on_date)

    record = lock_day(rider, on_date)

    assert record.status == PayRecord.Status.LOCKED
    assert record.daily_pay == Decimal("1875.00")
    assert record.locked_at is not None


# --- streak advance / gap reset / non-qualify reset / bonus payout ----------

# Working-day run (Saturday excepted): Mon 7/6, Tue 7/7, Wed 7/8, Thu 7/9,
# Fri 7/10, [Sat 7/11 skipped], Sun 7/12, Mon 7/13 -- 7 consecutive working
# days ending 7/13 where the streak (length 7) should complete and pay out.
STREAK_DAYS = [
    date(2026, 7, 6), date(2026, 7, 7), date(2026, 7, 8), date(2026, 7, 9),
    date(2026, 7, 10), date(2026, 7, 12), date(2026, 7, 13),
]


def _qualifying_rider(vehicle):
    # Steady-state tier: gate_rides=28, gate_cash=2500.
    rider, _ = _rider(tenure_days_before=60, on_date=STREAK_DAYS[0])
    return rider


def test_streak_advances_across_saturday_off_friday_to_sunday():
    vehicle = VehicleFactory()
    rider = _qualifying_rider(vehicle)

    for d in STREAK_DAYS[:5]:  # Mon..Fri
        _daily_log(rider, vehicle, d, rides=30, app_cash="3000")
        _attendance(rider, vehicle, d)
        lock_day(rider, d)

    streak = Streak.objects.get(rider=rider)
    assert streak.current_streak == 5
    assert streak.last_qualifying_date == STREAK_DAYS[4]  # Friday

    # Sunday continues the streak (Saturday is a scheduled off, not a gap).
    sunday = STREAK_DAYS[5]
    _daily_log(rider, vehicle, sunday, rides=30, app_cash="3000")
    _attendance(rider, vehicle, sunday)
    lock_day(rider, sunday)

    streak.refresh_from_db()
    assert streak.current_streak == 6
    assert streak.last_qualifying_date == sunday


def test_streak_bonus_pays_at_length_seven_then_resets():
    vehicle = VehicleFactory()
    rider = _qualifying_rider(vehicle)

    for d in STREAK_DAYS[:6]:
        _daily_log(rider, vehicle, d, rides=30, app_cash="3000")
        _attendance(rider, vehicle, d)
        lock_day(rider, d)

    streak = Streak.objects.get(rider=rider)
    assert streak.current_streak == 6

    seventh = STREAK_DAYS[6]
    _daily_log(rider, vehicle, seventh, rides=30, app_cash="3000")
    _attendance(rider, vehicle, seventh)
    record = lock_day(rider, seventh)

    streak.refresh_from_db()
    assert streak.current_streak == 0  # resets after paying out
    assert streak.best_streak == 7
    assert record.flags["streakCount"] == 0
    assert record.flags["streakBonus"] == "500"
    # daily_pay includes both the day's own pay and the streak bonus.
    day_pay = record.base + record.commission + record.prize + record.growth
    assert record.daily_pay == day_pay + Decimal("500")


def test_streak_gap_resets_count_to_one():
    vehicle = VehicleFactory()
    rider = _qualifying_rider(vehicle)

    mon, tue, thu = STREAK_DAYS[0], STREAK_DAYS[1], STREAK_DAYS[3]
    for d in (mon, tue):
        _daily_log(rider, vehicle, d, rides=30, app_cash="3000")
        _attendance(rider, vehicle, d)
        lock_day(rider, d)

    streak = Streak.objects.get(rider=rider)
    assert streak.current_streak == 2

    # Wednesday skipped entirely -> Thursday is a gap, not consecutive.
    _daily_log(rider, vehicle, thu, rides=30, app_cash="3000")
    _attendance(rider, vehicle, thu)
    lock_day(rider, thu)

    streak.refresh_from_db()
    assert streak.current_streak == 1
    assert streak.last_qualifying_date == thu


def test_streak_non_qualifying_day_resets_to_zero():
    vehicle = VehicleFactory()
    rider = _qualifying_rider(vehicle)

    mon, tue = STREAK_DAYS[0], STREAK_DAYS[1]
    _daily_log(rider, vehicle, mon, rides=30, app_cash="3000")
    _attendance(rider, vehicle, mon)
    lock_day(rider, mon)

    streak = Streak.objects.get(rider=rider)
    assert streak.current_streak == 1

    # Tuesday: rides/cash below every tier's gate -> non-qualifying day.
    _daily_log(rider, vehicle, tue, rides=1, app_cash="0")
    _attendance(rider, vehicle, tue)
    lock_day(rider, tue)

    streak.refresh_from_db()
    assert streak.current_streak == 0


def test_out_of_order_lock_never_advances_streak():
    vehicle = VehicleFactory()
    rider = _qualifying_rider(vehicle)

    day1, day2, day3 = STREAK_DAYS[0], STREAK_DAYS[1], STREAK_DAYS[2]
    for d in (day1, day2, day3):
        _daily_log(rider, vehicle, d, rides=30, app_cash="3000")
        _attendance(rider, vehicle, d)
        lock_day(rider, d)

    streak = Streak.objects.get(rider=rider)
    assert streak.current_streak == 3
    assert streak.last_qualifying_date == day3

    # A replayed/out-of-order approval lands on an earlier date whose
    # PayRecord has never been locked before (first_lock=True at the record
    # level) but the streak's own guard (on_date <= last) must still refuse
    # to move it.
    earlier = day1 - timedelta(days=30)
    _daily_log(rider, vehicle, earlier, rides=30, app_cash="3000")
    _attendance(rider, vehicle, earlier)
    lock_day(rider, earlier)

    streak.refresh_from_db()
    assert streak.current_streak == 3
    assert streak.last_qualifying_date == day3


def test_recompute_preserves_streak_bonus_and_does_not_readvance():
    vehicle = VehicleFactory()
    rider = _qualifying_rider(vehicle)

    for d in STREAK_DAYS:
        _daily_log(rider, vehicle, d, rides=30, app_cash="3000")
        _attendance(rider, vehicle, d)
        lock_day(rider, d)

    streak = Streak.objects.get(rider=rider)
    assert streak.current_streak == 0  # paid out on day 7

    record = PayRecord.objects.get(rider=rider, english_date=STREAK_DAYS[-1])
    original_daily_pay = record.daily_pay
    assert record.flags["streakBonus"] == "500"

    # Admin corrects the day's log (higher app cash) -> recompute; the base
    # pay components must reflect the new inputs, but the streak bonus stays.
    log = DailyLog.objects.get(rider=rider, english_date=STREAK_DAYS[-1])
    log.cash_as_per_app = Decimal("5000")
    log.save()
    record2 = lock_day(rider, STREAK_DAYS[-1])

    record2.refresh_from_db()
    streak.refresh_from_db()
    assert record2.flags.get("recomputed") is True
    assert record2.flags["streakBonus"] == "500"  # preserved, not re-derived
    new_components = record2.base + record2.commission + record2.prize + record2.growth
    assert record2.daily_pay == new_components + Decimal("500")
    assert record2.daily_pay != original_daily_pay  # inputs actually changed the pay
    assert streak.current_streak == 0  # not advanced a second time


# --- PayConfig.resolve --------------------------------------------------------

def test_payconfig_resolve_picks_latest_effective_on_or_before_date():
    PayConfig.objects.create(
        parameter=PayConfig.Parameter.BASE_AMOUNT, value="600", effective_from=date(2026, 1, 1)
    )
    PayConfig.objects.create(
        parameter=PayConfig.Parameter.BASE_AMOUNT, value="700", effective_from=date(2026, 6, 1)
    )

    assert PayConfig.resolve(PayConfig.Parameter.BASE_AMOUNT, date(2026, 3, 1)) == "600"
    assert PayConfig.resolve(PayConfig.Parameter.BASE_AMOUNT, date(2026, 6, 1)) == "700"
    assert PayConfig.resolve(PayConfig.Parameter.BASE_AMOUNT, date(2026, 12, 31)) == "700"
    assert PayConfig.resolve(PayConfig.Parameter.BASE_AMOUNT, date(2025, 1, 1)) is None
