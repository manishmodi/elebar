"""cash-collection approve -> pay lock, disapprove -> unlock (no double
streak advance on re-approve), 5-minute edit window, deny-by-default,
response shape."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.authz.sections import Section
from apps.operations.models import Attendance, CashCollection, DailyLog
from apps.operations.views import CASH_EDIT_WINDOW
from apps.payroll.models import PayRecord, Streak
from apps.riders.models import Rider
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def _fleet_pilot_day(on_date=date(2026, 7, 13), rides=30, app_cash="4000"):
    rider = RiderFactory(fleet_pilot=True, joining_date=on_date - timedelta(days=59))
    vehicle = VehicleFactory()
    DailyLog.objects.create(
        rider=rider, vehicle=vehicle, english_date=on_date, is_draft=False,
        rides_completed=rides, cash_as_per_app=Decimal(app_cash),
    )
    Attendance.objects.create(rider=rider, vehicle=vehicle, date=on_date,
                               rider_time_in="08:00", rider_time_out="17:00")
    return rider, vehicle


def _cash_collection_section_user(make_user):
    return make_user(sections={Section.CASH_COLLECTION: ("view", "create", "edit")})


def test_approve_locks_pay_record_for_fleet_pilot(make_user, auth_client):
    on_date = date(2026, 7, 13)
    rider, vehicle = _fleet_pilot_day(on_date)
    collection = CashCollection.objects.create(rider=rider, english_date=on_date, denom_1000=4)
    user = _cash_collection_section_user(make_user)
    client = auth_client(user)

    response = client.post(f"/api/cash-collection/{collection.uuid}/approve/", {}, format="json")

    assert response.status_code == 200
    assert response.data["approval_status"] == "approved"
    record = PayRecord.objects.get(rider=rider, english_date=on_date)
    assert record.status == PayRecord.Status.LOCKED


def test_disapprove_unlocks_and_reapprove_does_not_double_advance_streak(make_user, auth_client):
    on_date = date(2026, 7, 13)
    rider, vehicle = _fleet_pilot_day(on_date)
    collection = CashCollection.objects.create(rider=rider, english_date=on_date, denom_1000=4)
    user = _cash_collection_section_user(make_user)
    client = auth_client(user)

    client.post(f"/api/cash-collection/{collection.uuid}/approve/", {}, format="json")
    streak = Streak.objects.get(rider=rider)
    assert streak.current_streak == 1

    disapprove = client.post(f"/api/cash-collection/{collection.uuid}/disapprove/", {}, format="json")
    assert disapprove.status_code == 200
    assert disapprove.data["approval_status"] == "disapproved"
    record = PayRecord.objects.get(rider=rider, english_date=on_date)
    assert record.status == PayRecord.Status.COMPUTED

    reapprove = client.post(f"/api/cash-collection/{collection.uuid}/approve/", {}, format="json")
    assert reapprove.status_code == 200
    record.refresh_from_db()
    assert record.status == PayRecord.Status.LOCKED
    streak.refresh_from_db()
    assert streak.current_streak == 1  # unchanged — not advanced a second time


def test_edit_window_blocks_non_admin_after_five_minutes(make_user, auth_client):
    rider = RiderFactory()
    collection = CashCollection.objects.create(rider=rider, english_date=date(2026, 7, 1), denom_100=1)
    stale = timezone.now() - CASH_EDIT_WINDOW - timedelta(minutes=1)
    CashCollection.objects.filter(pk=collection.pk).update(submitted_at=stale)

    user = _cash_collection_section_user(make_user)
    client = auth_client(user)

    response = client.patch(
        f"/api/cash-collection/{collection.uuid}/", {"denom_100": 2}, format="json"
    )

    assert response.status_code == 403


def test_edit_window_allows_admin_unrestricted(admin_user, auth_client):
    rider = RiderFactory()
    collection = CashCollection.objects.create(rider=rider, english_date=date(2026, 7, 1), denom_100=1)
    stale = timezone.now() - CASH_EDIT_WINDOW - timedelta(minutes=1)
    CashCollection.objects.filter(pk=collection.pk).update(submitted_at=stale)

    client = auth_client(admin_user)
    response = client.patch(
        f"/api/cash-collection/{collection.uuid}/", {"denom_100": 2}, format="json"
    )

    assert response.status_code == 200
    collection.refresh_from_db()
    assert collection.denom_100 == 2


def test_edit_within_window_allowed_for_non_admin(make_user, auth_client):
    rider = RiderFactory()
    collection = CashCollection.objects.create(rider=rider, english_date=date(2026, 7, 1), denom_100=1)
    user = _cash_collection_section_user(make_user)
    client = auth_client(user)

    response = client.patch(
        f"/api/cash-collection/{collection.uuid}/", {"denom_100": 5}, format="json"
    )

    assert response.status_code == 200


def test_disapprove_requires_edit_create_only_user_gets_403(make_user, auth_client):
    # Regression guard: the per-action override (approve/disapprove need
    # cash-collection:edit, not just :create) must actually hold.
    on_date = date(2026, 7, 13)
    rider, vehicle = _fleet_pilot_day(on_date)
    collection = CashCollection.objects.create(rider=rider, english_date=on_date, denom_1000=4)
    create_only_user = make_user(sections={Section.CASH_COLLECTION: ("view", "create")})
    client = auth_client(create_only_user)

    response = client.post(f"/api/cash-collection/{collection.uuid}/disapprove/", {}, format="json")

    assert response.status_code == 403
    collection.refresh_from_db()
    assert collection.approval_status == CashCollection.ApprovalStatus.PENDING


# --- deny-by-default / response shape ---------------------------------------

def test_list_deny_by_default_no_section(make_user, auth_client):
    no_access = make_user()
    client = auth_client(no_access)
    response = client.get("/api/cash-collection/")
    assert response.status_code == 403


def test_list_anonymous_is_401(api_client):
    response = api_client.get("/api/cash-collection/")
    assert response.status_code == 401


def test_response_shape_uuid_id_no_integer_pk(make_user, auth_client):
    rider = RiderFactory()
    collection = CashCollection.objects.create(rider=rider, english_date=date(2026, 7, 1), denom_100=1)
    user = _cash_collection_section_user(make_user)
    client = auth_client(user)

    response = client.get(f"/api/cash-collection/{collection.uuid}/")

    assert response.status_code == 200
    assert response.data["id"] == str(collection.uuid)
    assert "pk" not in response.data
    assert response.data["rider"] == str(rider.uuid)
