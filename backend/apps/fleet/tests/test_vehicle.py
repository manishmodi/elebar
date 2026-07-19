"""Vehicle.next_vehicle_number sequencing, servicing status thresholds,
ServiceHistory.apply_to_vehicle, and API-level checks."""

from datetime import date

import pytest

from apps.authz.sections import Section
from apps.fleet.models import SERVICE_DUE_SOON_KM, SERVICE_INTERVAL_KM, ServiceHistory, Vehicle
from apps.fleet.services import servicing_status
from apps.operations.models import Attendance
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def test_next_vehicle_number_sequences_from_highest_existing():
    assert Vehicle.next_vehicle_number() == "V-001"
    VehicleFactory(vehicle_number="V-001")
    assert Vehicle.next_vehicle_number() == "V-002"
    VehicleFactory(vehicle_number="V-007")  # gap in the sequence
    assert Vehicle.next_vehicle_number() == "V-008"


def test_next_vehicle_number_ignores_non_matching_patterns():
    VehicleFactory(vehicle_number="LEGACY-1")
    assert Vehicle.next_vehicle_number() == "V-001"


@pytest.mark.parametrize(
    "km_since,expected_status",
    [(1499, "ok"), (1500, "due_soon"), (1999, "due_soon"), (2000, "overdue"), (2500, "overdue")],
)
def test_servicing_status_thresholds(km_since, expected_status):
    vehicle = VehicleFactory(last_service_odometer=1000)
    rider = RiderFactory()
    Attendance.objects.create(
        rider=rider, vehicle=vehicle, date=date(2026, 7, 1), evening_odometer=1000 + km_since
    )

    rows = servicing_status()
    row = next(r for r in rows if r["vehicle"] == str(vehicle.uuid))
    assert row["km_since_service"] == km_since
    assert row["service_status"] == expected_status


def test_servicing_status_unknown_without_odometer_reading():
    vehicle = VehicleFactory(last_service_odometer=1000)
    rows = servicing_status()
    row = next(r for r in rows if r["vehicle"] == str(vehicle.uuid))
    assert row["service_status"] == "unknown"


def test_service_history_apply_to_vehicle_updates_and_clears_servicing():
    from django.utils import timezone

    vehicle = VehicleFactory(last_service_odometer=1000, in_servicing_since=timezone.now())
    record = ServiceHistory.objects.create(
        vehicle=vehicle, service_date=date(2026, 7, 5), odometer_at_service=2500
    )

    record.apply_to_vehicle()

    vehicle.refresh_from_db()
    assert vehicle.last_service_date == date(2026, 7, 5)
    assert vehicle.last_service_odometer == 2500
    assert vehicle.in_servicing_since is None


# --- API-level: happy path / deny-by-default / response shape ----------------

def _vehicles_user(make_user):
    return make_user(sections={Section.VEHICLES: ("view", "create", "edit", "delete")})


def test_vehicle_create_happy_path_auto_assigns_number(make_user, auth_client):
    user = _vehicles_user(make_user)
    client = auth_client(user)

    response = client.post(
        "/api/vehicles/", {"plate_number": "BA-1-PA-9999", "gps_id_password": "secret123"}, format="json"
    )

    assert response.status_code == 201
    assert response.data["vehicle_number"] == "V-001"
    assert "id" in response.data and "pk" not in response.data
    assert "gps_id_password" not in response.data


def test_vehicle_list_deny_by_default(make_user, auth_client):
    no_access = make_user()
    response = auth_client(no_access).get("/api/vehicles/")
    assert response.status_code == 403


def test_vehicle_list_anonymous_401(api_client):
    response = api_client.get("/api/vehicles/")
    assert response.status_code == 401


def test_vehicle_response_shape(make_user, auth_client):
    vehicle = VehicleFactory()
    user = _vehicles_user(make_user)
    response = auth_client(user).get(f"/api/vehicles/{vehicle.uuid}/")

    assert response.status_code == 200
    assert response.data["id"] == str(vehicle.uuid)
    assert "pk" not in response.data
    assert "gps_id_password" not in response.data
