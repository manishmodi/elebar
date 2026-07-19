"""Attendance guard-locked fields freeze after day_closed; only admins may
edit them (non-admin PATCH -> 403, admin succeeds)."""

from datetime import date

import pytest

from apps.authz.sections import Section
from apps.operations.models import Attendance
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def _closed_day_attendance():
    rider, vehicle = RiderFactory(), VehicleFactory()
    return Attendance.objects.create(
        rider=rider, vehicle=vehicle, date=date(2026, 7, 1),
        battery_out=80, morning_odometer=1000, rider_time_in="08:00",
        battery_in=30, evening_odometer=1050, rider_time_out="18:00",  # day_closed=True
    )


def _attendance_user(make_user):
    return make_user(sections={Section.ATTENDANCE: ("view", "create", "edit")})


def test_non_admin_cannot_edit_guard_field_after_day_closed(make_user, auth_client):
    attendance = _closed_day_attendance()
    user = _attendance_user(make_user)
    client = auth_client(user)

    response = client.patch(
        f"/api/attendance/{attendance.uuid}/", {"battery_out": 55}, format="json"
    )

    assert response.status_code == 403
    attendance.refresh_from_db()
    assert attendance.battery_out == 80  # unchanged


def test_admin_can_edit_guard_field_after_day_closed(admin_user, auth_client):
    attendance = _closed_day_attendance()
    client = auth_client(admin_user)

    response = client.patch(
        f"/api/attendance/{attendance.uuid}/", {"battery_out": 55}, format="json"
    )

    assert response.status_code == 200
    attendance.refresh_from_db()
    assert attendance.battery_out == 55


def test_non_admin_can_edit_non_guard_field_after_day_closed(make_user, auth_client):
    attendance = _closed_day_attendance()
    user = _attendance_user(make_user)
    client = auth_client(user)

    response = client.patch(
        f"/api/attendance/{attendance.uuid}/", {"remarks": "late start"}, format="json"
    )

    assert response.status_code == 200
    attendance.refresh_from_db()
    assert attendance.remarks == "late start"


def test_non_admin_can_edit_guard_field_before_day_closed(make_user, auth_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    attendance = Attendance.objects.create(
        rider=rider, vehicle=vehicle, date=date(2026, 7, 1),
        battery_out=80, morning_odometer=1000, rider_time_in="08:00",
    )
    assert attendance.day_closed is False
    user = _attendance_user(make_user)
    client = auth_client(user)

    response = client.patch(
        f"/api/attendance/{attendance.uuid}/", {"battery_out": 55}, format="json"
    )

    assert response.status_code == 200


# --- deny-by-default / response shape ---------------------------------------

def test_attendance_list_deny_by_default(make_user, auth_client):
    no_access = make_user()
    response = auth_client(no_access).get("/api/attendance/")
    assert response.status_code == 403


def test_attendance_list_anonymous_is_401(api_client):
    response = api_client.get("/api/attendance/")
    assert response.status_code == 401


def test_attendance_response_shape(make_user, auth_client):
    attendance = _closed_day_attendance()
    user = _attendance_user(make_user)
    response = auth_client(user).get(f"/api/attendance/{attendance.uuid}/")

    assert response.status_code == 200
    assert response.data["id"] == str(attendance.uuid)
    assert "pk" not in response.data
    assert response.data["rider"] == str(attendance.rider.uuid)


# --- regression: UI payload sends ""-valued optional text fields -------------

def test_create_accepts_empty_string_text_fields_from_ui_payload(make_user, auth_client):
    rider = RiderFactory()
    user = _attendance_user(make_user)
    client = auth_client(user)

    response = client.post(
        "/api/attendance/",
        {
            "rider": str(rider.uuid), "date": "2026-07-02", "type": "present",
            "nepali_date": "", "remarks": "", "scooter_out": "", "scooter_in": "",
            "rider_time_in": "", "rider_time_out": "", "vehicle_override_reason": "",
        },
        format="json",
    )

    assert response.status_code == 201
