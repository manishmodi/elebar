"""
Rider auto-targeting engine.

The legacy schema shipped rider_daily_targets / rider_ride_stats /
rider_target_overrides tables but no code ever computed them; this module
implements the documented spec (a pure rule + a thin nightly orchestrator):

For each active rider, tomorrow's target is derived from the trailing 7
calendar days of ride counts (confirmed DailyLog rows win; RiderRideStats
fills days with no confirmed log):

- tier "new"  : fewer than 7 working days since joining_date (working days
                exclude Saturdays — the Nepali weekend). Target is the
                rider's own daily_ride_target, else 22.
- tier "A"    : 7-day average >= 25  -> calculated = ceil(avg) + 2
- tier "B"    : 7-day average >= 18  -> calculated = ceil(avg) + 1
- tier "C"    : otherwise            -> calculated = ceil(avg) + 0
- final_target = HR override for the date (RiderTargetOverride.to_target)
                 if one exists, else calculated_target.
- needs_hr_review when the target would DROP by more than 5 versus the
  rider's previous computed target.

Established riders (>= 7 working days) with NO ride data in the window are
skipped — the spec computes "for each active rider with ride stats", and
there is nothing to average. (Spec ambiguity noted: they get no row rather
than an invented default.)

RiderDailyTarget also carries tier_c_streak / improvement_streak /
tier_c_accel columns from the legacy schema; the documented spec does not
define their computation, so they keep their defaults (0 / False).
"""

import logging
import math
from dataclasses import dataclass
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)

#: Fallback target for tier-"new" riders without a personal daily_ride_target.
DEFAULT_NEW_TARGET = 22
#: Working-day threshold below which a rider is tier "new".
NEW_RIDER_WORKING_DAYS = 7
#: 7-day-average thresholds for tiers A and B.
TIER_A_MIN_AVG = 25
TIER_B_MIN_AVG = 18
#: Tier adjustments added on top of ceil(avg).
TIER_ADJUSTMENTS = {"A": 2, "B": 1, "C": 0, "new": 0}
#: A drop of MORE than this many rides vs the previous target flags HR review.
HR_REVIEW_DROP_THRESHOLD = 5
#: Trailing window (calendar days) for the ride average.
AVERAGE_WINDOW_DAYS = 7

SATURDAY = 5  # date.weekday() — the Nepali weekend day


def working_days_between(start, end):
    """Number of working days (non-Saturdays) in [start, end)."""
    if start is None or start >= end:
        return 0
    count = 0
    day = start
    while day < end:
        if day.weekday() != SATURDAY:
            count += 1
        day += timedelta(days=1)
    return count


@dataclass(frozen=True)
class TargetComputation:
    working_day_count: int
    avg_7day: str  # "23.4", or "" when no average applies (tier "new")
    tier: str  # "new" | "A" | "B" | "C"
    tier_adj: int
    calculated_target: int
    final_target: int
    needs_hr_review: bool


def compute_target(
    *,
    target_date,
    joining_date,
    default_target,
    daily_rides,
    previous_final_target,
    override_target,
):
    """Pure targeting rule for one rider — deterministic and unit-testable.

    Args:
        target_date: the date the target is FOR.
        joining_date: rider's joining date (may be None).
        default_target: rider.daily_ride_target (may be None).
        daily_rides: {date: rides_completed} covering (at most) the 7 calendar
            days before target_date; days absent from the mapping had no data.
        previous_final_target: the rider's most recent final_target before
            target_date, or None.
        override_target: RiderTargetOverride.to_target for target_date, or None.

    Returns a TargetComputation, or None when no target can be computed
    (established rider with no ride data in the window).
    """
    window = [target_date - timedelta(days=offset) for offset in range(1, AVERAGE_WINDOW_DAYS + 1)]
    counts = [daily_rides[day] for day in window if day in daily_rides]

    working_day_count = working_days_between(joining_date, target_date)
    is_new = joining_date is None or working_day_count < NEW_RIDER_WORKING_DAYS

    if is_new:
        tier = "new"
        average = None
        calculated = int(default_target or DEFAULT_NEW_TARGET)
    else:
        if not counts:
            return None
        # Average over days WITH data (working days off don't drag it down).
        average = sum(counts) / len(counts)
        if average >= TIER_A_MIN_AVG:
            tier = "A"
        elif average >= TIER_B_MIN_AVG:
            tier = "B"
        else:
            tier = "C"
        calculated = math.ceil(average) + TIER_ADJUSTMENTS[tier]

    final = int(override_target) if override_target is not None else calculated
    needs_hr_review = (
        previous_final_target is not None
        and (previous_final_target - final) > HR_REVIEW_DROP_THRESHOLD
    )
    return TargetComputation(
        working_day_count=working_day_count,
        avg_7day=f"{average:.1f}" if average is not None else "",
        tier=tier,
        tier_adj=TIER_ADJUSTMENTS[tier],
        calculated_target=calculated,
        final_target=final,
        needs_hr_review=needs_hr_review,
    )


def compute_targets_for_date(target_date):
    """Thin orchestrator: gather inputs in bulk, run the pure rule per active
    rider, and update_or_create RiderDailyTarget rows. Returns summary counts."""
    from apps.riders.models import Rider

    from .models import DailyLog, RiderDailyTarget, RiderRideStats, RiderTargetOverride

    window_start = target_date - timedelta(days=AVERAGE_WINDOW_DAYS)
    summary = {"date": target_date.isoformat(), "computed": 0, "skipped": 0, "hr_review": 0}

    riders = list(Rider.objects.filter(status=Rider.Status.ACTIVE))
    rider_ids = [r.id for r in riders]

    # Trailing ride counts: RiderRideStats first, then confirmed DailyLog rows
    # override (confirmed data wins over pulled stats).
    daily_rides = {rider_id: {} for rider_id in rider_ids}
    stats_rows = RiderRideStats.objects.filter(
        rider_id__in=rider_ids, date__gte=window_start, date__lt=target_date
    ).values_list("rider_id", "date", "rides_completed")
    for rider_id, day, rides in stats_rows:
        daily_rides[rider_id][day] = rides
    log_rows = DailyLog.objects.filter(
        rider_id__in=rider_ids, is_draft=False,
        english_date__gte=window_start, english_date__lt=target_date,
        rides_completed__isnull=False,
    ).values_list("rider_id", "english_date", "rides_completed")
    for rider_id, day, rides in log_rows:
        daily_rides[rider_id][day] = rides

    overrides = dict(
        RiderTargetOverride.objects.filter(rider_id__in=rider_ids, date=target_date)
        .values_list("rider_id", "to_target")
    )

    # Most recent prior final_target per rider (ascending order: last wins).
    previous_targets = {}
    prior_rows = (
        RiderDailyTarget.objects.filter(rider_id__in=rider_ids, date__lt=target_date)
        .order_by("date")
        .values_list("rider_id", "final_target")
    )
    for rider_id, final in prior_rows:
        previous_targets[rider_id] = final

    now = timezone.now()
    for rider in riders:
        computation = compute_target(
            target_date=target_date,
            joining_date=rider.joining_date,
            default_target=rider.daily_ride_target,
            daily_rides=daily_rides.get(rider.id, {}),
            previous_final_target=previous_targets.get(rider.id),
            override_target=overrides.get(rider.id),
        )
        if computation is None:
            summary["skipped"] += 1
            continue
        RiderDailyTarget.objects.update_or_create(
            rider=rider,
            date=target_date,
            defaults={
                "working_day_count": computation.working_day_count,
                "avg_7day": computation.avg_7day,
                "tier": computation.tier,
                "tier_adj": computation.tier_adj,
                "calculated_target": computation.calculated_target,
                "final_target": computation.final_target,
                "needs_hr_review": computation.needs_hr_review,
                "computed_at": now,
            },
        )
        summary["computed"] += 1
        if computation.needs_hr_review:
            summary["hr_review"] += 1

    logger.info(
        "[Targeting] %s — computed: %d, skipped: %d, hr_review: %d",
        target_date, summary["computed"], summary["skipped"], summary["hr_review"],
    )
    return summary
