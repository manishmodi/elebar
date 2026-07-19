"""Rider-app service-token API (/api/fleet/v1/*): auth plane, rider scoping,
idempotency, state machine, photo uploads, /today purity, and pay summaries.
"""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.operations.fleet_v1 import _org_today
from apps.operations.models import Attendance, CashCollection, DailyLog, FleetHandover
from apps.payroll.models import PayRecord
from apps.riders.models import Rider
from conftest import FleetHandoverFactory, PayRecordFactory, RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db

VALID_TOKEN = "s" * 40  # >= 32 chars
SHORT_TOKEN = "t" * 20  # < 32 chars
TODAY = date(2026, 7, 6)


@pytest.fixture
def service_env(monkeypatch):
    monkeypatch.setenv("FLEET_SERVICE_TOKEN", VALID_TOKEN)
    return VALID_TOKEN


@pytest.fixture
def pilot(service_env):
    return RiderFactory(
        fleet_pilot=True, status=Rider.Status.ACTIVE, yango_driver_id="yd-pilot-1"
    )


def _auth(api_client, token=VALID_TOKEN, yango_id=None, idem_key=None):
    creds = {}
    if token is not None:
        creds["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    else:
        creds.pop("HTTP_AUTHORIZATION", None)
    if yango_id is not None:
        creds["HTTP_X_RIDER_YANGO_ID"] = yango_id
    if idem_key is not None:
        creds["HTTP_X_IDEMPOTENCY_KEY"] = idem_key
    api_client.credentials(**creds)
    return api_client


def _checkout_payload(vehicle, goal_tier=1, odometer=1000, battery=80, on_date=None):
    payload = {"vehicle_id": str(vehicle.uuid), "odometer": odometer,
               "battery": battery, "goal_tier": goal_tier}
    if on_date is not None:
        payload["date"] = str(on_date)
    return payload


# --- Auth plane --------------------------------------------------------------

def test_unset_token_returns_503_without_auth_header(api_client):
    response = api_client.get("/api/fleet/v1/pilots/")
    assert response.status_code == 503


def test_unset_token_returns_503_even_with_an_auth_header(api_client):
    # Never a bypass: a header present with the env unset still 503s.
    client = _auth(api_client, token="whatever-the-client-sends")
    response = client.get("/api/fleet/v1/pilots/")
    assert response.status_code == 503


def test_unset_token_returns_503_on_rider_scoped_and_write_endpoints(api_client):
    for method, path in [
        ("get", "/api/fleet/v1/today/"),
        ("post", "/api/fleet/v1/checkout/"),
        ("get", "/api/fleet/v1/pay/month/2026-07/"),
    ]:
        response = getattr(api_client, method)(path, {}, format="json")
        assert response.status_code == 503, f"{method} {path} -> {response.status_code}"


def test_short_token_in_env_returns_503(api_client, monkeypatch):
    monkeypatch.setenv("FLEET_SERVICE_TOKEN", SHORT_TOKEN)
    client = _auth(api_client, token=SHORT_TOKEN)
    response = client.get("/api/fleet/v1/pilots/")
    assert response.status_code == 503


def test_wrong_token_returns_401(api_client, service_env):
    client = _auth(api_client, token="not-the-configured-token-xxxxxxxxxxx")
    response = client.get("/api/fleet/v1/pilots/")
    assert response.status_code == 401


def test_valid_token_returns_200(api_client, service_env):
    client = _auth(api_client, token=service_env)
    response = client.get("/api/fleet/v1/pilots/")
    assert response.status_code == 200
    assert "pilots" in response.data


def test_jwt_access_token_rejected_on_service_plane(api_client, service_env, admin_user):
    jwt_access = str(RefreshToken.for_user(admin_user).access_token)
    client = _auth(api_client, token=jwt_access)
    response = client.get("/api/fleet/v1/pilots/")
    assert response.status_code == 401


def test_service_token_rejected_on_jwt_plane(api_client, service_env):
    # The reverse direction: the shared service token must not authenticate
    # against a JWT-protected admin endpoint either.
    client = _auth(api_client, token=service_env)
    response = client.get("/api/riders/")
    assert response.status_code == 401


# --- Rider scoping -------------------------------------------------------------

def test_missing_rider_header_returns_400(api_client, service_env):
    client = _auth(api_client, token=service_env)
    response = client.get("/api/fleet/v1/today/")
    assert response.status_code == 400


def test_unknown_yango_id_returns_404(api_client, service_env):
    client = _auth(api_client, token=service_env, yango_id="no-such-driver")
    response = client.get("/api/fleet/v1/today/")
    assert response.status_code == 404


def test_inactive_rider_returns_403(api_client, service_env):
    rider = RiderFactory(fleet_pilot=True, status=Rider.Status.INACTIVE, yango_driver_id="yd-inactive")
    client = _auth(api_client, token=service_env, yango_id=rider.yango_driver_id)
    response = client.get("/api/fleet/v1/today/")
    assert response.status_code == 403


def test_non_pilot_rider_returns_403(api_client, service_env):
    rider = RiderFactory(fleet_pilot=False, status=Rider.Status.ACTIVE, yango_driver_id="yd-nonpilot")
    client = _auth(api_client, token=service_env, yango_id=rider.yango_driver_id)
    response = client.get("/api/fleet/v1/today/")
    assert response.status_code == 403


def test_active_pilot_resolves_and_returns_200(api_client, pilot):
    client = _auth(api_client, yango_id=pilot.yango_driver_id)
    response = client.get("/api/fleet/v1/today/")
    assert response.status_code == 200


# --- Idempotency ---------------------------------------------------------------

def test_checkout_missing_idempotency_key_returns_400(api_client, pilot):
    vehicle = VehicleFactory()
    client = _auth(api_client, yango_id=pilot.yango_driver_id)
    response = client.post(
        "/api/fleet/v1/checkout/", _checkout_payload(vehicle), format="json"
    )
    assert response.status_code == 400


@pytest.mark.parametrize("key", ["short", "x" * 129])
def test_checkout_out_of_range_idempotency_key_returns_400(api_client, pilot, key):
    vehicle = VehicleFactory()
    client = _auth(api_client, yango_id=pilot.yango_driver_id, idem_key=key)
    response = client.post(
        "/api/fleet/v1/checkout/", _checkout_payload(vehicle), format="json"
    )
    assert response.status_code == 400


def test_checkout_replay_same_rider_returns_200_with_original_handover(api_client, pilot):
    vehicle = VehicleFactory()
    client = _auth(api_client, yango_id=pilot.yango_driver_id, idem_key="replay-key-000001")
    payload = _checkout_payload(vehicle, on_date=TODAY)

    first = client.post("/api/fleet/v1/checkout/", payload, format="json")
    assert first.status_code == 201
    original_id = first.data["handover_id"]

    second = client.post("/api/fleet/v1/checkout/", payload, format="json")
    assert second.status_code == 200
    assert second.data["handover_id"] == original_id
    assert FleetHandover.objects.filter(rider=pilot).count() == 1


def test_checkout_replay_by_another_rider_is_409_conflict_not_a_leak(api_client, service_env):
    rider_a = RiderFactory(fleet_pilot=True, status=Rider.Status.ACTIVE, yango_driver_id="yd-a")
    rider_b = RiderFactory(fleet_pilot=True, status=Rider.Status.ACTIVE, yango_driver_id="yd-b")
    vehicle = VehicleFactory()
    shared_key = "shared-idem-key-0001"

    client = _auth(api_client, token=service_env, yango_id=rider_a.yango_driver_id, idem_key=shared_key)
    first = client.post(
        "/api/fleet/v1/checkout/", _checkout_payload(vehicle, on_date=TODAY), format="json"
    )
    assert first.status_code == 201
    rider_a_handover_id = first.data["handover_id"]

    client_b = _auth(api_client, token=service_env, yango_id=rider_b.yango_driver_id, idem_key=shared_key)
    second = client_b.post(
        "/api/fleet/v1/checkout/", _checkout_payload(vehicle, on_date=TODAY), format="json"
    )
    assert second.status_code == 409
    # Never leak rider A's handover id/status to rider B's request.
    assert "handover_id" not in second.data
    assert second.data["detail"] != rider_a_handover_id
    # And rider B got no handover row of their own out of the collision.
    assert not FleetHandover.objects.filter(rider=rider_b).exists()


# --- State machine ---------------------------------------------------------------

def test_double_checkout_returns_409(api_client, pilot):
    vehicle = VehicleFactory()
    client = _auth(api_client, yango_id=pilot.yango_driver_id, idem_key="checkout-key-aaaaaaa")
    payload = _checkout_payload(vehicle, on_date=TODAY)
    first = client.post("/api/fleet/v1/checkout/", payload, format="json")
    assert first.status_code == 201

    # credentials() replaces the whole header set — re-supply auth + rider scoping.
    _auth(api_client, yango_id=pilot.yango_driver_id, idem_key="checkout-key-bbbbbbb")
    second = client.post("/api/fleet/v1/checkout/", payload, format="json")
    assert second.status_code == 409


def test_checkin_without_checkout_returns_422(api_client, pilot):
    client = _auth(api_client, yango_id=pilot.yango_driver_id, idem_key="checkin-key-aaaaaaaa")
    response = client.post(
        "/api/fleet/v1/checkin/",
        {"date": str(TODAY), "odometer": 1100, "battery": 40, "cash": "0", "wallet": "0"},
        format="json",
    )
    assert response.status_code == 422


def test_rejected_checkout_then_new_checkout_succeeds(api_client, pilot):
    vehicle = VehicleFactory()
    FleetHandoverFactory(
        rider=pilot, vehicle=vehicle, kind=FleetHandover.Kind.CHECKOUT,
        status=FleetHandover.Status.REJECTED, english_date=TODAY,
        idempotency_key="rejected-checkout-key-01",
    )
    client = _auth(api_client, yango_id=pilot.yango_driver_id, idem_key="fresh-checkout-key-01")
    response = client.post(
        "/api/fleet/v1/checkout/", _checkout_payload(vehicle, on_date=TODAY), format="json"
    )
    assert response.status_code == 201


# --- Photos ----------------------------------------------------------------------

def test_photo_over_10mb_declared_length_returns_413(api_client, pilot):
    client = _auth(api_client, yango_id=pilot.yango_driver_id)
    response = client.post(
        "/api/fleet/v1/photos/", data=b"tiny-body", content_type="image/jpeg",
        CONTENT_LENGTH=str(11 * 1024 * 1024),
    )
    assert response.status_code == 413


def test_photo_wrong_content_type_returns_415(api_client, pilot):
    client = _auth(api_client, yango_id=pilot.yango_driver_id)
    response = client.post(
        "/api/fleet/v1/photos/", data=b"not an image", content_type="text/plain",
    )
    assert response.status_code == 415


def test_photo_valid_jpeg_returns_201_and_lands_in_media_root(api_client, pilot, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    client = _auth(api_client, yango_id=pilot.yango_driver_id)
    body = b"\xff\xd8\xff\xe0fake-jpeg-bytes"

    response = client.post("/api/fleet/v1/photos/", data=body, content_type="image/jpeg")

    assert response.status_code == 201
    photo_path = response.data["photo_path"]
    assert photo_path.startswith("/objects/uploads/")
    assert photo_path.endswith(".jpg")
    on_disk = tmp_path / "uploads" / photo_path.rsplit("/", 1)[-1]
    assert on_disk.exists()
    assert on_disk.read_bytes() == body


# --- /today is pure ---------------------------------------------------------------

def test_today_creates_no_pay_attendance_or_cash_rows(api_client, pilot):
    vehicle = VehicleFactory()
    # The view resolves "today" via the org timezone, not a payload date —
    # anchor the fixture log to that same real date.
    DailyLog.objects.create(
        rider=pilot, vehicle=vehicle, english_date=_org_today(), is_draft=True,
        rides_completed=10, cash_as_per_app=Decimal("1000"),
    )
    before = (
        PayRecord.objects.count(), Attendance.objects.count(), CashCollection.objects.count(),
    )
    client = _auth(api_client, yango_id=pilot.yango_driver_id)

    response = client.get("/api/fleet/v1/today/")

    assert response.status_code == 200
    after = (
        PayRecord.objects.count(), Attendance.objects.count(), CashCollection.objects.count(),
    )
    assert after == before == (0, 0, 0)
    assert response.data["pay_projection"] is not None  # computed, but not persisted


# --- /pay/day and /pay/month -------------------------------------------------------

def test_pay_day_404_when_no_locked_record(api_client, pilot):
    client = _auth(api_client, yango_id=pilot.yango_driver_id)
    response = client.get(f"/api/fleet/v1/pay/day/{TODAY}/")
    assert response.status_code == 404


def test_pay_day_200_with_locked_record(api_client, pilot):
    PayRecordFactory(rider=pilot, english_date=TODAY, status=PayRecord.Status.LOCKED,
                      daily_pay=Decimal("950.00"))
    client = _auth(api_client, yango_id=pilot.yango_driver_id)
    response = client.get(f"/api/fleet/v1/pay/day/{TODAY}/")
    assert response.status_code == 200
    assert response.data["total"] == "950.00"
    assert response.data["locked"] is True


def test_pay_month_sums_locked_records_only(api_client, pilot):
    PayRecordFactory(rider=pilot, english_date=date(2026, 7, 1),
                      status=PayRecord.Status.LOCKED, daily_pay=Decimal("500.00"))
    PayRecordFactory(rider=pilot, english_date=date(2026, 7, 2),
                      status=PayRecord.Status.LOCKED, daily_pay=Decimal("700.00"))
    PayRecordFactory(rider=pilot, english_date=date(2026, 7, 3),
                      status=PayRecord.Status.COMPUTED, daily_pay=Decimal("999.00"))
    client = _auth(api_client, yango_id=pilot.yango_driver_id)

    response = client.get("/api/fleet/v1/pay/month/2026-07/")

    assert response.status_code == 200
    assert len(response.data["days"]) == 2
    assert response.data["month_total"] == "1200.00"
