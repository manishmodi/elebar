"""Rider aggregate stats for the Riders page KPI cards."""

from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, Sum

from apps.operations.models import DailyLog


def _period_aggregates(date_from, date_to):
    qs = DailyLog.objects.filter(is_draft=False)
    if date_from:
        qs = qs.filter(english_date__gte=date_from)
    if date_to:
        qs = qs.filter(english_date__lte=date_to)
    agg = qs.aggregate(
        total_rides=Sum("rides_completed"),
        total_income=Sum("total_income"),
        log_days=Count("id"),
    )
    log_days = agg["log_days"] or 0
    rides = agg["total_rides"] or 0
    income = agg["total_income"] or Decimal("0")
    return {
        "log_days": log_days,
        "total_rides": rides,
        "total_income": income,
        "avg_rides_per_day": round(rides / log_days, 2) if log_days else 0,
        "avg_income_per_day": round(float(income) / log_days, 2) if log_days else 0,
    }


def _growth(current, previous):
    if not previous:
        return None
    return round((float(current) - float(previous)) / float(previous) * 100, 1)


def rider_stats(date_from=None, date_to=None):
    current = _period_aggregates(date_from, date_to)

    prev = None
    if date_from and date_to:
        d_from, d_to = date.fromisoformat(str(date_from)), date.fromisoformat(str(date_to))
        span = (d_to - d_from).days + 1
        prev = _period_aggregates(d_from - timedelta(days=span), d_from - timedelta(days=1))

    return {
        **current,
        "growth": {
            "rides": _growth(current["total_rides"], prev["total_rides"]) if prev else None,
            "income": _growth(current["total_income"], prev["total_income"]) if prev else None,
        },
    }
