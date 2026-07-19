"""Dashboard and performance aggregations (read-only reporting)."""

from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Avg, Count, Sum

from apps.fleet.models import Vehicle
from apps.riders.models import Rider

from .models import Attendance, DailyLog

ZERO = Decimal("0")


def _pct_growth(current, previous):
    """Percent change vs the previous period; None when there is no baseline."""
    if not previous:
        return None
    return round((float(current or 0) - float(previous)) / float(previous) * 100, 1)


def dashboard_summary():
    today = date.today()
    month_start = today.replace(day=1)
    logs = DailyLog.objects.filter(is_draft=False)
    today_agg = logs.filter(english_date=today).aggregate(
        rides=Sum("rides_completed"), income=Sum("total_income"))
    month_agg = logs.filter(english_date__gte=month_start).aggregate(
        rides=Sum("rides_completed"), income=Sum("total_income"))
    return {
        "vehicles": {
            "total": Vehicle.objects.count(),
            "active": Vehicle.objects.filter(status=Vehicle.Status.ACTIVE).count(),
            "maintenance": Vehicle.objects.filter(status=Vehicle.Status.MAINTENANCE).count(),
        },
        "riders": {
            "total": Rider.objects.count(),
            "active": Rider.objects.filter(status=Rider.Status.ACTIVE).count(),
        },
        "today": {"rides": today_agg["rides"] or 0, "income": today_agg["income"] or ZERO},
        "month": {"rides": month_agg["rides"] or 0, "income": month_agg["income"] or ZERO},
    }


def fleet_stats(date_from=None, date_to=None):
    logs = DailyLog.objects.filter(is_draft=False)
    if date_from:
        logs = logs.filter(english_date__gte=date_from)
    if date_to:
        logs = logs.filter(english_date__lte=date_to)

    daily = (
        logs.values("english_date")
        .annotate(rides=Sum("rides_completed"), income=Sum("total_income"),
                  vehicles=Count("vehicle", distinct=True))
        .order_by("english_date")
    )
    agg = logs.aggregate(rides=Sum("rides_completed"), income=Sum("total_income"),
                         days=Count("english_date", distinct=True))

    growth = None
    if date_from and date_to:
        d_from, d_to = date.fromisoformat(str(date_from)), date.fromisoformat(str(date_to))
        span = (d_to - d_from).days + 1
        prev = DailyLog.objects.filter(
            is_draft=False,
            english_date__gte=d_from - timedelta(days=span),
            english_date__lte=d_from - timedelta(days=1),
        ).aggregate(rides=Sum("rides_completed"), income=Sum("total_income"))
        growth = {
            "income": _pct_growth(agg["income"], prev["income"]),
            "rides": _pct_growth(agg["rides"], prev["rides"]),
        }

    return {
        "total_rides": agg["rides"] or 0,
        "total_income": agg["income"] or ZERO,
        "days": agg["days"] or 0,
        "daily": list(daily),
        "growth": growth,
    }


def rider_dashboard(rider):
    logs = DailyLog.objects.filter(rider=rider, is_draft=False)
    agg = logs.aggregate(rides=Sum("rides_completed"), income=Sum("total_income"), days=Count("id"))
    attendance = (
        Attendance.objects.filter(rider=rider).values("type").annotate(count=Count("id"))
    )
    return {
        "rider": str(rider.uuid),
        "rider_name": rider.full_name,
        "lifetime": {"rides": agg["rides"] or 0, "income": agg["income"] or ZERO, "days": agg["days"] or 0},
        "attendance": {row["type"]: row["count"] for row in attendance},
    }


def vehicle_dashboard(vehicle):
    logs = DailyLog.objects.filter(vehicle=vehicle, is_draft=False)
    agg = logs.aggregate(rides=Sum("rides_completed"), income=Sum("total_income"), days=Count("id"))
    return {
        "vehicle": str(vehicle.uuid),
        "vehicle_number": vehicle.vehicle_number,
        "lifetime": {"rides": agg["rides"] or 0, "income": agg["income"] or ZERO, "days": agg["days"] or 0},
    }


# --- Performance ------------------------------------------------------------

def _tier(avg_rides):
    if avg_rides >= 25:
        return "A+"
    if avg_rides >= 22:
        return "A"
    if avg_rides >= 18:
        return "B"
    if avg_rides >= 15:
        return "C"
    return "D"


def performance_report(date_from=None, date_to=None):
    riders = Rider.objects.filter(status=Rider.Status.ACTIVE)
    logs = DailyLog.objects.filter(is_draft=False)
    if date_from:
        logs = logs.filter(english_date__gte=date_from)
    if date_to:
        logs = logs.filter(english_date__lte=date_to)

    by_rider = {}
    for log in logs.select_related("rider"):
        by_rider.setdefault(log.rider_id, []).append(log)

    rows = []
    for rider in riders:
        rider_logs = by_rider.get(rider.pk, [])
        days = len(rider_logs)
        rides = sum(l.rides_completed or 0 for l in rider_logs)
        revenue = sum((l.total_income or ZERO) for l in rider_logs)
        avg_rides = rides / days if days else 0

        # A day is fraud-evaluable when Yango set a bonus target; fraud = the
        # target was hit but Yango paid no goal bonus.
        evaluable = [l for l in rider_logs if (l.daily_bonus_set or 0) > 0]
        fraud_days = [
            l for l in evaluable
            if (l.rides_completed or 0) >= l.daily_bonus_set and not (l.goal_bonus or ZERO)
        ]
        target_days = [
            l for l in rider_logs
            if (l.daily_bonus_set or rider.daily_ride_target)
        ]
        target_hits = [
            l for l in target_days
            if (l.rides_completed or 0) >= (l.daily_bonus_set or rider.daily_ride_target)
        ]
        variance_days = [l for l in rider_logs if (l.cash_check or ZERO) > 0]

        acceptance_rates = []
        for l in rider_logs:
            try:
                acceptance_rates.append(float(str(l.acceptance_rate).rstrip("%")))
            except (TypeError, ValueError):
                continue
        avg_acceptance = sum(acceptance_rates) / len(acceptance_rates) if acceptance_rates else None

        flags = []
        if avg_acceptance is not None and avg_acceptance < 70:
            flags.append("low_acceptance")
        hit_rate = len(target_hits) / len(target_days) if target_days else None
        if hit_rate is not None and hit_rate < 0.6:
            flags.append("volatile")
        if hit_rate is not None and hit_rate >= 0.8:
            flags.append("bonus_hunter")
        if days and len(variance_days) / days > 0.2:
            flags.append("cash_discipline")
        if fraud_days:
            flags.append("fraud_risk")

        rows.append({
            "rider": str(rider.uuid),
            "rider_name": rider.full_name,
            "days": days,
            "total_rides": rides,
            "total_revenue": revenue,
            "avg_rides_per_day": round(avg_rides, 2),
            "avg_revenue_per_day": round(float(revenue) / days, 2) if days else 0,
            "avg_acceptance": round(avg_acceptance, 1) if avg_acceptance is not None else None,
            "target_hit_rate": round(hit_rate * 100, 1) if hit_rate is not None else None,
            "fraud_days": len(fraud_days),
            "tier": _tier(avg_rides) if days else "Inactive",
            "flags": flags,
        })

    # Top quartile by avg revenue/day gets the high_earner flag.
    earners = sorted((r for r in rows if r["days"]), key=lambda r: r["avg_revenue_per_day"], reverse=True)
    for row in earners[: max(len(earners) // 4, 1) if earners else 0]:
        row["flags"].append("high_earner")

    tier_distribution = {}
    for row in rows:
        tier_distribution[row["tier"]] = tier_distribution.get(row["tier"], 0) + 1

    return {"riders": rows, "tier_distribution": tier_distribution}


def rider_performance_detail(rider, date_from=None, date_to=None):
    logs = DailyLog.objects.filter(rider=rider, is_draft=False).order_by("english_date")
    if date_from:
        logs = logs.filter(english_date__gte=date_from)
    if date_to:
        logs = logs.filter(english_date__lte=date_to)
    return [
        {
            "date": l.english_date,
            "rides_completed": l.rides_completed,
            "rides_received": l.total_rides_received,
            "target": l.daily_bonus_set or rider.daily_ride_target,
            "income": l.total_income,
            "goal_bonus": l.goal_bonus,
            "cash_check": l.cash_check,
            "acceptance_rate": l.acceptance_rate,
        }
        for l in logs
    ]
