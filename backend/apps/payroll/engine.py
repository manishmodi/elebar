"""
Variable Pay Engine (Pay Model v2) for fleet-pilot riders.

daily_pay = base + commission + prize + growth (+ streak bonus on the day a
streak completes).

- base:       base_amount if hours >= base_min_hours AND rides >= base_min_rides
- commission: commission_rate * min(revenue, revenue_cap)
- prize:      ramp-tier prize if rides >= gate_rides AND app_cash >= gate_cash
- growth:     growth_rate * max(revenue - revenue_cap, 0)
- revenue:    app_cash + goal_bonus + promo_bonus

Every parameter is versioned in PayConfig and resolved as-of the pay day, so
historical recomputes are stable. A day's record is computed+locked when
finance approves the day's cash collection; the streak advances only on FIRST
lock (recomputes preserve the originally-awarded bonus).
"""

import json
import logging
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import ActivityLog, log_activity

from .models import PayConfig, PayRecord, Streak

logger = logging.getLogger(__name__)

DEFAULT_PARAMS = {
    "fleet_enabled": "true",
    "base_amount": "600",
    "base_min_hours": "8",
    "base_min_rides": "22",
    "commission_rate": "0.20",
    "revenue_cap": "3125",
    "growth_rate": "0.40",
    "ramp": json.dumps([
        {"from_day": 1, "to_day": 3, "gate_rides": 17, "gate_cash": 1500, "prize": 200},
        {"from_day": 4, "to_day": 7, "gate_rides": 22, "gate_cash": 2000, "prize": 250},
        {"from_day": 8, "to_day": None, "gate_rides": 28, "gate_cash": 2500, "prize": 300},
    ]),
    "streak_length": "7",
    "streak_bonus": "500",
    "monthly_floor": "17500",
}


def resolve_param(parameter, on_date):
    value = PayConfig.resolve(parameter, on_date)
    return value if value is not None else DEFAULT_PARAMS.get(parameter)


def _decimal(value, fallback="0"):
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(fallback)


def _shift_hours(attendance):
    """Worked hours from the guard-verified rider_time_in/out (HH:MM)."""
    if not attendance or not attendance.rider_time_in or not attendance.rider_time_out:
        return Decimal("0")
    try:
        t_in = datetime.strptime(attendance.rider_time_in[:5], "%H:%M")
        t_out = datetime.strptime(attendance.rider_time_out[:5], "%H:%M")
    except ValueError:
        return Decimal("0")
    delta = t_out - t_in
    if delta.total_seconds() < 0:  # overnight shift
        delta += timedelta(days=1)
    return Decimal(delta.total_seconds()) / Decimal(3600)


def _tenure_day(rider, on_date):
    if rider.joining_date:
        return max((on_date - rider.joining_date).days + 1, 1)
    return 8  # unknown tenure -> steady-state ramp tier


def _ramp_tier(ramp, tenure_day):
    for tier in ramp:
        to_day = tier.get("to_day")
        if tier["from_day"] <= tenure_day and (to_day is None or tenure_day <= to_day):
            return tier
    return ramp[-1]


def compute_day(rider, daily_log, attendance, on_date):
    """Pure computation of one rider-day. Returns (amounts, snapshot)."""
    cfg = {p: resolve_param(p, on_date) for p in DEFAULT_PARAMS}
    ramp = json.loads(cfg["ramp"])

    rides = daily_log.rides_completed or 0
    app_cash = _decimal(daily_log.cash_as_per_app)
    revenue = app_cash + _decimal(daily_log.goal_bonus) + _decimal(daily_log.promotion_bonus_other)
    hours = _shift_hours(attendance)

    base_amount = _decimal(cfg["base_amount"])
    base_ok = hours >= _decimal(cfg["base_min_hours"]) and rides >= int(cfg["base_min_rides"])
    base = base_amount if base_ok else Decimal("0")

    cap = _decimal(cfg["revenue_cap"])
    commission = (_decimal(cfg["commission_rate"]) * min(revenue, cap)).quantize(Decimal("0.01"))

    tier = _ramp_tier(ramp, _tenure_day(rider, on_date))
    gate_ok = rides >= tier["gate_rides"] and app_cash >= _decimal(tier["gate_cash"])
    prize = _decimal(tier["prize"]) if gate_ok else Decimal("0")

    growth = (_decimal(cfg["growth_rate"]) * max(revenue - cap, Decimal("0"))).quantize(Decimal("0.01"))

    amounts = {
        "base": base,
        "commission": commission,
        "prize": prize,
        "growth": growth,
        "daily_pay": base + commission + prize + growth,
    }
    snapshot = {
        "config": cfg,
        "inputs": {
            "rides": rides,
            "hours": str(hours.quantize(Decimal("0.01"))),
            "app_cash": str(app_cash),
            "revenue": str(revenue),
            "tenure_tier": tier,
        },
        "gates": {"base_ok": base_ok, "prize_gate_ok": gate_ok},
    }
    return amounts, snapshot, gate_ok


@transaction.atomic
def lock_day(rider, on_date, actor=None):
    """Compute and lock the pay record for a rider-day. Called when finance
    approves the day's cash collection, or re-run when a locked day's inputs
    are edited by an admin. Idempotent; no-op for non-pilots and drafts."""
    from apps.operations.models import Attendance, DailyLog

    if not rider.fleet_pilot:
        return None
    if resolve_param("fleet_enabled", on_date) != "true":
        return None

    daily_log = DailyLog.objects.filter(rider=rider, english_date=on_date, is_draft=False).first()
    if daily_log is None:
        return None
    attendance = Attendance.objects.filter(rider=rider, date=on_date).first()

    amounts, snapshot, gate_ok = compute_day(rider, daily_log, attendance, on_date)

    record, created = PayRecord.objects.select_for_update().get_or_create(
        rider=rider,
        english_date=on_date,
        defaults={"status": PayRecord.Status.COMPUTED},
    )
    # A record that was ever locked keeps its streak flags — re-locking after a
    # disapproval (or recomputing) must never advance the streak a second time.
    first_lock = (
        record.status != PayRecord.Status.LOCKED
        and "streakCount" not in (record.flags or {})
    )

    flags = dict(record.flags or {})
    streak_bonus = Decimal("0")
    if first_lock:
        streak_bonus, streak_count = _advance_streak(rider, on_date, gate_ok)
        flags.update({"gatesHit": gate_ok, "streakCount": streak_count,
                      "streakBonus": str(streak_bonus)})
    else:
        # Recompute: preserve the originally-awarded streak bonus.
        streak_bonus = _decimal(flags.get("streakBonus", "0"))
        old = {"daily_pay": str(record.daily_pay)}
        flags["recomputed"] = True
        flags["streakNotRecomputed"] = True
        log_activity(actor, ActivityLog.Action.UPDATED, "salary",
                     f"Recomputed pay for rider {rider.full_name} {on_date}: "
                     f"{old['daily_pay']} -> {amounts['daily_pay'] + streak_bonus}")

    now = timezone.now()
    record.base = amounts["base"]
    record.commission = amounts["commission"]
    record.prize = amounts["prize"]
    record.growth = amounts["growth"]
    record.daily_pay = amounts["daily_pay"] + streak_bonus
    record.gates_applied = snapshot
    record.flags = flags
    record.status = PayRecord.Status.LOCKED
    record.computed_at = record.computed_at or now
    record.locked_at = record.locked_at or now
    record.save()
    return record


def _next_working_day(day):
    """The day after `day`, skipping the Saturday weekly off."""
    following = day + timedelta(days=1)
    if following.weekday() == 5:
        following += timedelta(days=1)
    return following


def _advance_streak(rider, on_date, gate_ok):
    """Advance/break the qualifying-day streak; returns (bonus, count).

    Streaks are CALENDAR-consecutive (Saturdays excepted), not approval-order:
    a day only extends the streak if it directly follows the last qualifying
    day. Locks arriving for a date at or before the last qualifying day are
    replays/out-of-order approvals and never move the streak."""
    streak, _ = Streak.objects.select_for_update().get_or_create(rider=rider)
    bonus = Decimal("0")

    last = streak.last_qualifying_date
    if last and on_date <= last:
        return bonus, streak.current_streak

    if gate_ok:
        if last and on_date == _next_working_day(last):
            streak.current_streak += 1
        else:
            streak.current_streak = 1  # gap in the calendar — start over
        streak.last_qualifying_date = on_date
        streak.best_streak = max(streak.best_streak, streak.current_streak)
        length = int(resolve_param("streak_length", on_date) or 7)
        if streak.current_streak >= length:
            bonus = _decimal(resolve_param("streak_bonus", on_date))
            streak.current_streak = 0  # streak resets after paying out
    else:
        streak.current_streak = 0
    streak.save()
    return bonus, streak.current_streak


def recompute_if_locked(rider, on_date, actor=None):
    """Hook for post-lock edits (admin attendance/daily-log corrections)."""
    if PayRecord.objects.filter(
        rider=rider, english_date=on_date, status=PayRecord.Status.LOCKED
    ).exists():
        lock_day(rider, on_date, actor=actor)
