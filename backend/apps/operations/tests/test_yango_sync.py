"""Pure/offline coverage for the Yango integration — never hits the network.

apps.operations.yango.YangoClient raises YangoNotConfigured before any I/O
without YANGO_* env vars; every test here either exercises pure functions or
asserts requests.request is never called.
"""

from datetime import date, timedelta
from decimal import Decimal
from email.utils import format_datetime
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.operations import tasks, yango, yango_sync
from apps.operations.models import DailyLog
from apps.operations.targeting import compute_target, working_days_between
from apps.operations.yango import YangoClient, YangoNotConfigured, _parse_retry_after, reset_throttle
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _no_yango_env(monkeypatch):
    """Every test starts unconfigured unless it opts into fake credentials."""
    for key in ("YANGO_CLIENT_ID", "YANGO_PARK_ID", "YANGO_API_KEY", "YANGO_WORK_RULE_ID"):
        monkeypatch.delenv(key, raising=False)


# --- yango.py: credential auto-correction -----------------------------------

def _client(monkeypatch, client_id, park_id, api_key="dummy-key"):
    monkeypatch.setenv("YANGO_CLIENT_ID", client_id)
    monkeypatch.setenv("YANGO_PARK_ID", park_id)
    monkeypatch.setenv("YANGO_API_KEY", api_key)
    return YangoClient()


def test_swapped_client_and_park_ids_are_auto_corrected(monkeypatch):
    client = _client(monkeypatch, client_id="bare-park-uuid", park_id="taxi/park/actual-client")
    resolved_client_id, resolved_park_id = client._resolved_credentials()
    assert resolved_client_id == "taxi/park/actual-client"
    assert resolved_park_id == "bare-park-uuid"


def test_bare_client_id_gets_taxi_park_prefix(monkeypatch):
    client = _client(monkeypatch, client_id="bare-client-id", park_id="bare-park-id")
    resolved_client_id, resolved_park_id = client._resolved_credentials()
    assert resolved_client_id == "taxi/park/bare-client-id"
    assert resolved_park_id == "bare-park-id"


def test_over_prefixed_park_id_is_stripped(monkeypatch):
    client = _client(monkeypatch, client_id="taxi/park/good-client", park_id="taxi/park/over-prefixed")
    resolved_client_id, resolved_park_id = client._resolved_credentials()
    assert resolved_client_id == "taxi/park/good-client"
    assert resolved_park_id == "over-prefixed"


def test_already_well_formed_credentials_are_unchanged(monkeypatch):
    client = _client(monkeypatch, client_id="taxi/park/good-client", park_id="good-park-id")
    resolved_client_id, resolved_park_id = client._resolved_credentials()
    assert resolved_client_id == "taxi/park/good-client"
    assert resolved_park_id == "good-park-id"


# --- yango.py: throttle + Retry-After ----------------------------------------

def test_reset_throttle_restores_the_floor_interval():
    yango._interval = yango.MAX_INTERVAL
    reset_throttle()
    assert yango._interval == yango.MIN_INTERVAL


def test_parse_retry_after_numeric_seconds():
    assert _parse_retry_after("5") == 5.0


def test_parse_retry_after_none_header():
    assert _parse_retry_after(None) is None
    assert _parse_retry_after("") is None


def test_parse_retry_after_garbage_returns_none():
    assert _parse_retry_after("not-a-date-or-number") is None


def test_parse_retry_after_http_date_in_the_future():
    future = timezone.now() + timedelta(seconds=30)
    header = format_datetime(future, usegmt=True)
    seconds = _parse_retry_after(header)
    assert seconds is not None
    assert 0 <= seconds <= 31


# --- yango.py: unconfigured client never sends traffic -----------------------

def test_unconfigured_client_raises_before_any_request():
    client = YangoClient()
    assert client.configured is False
    with patch("apps.operations.yango.requests.request") as mocked:
        with pytest.raises(YangoNotConfigured):
            client.get_driver_profiles()
        with pytest.raises(YangoNotConfigured):
            client.get_orders_for_driver("driver-1", "2026-07-06T00:00:00+05:45", "2026-07-06T23:59:59+05:45")
    mocked.assert_not_called()


def test_get_supply_hours_reraises_not_configured():
    client = YangoClient()
    with patch("apps.operations.yango.requests.request") as mocked:
        with pytest.raises(YangoNotConfigured):
            client.get_supply_hours("driver-1", "2026-07-06", "2026-07-06")
    mocked.assert_not_called()


# --- yango_sync.py: pure aggregation ------------------------------------------

def test_aggregate_rider_day_returns_none_with_no_activity():
    assert yango_sync.aggregate_rider_day([], [], [], 0) is None


def test_aggregate_rider_day_computes_expected_figures():
    orders = [
        {"status": "complete", "mileage": 5000, "price": "150.00"},
        {"status": "complete", "mileage": 3000, "price": "100.00"},
        {"status": "cancelled", "mileage": 0, "price": "0"},
    ]
    transactions = [
        {"group_id": "cash_collected", "amount": "200.00"},
        {"group_id": "platform_promotion", "amount": "20.00"},
        {"group_id": "platform_bonus", "amount": "15.00", "order_id": "order-1"},
        # Same-day platform_bonus with NO order_id must NOT count as promo/other.
        {"group_id": "platform_bonus", "amount": "999.00"},
    ]
    next_day_transactions = [
        {"group_id": "platform_bonus", "amount": "50.00"},  # batch goal payout, no order_id
        {"group_id": "platform_bonus", "amount": "30.00", "order_id": "order-2"},  # per-trip, not goal
    ]

    figures = yango_sync.aggregate_rider_day(orders, transactions, next_day_transactions, 5400)

    assert figures["rides_completed"] == 2
    assert figures["total_rides_received"] == 3
    assert figures["acceptance_rate"] == "66.7"
    assert figures["total_ride_distance_km"] == "8.00"  # (5000+3000)/1000
    assert figures["total_income"] == Decimal("250.00")
    assert figures["cash_as_per_app"] == Decimal("200.00")
    assert figures["promotion_bonus_other"] == Decimal("35.00")  # 20 + 15 (per-trip bonus)
    assert figures["goal_bonus"] == Decimal("50.00")  # only the next-day no-order_id entry
    assert figures["total_app_online"] == "1:30"


def test_aggregate_rider_day_present_with_supply_seconds_only():
    figures = yango_sync.aggregate_rider_day([], [], [], 1800)
    assert figures is not None
    assert figures["rides_completed"] == 0
    assert figures["total_rides_received"] == 0
    assert figures["acceptance_rate"] == ""


def test_format_supply_hours_zero_is_blank():
    assert yango_sync.format_supply_hours(0) == ""
    assert yango_sync.format_supply_hours(None) == ""


def test_format_supply_hours_formats_hmm():
    assert yango_sync.format_supply_hours(5400) == "1:30"


# --- yango_sync.py: draft-only persistence ------------------------------------

FIGURES = {
    "rides_completed": 12, "total_rides_received": 15, "acceptance_rate": "80.0",
    "total_ride_distance_km": "45.60", "total_income": Decimal("900.00"),
    "cash_as_per_app": Decimal("500.00"), "goal_bonus": Decimal("50.00"),
    "promotion_bonus_other": Decimal("10.00"), "total_app_online": "6:15",
}


def test_persist_never_overwrites_a_confirmed_daily_log():
    rider, vehicle = RiderFactory(), VehicleFactory()
    on_date = date(2026, 7, 6)
    confirmed = DailyLog.objects.create(
        rider=rider, vehicle=vehicle, english_date=on_date, is_draft=False,
        rides_completed=1, cash_as_per_app=Decimal("1.00"),
    )
    result = yango_sync._new_result(on_date)

    yango_sync._persist_rider_day(rider, on_date, FIGURES, result)

    confirmed.refresh_from_db()
    assert confirmed.rides_completed == 1
    assert confirmed.cash_as_per_app == Decimal("1.00")
    assert result["skipped"] == 1
    assert result["updated"] == 0 and result["created"] == 0


def test_persist_updates_an_existing_draft():
    rider, vehicle = RiderFactory(), VehicleFactory()
    on_date = date(2026, 7, 6)
    draft = DailyLog.objects.create(
        rider=rider, vehicle=vehicle, english_date=on_date, is_draft=True,
        rides_completed=1, cash_as_per_app=Decimal("1.00"),
    )
    result = yango_sync._new_result(on_date)

    yango_sync._persist_rider_day(rider, on_date, FIGURES, result)

    draft.refresh_from_db()
    assert draft.rides_completed == 12
    assert draft.cash_as_per_app == Decimal("500.00")
    assert draft.is_draft is True
    assert result["updated"] == 1


def test_persist_creates_new_draft_with_vehicle_fallback():
    rider = RiderFactory()  # no active assignment
    fallback_vehicle = VehicleFactory()
    on_date = date(2026, 7, 6)
    result = yango_sync._new_result(on_date)

    yango_sync._persist_rider_day(rider, on_date, FIGURES, result)

    log = DailyLog.objects.get(rider=rider, english_date=on_date)
    assert log.is_draft is True
    assert log.vehicle_id == fallback_vehicle.pk
    assert result["created"] == 1


def test_persist_skips_when_no_vehicle_available_at_all():
    rider = RiderFactory()
    on_date = date(2026, 7, 6)
    result = yango_sync._new_result(on_date)

    yango_sync._persist_rider_day(rider, on_date, FIGURES, result)

    assert not DailyLog.objects.filter(rider=rider, english_date=on_date).exists()
    assert result["skipped"] == 1
    assert result["errors"]


# --- yango_sync.py: preview job lifecycle in cache ----------------------------

def test_start_preview_job_runs_eagerly_to_done_with_no_linked_riders(monkeypatch):
    # No riders are linked, so preview_for_date makes zero Yango calls even
    # though the client reports configured (dummy credentials).
    monkeypatch.setenv("YANGO_CLIENT_ID", "cid")
    monkeypatch.setenv("YANGO_PARK_ID", "pid")
    monkeypatch.setenv("YANGO_API_KEY", "key")

    job, conflict = yango_sync.start_preview_job(date(2026, 7, 6))

    assert conflict is False
    assert job["status"] == "done"
    assert job["result"]["riders"] == []
    assert yango_sync.get_preview_job(job["id"])["status"] == "done"


def test_start_preview_job_attaches_to_running_job_same_date():
    running = {
        "id": "job-attach-1", "date": "2026-07-06", "status": "running",
        "total": 5, "completed": 2, "started_at": timezone.now().isoformat(),
    }
    yango_sync.save_preview_job(running)
    cache.set(yango_sync.PREVIEW_RUNNING_KEY, running["id"], yango_sync.PREVIEW_RUNNING_TTL)

    job, conflict = yango_sync.start_preview_job(date(2026, 7, 6))

    assert conflict is False
    assert job["id"] == "job-attach-1"


def test_start_preview_job_conflicts_on_a_different_date():
    running = {
        "id": "job-conflict-1", "date": "2026-07-06", "status": "running",
        "total": 5, "completed": 2, "started_at": timezone.now().isoformat(),
    }
    yango_sync.save_preview_job(running)
    cache.set(yango_sync.PREVIEW_RUNNING_KEY, running["id"], yango_sync.PREVIEW_RUNNING_TTL)

    job, conflict = yango_sync.start_preview_job(date(2026, 7, 7))

    assert conflict is True
    assert job["id"] == "job-conflict-1"


# --- targeting.py --------------------------------------------------------------

MONDAY = date(2026, 7, 6)


def test_working_days_between_excludes_saturdays():
    # 2026-06-29 (Mon) .. 2026-07-06 (Mon) covers one Saturday (07-04).
    assert working_days_between(date(2026, 6, 29), MONDAY) == 6


def test_working_days_between_none_start_is_zero():
    assert working_days_between(None, MONDAY) == 0


def _compute(**overrides):
    kwargs = dict(
        target_date=MONDAY, joining_date=MONDAY - timedelta(days=60),
        default_target=20, daily_rides={}, previous_final_target=None, override_target=None,
    )
    kwargs.update(overrides)
    return compute_target(**kwargs)


def test_new_rider_under_7_working_days_uses_default_target():
    result = _compute(joining_date=MONDAY - timedelta(days=2), default_target=25)
    assert result.tier == "new"
    assert result.calculated_target == 25
    assert result.final_target == 25


def test_new_rider_without_personal_target_falls_back_to_22():
    result = _compute(joining_date=MONDAY - timedelta(days=2), default_target=None)
    assert result.tier == "new"
    assert result.calculated_target == 22


def test_tier_a_boundary_at_avg_25():
    window = [MONDAY - timedelta(days=d) for d in range(1, 8)]
    daily_rides = {d: 25 for d in window}
    result = _compute(daily_rides=daily_rides)
    assert result.tier == "A"
    assert result.calculated_target == 27  # ceil(25) + 2


def test_tier_b_boundary_at_avg_18():
    window = [MONDAY - timedelta(days=d) for d in range(1, 8)]
    daily_rides = {d: 18 for d in window}
    result = _compute(daily_rides=daily_rides)
    assert result.tier == "B"
    assert result.calculated_target == 19  # ceil(18) + 1


def test_tier_c_below_18():
    window = [MONDAY - timedelta(days=d) for d in range(1, 8)]
    daily_rides = {d: 10 for d in window}
    result = _compute(daily_rides=daily_rides)
    assert result.tier == "C"
    assert result.calculated_target == 10  # ceil(10) + 0


def test_override_takes_precedence_over_calculated():
    daily_rides = {MONDAY - timedelta(days=1): 25}
    result = _compute(daily_rides=daily_rides, override_target=99)
    assert result.final_target == 99
    assert result.calculated_target != 99


def test_needs_hr_review_on_drop_greater_than_5():
    daily_rides = {MONDAY - timedelta(days=1): 10}  # tier C -> calculated 10
    result = _compute(daily_rides=daily_rides, previous_final_target=20)
    assert result.needs_hr_review is True


def test_drop_of_exactly_5_does_not_flag_hr_review():
    daily_rides = {MONDAY - timedelta(days=1): 10}  # tier C -> calculated 10
    result = _compute(daily_rides=daily_rides, previous_final_target=15)
    assert result.needs_hr_review is False


def test_established_rider_with_no_ride_data_is_skipped():
    result = _compute(daily_rides={})
    assert result is None


# --- tasks.py: no-op cleanly when unconfigured --------------------------------

def test_sync_yango_day_noop_when_unconfigured():
    result = tasks.sync_yango_day()
    assert result == {"skipped": True, "reason": "not_configured"}
    assert DailyLog.objects.count() == 0


def test_run_yango_preview_errors_cleanly_when_unconfigured():
    result = tasks.run_yango_preview("job-noop-1", "2026-07-06")
    assert result["status"] == "error"
    stored = yango_sync.get_preview_job("job-noop-1")
    assert stored["status"] == "error"
    assert cache.get(yango_sync.PREVIEW_RUNNING_KEY) is None


def test_refresh_driver_cache_noop_when_unconfigured():
    state = tasks.refresh_driver_cache()
    assert state["ready"] is False
    assert state["error"]
    drivers, cache_state = yango_sync.get_driver_cache()
    assert drivers == []


def test_compute_daily_targets_runs_without_error_when_no_riders():
    summary = tasks.compute_daily_targets("2026-07-06")
    assert summary["computed"] == 0
    assert summary["skipped"] == 0
