"""Handover verify/checkout/checkin projection into Attendance + idempotent
CashCollection auto-create; view-level verify/reject checks."""

from datetime import date
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.utils import timezone

from apps.operations.handovers import HandoverError, verify_handover
from apps.operations.models import Attendance, CashCollection, FleetHandover
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def _handover(rider, vehicle, kind, payload, on_date=date(2026, 7, 6), key=None):
    return FleetHandover.objects.create(
        rider=rider, vehicle=vehicle, kind=kind, english_date=on_date,
        payload=payload, idempotency_key=key or f"{kind}-{rider.pk}-{on_date}",
    )


def test_checkout_projects_into_attendance(admin_user):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(
        rider, vehicle, FleetHandover.Kind.CHECKOUT,
        {"battery": 82, "odometer": "1000", "time": "08:15"},
    )

    updated = verify_handover(handover, admin_user)

    attendance = Attendance.objects.get(rider=rider, date=handover.english_date)
    assert attendance.battery_out == 82
    assert attendance.morning_odometer == 1000
    assert attendance.rider_time_in == "08:15"
    assert updated.status == FleetHandover.Status.VERIFIED


def test_checkout_without_a_declared_time_stamps_org_local_not_utc(admin_user):
    # Regression: rider_time_in must be Asia/Kathmandu HH:MM (TIME_ZONE is UTC
    # storage-side) — stamping timezone.localtime() here would corrupt the
    # pay engine's worked-hours gate by 5h45m.
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(
        rider, vehicle, FleetHandover.Kind.CHECKOUT, {"battery": 82, "odometer": "1000"},
    )
    before = timezone.now()

    verify_handover(handover, admin_user)

    after = timezone.now()
    attendance = Attendance.objects.get(rider=rider, date=handover.english_date)
    org_before = before.astimezone(ZoneInfo(settings.ORG_TIMEZONE)).strftime("%H:%M")
    org_after = after.astimezone(ZoneInfo(settings.ORG_TIMEZONE)).strftime("%H:%M")
    utc_now = timezone.now().strftime("%H:%M")
    assert attendance.rider_time_in in (org_before, org_after)
    if utc_now not in (org_before, org_after):  # guard against the rare exact-match minute
        assert attendance.rider_time_in != utc_now


def test_checkin_projects_evening_fields_and_creates_cash_collection(admin_user):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(
        rider, vehicle, FleetHandover.Kind.CHECKIN,
        {"battery": 20, "odometer": "1080", "time": "18:30", "wallet": 50, "denom_1000": 2, "denom_100": 3},
    )

    verify_handover(handover, admin_user)

    attendance = Attendance.objects.get(rider=rider, date=handover.english_date)
    assert attendance.battery_in == 20
    assert attendance.evening_odometer == 1080
    assert attendance.rider_time_out == "18:30"

    collection = CashCollection.objects.get(rider=rider, english_date=handover.english_date)
    assert collection.denom_1000 == 2
    assert collection.denom_100 == 3
    assert collection.wallet_amount == 50
    assert collection.cash_total == 2300  # 2*1000 + 3*100
    assert collection.grand_total == 2350


def test_checkin_cash_collection_creation_is_idempotent(admin_user):
    rider, vehicle = RiderFactory(), VehicleFactory()
    on_date = date(2026, 7, 6)
    # A cash collection already exists for the day (e.g. entered manually).
    CashCollection.objects.create(rider=rider, english_date=on_date, denom_500=1)

    handover = _handover(
        rider, vehicle, FleetHandover.Kind.CHECKIN,
        {"battery": 20, "odometer": "1080", "time": "18:30"},
        on_date=on_date,
    )
    verify_handover(handover, admin_user)

    assert CashCollection.objects.filter(rider=rider, english_date=on_date).count() == 1


def test_verify_returns_updated_handover_with_verified_status(admin_user):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(rider, vehicle, FleetHandover.Kind.CHECKOUT, {"battery": 90, "odometer": "500"})

    updated = verify_handover(handover, admin_user)

    assert updated.status == FleetHandover.Status.VERIFIED
    assert updated.verified_by_id == admin_user.pk
    assert updated.verified_at is not None


def test_double_verify_raises_handover_error(admin_user):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(rider, vehicle, FleetHandover.Kind.CHECKOUT, {"battery": 90, "odometer": "500"})
    verify_handover(handover, admin_user)

    with pytest.raises(HandoverError):
        verify_handover(handover, admin_user)


# --- view-level: happy path / deny-by-default / double-verify 409 / reject 400 --

def test_view_verify_double_verify_returns_409(admin_user, auth_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(rider, vehicle, FleetHandover.Kind.CHECKOUT, {"battery": 90, "odometer": "500"})
    client = auth_client(admin_user)
    url = f"/api/fleet/handovers/{handover.uuid}/verify/"

    first = client.post(url, {}, format="json")
    assert first.status_code == 200
    assert first.data["status"] == "verified"

    second = client.post(url, {}, format="json")
    assert second.status_code == 409


def test_view_reject_without_reason_returns_400(admin_user, auth_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(rider, vehicle, FleetHandover.Kind.CHECKOUT, {"battery": 90, "odometer": "500"})
    client = auth_client(admin_user)

    response = client.post(f"/api/fleet/handovers/{handover.uuid}/reject/", {}, format="json")

    assert response.status_code == 400
    assert not FleetHandover.objects.get(pk=handover.pk).status == FleetHandover.Status.REJECTED


def test_view_verify_deny_by_default(make_user, auth_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(rider, vehicle, FleetHandover.Kind.CHECKOUT, {"battery": 90, "odometer": "500"})
    no_access_user = make_user()  # no SectionPermission rows at all
    client = auth_client(no_access_user)

    response = client.post(f"/api/fleet/handovers/{handover.uuid}/verify/", {}, format="json")
    assert response.status_code == 403


def test_view_verify_anonymous_is_401(api_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    handover = _handover(rider, vehicle, FleetHandover.Kind.CHECKOUT, {"battery": 90, "odometer": "500"})

    response = api_client.post(f"/api/fleet/handovers/{handover.uuid}/verify/", {}, format="json")
    assert response.status_code == 401
