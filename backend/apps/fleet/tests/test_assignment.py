"""Second active assignment for the same rider (or same vehicle) -> 400 from
serializer validate; API-level deny-by-default / response shape."""

from datetime import date

import pytest

from apps.authz.sections import Section
from apps.fleet.models import Assignment
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def _assignments_user(make_user):
    return make_user(sections={Section.ASSIGNMENTS: ("view", "create", "edit", "delete")})


def test_second_active_assignment_same_rider_returns_400(make_user, auth_client):
    rider = RiderFactory()
    vehicle_a, vehicle_b = VehicleFactory(), VehicleFactory()
    Assignment.objects.create(rider=rider, vehicle=vehicle_a, start_date=date(2026, 1, 1))
    client = auth_client(_assignments_user(make_user))

    response = client.post(
        "/api/assignments/",
        {"rider": str(rider.uuid), "vehicle": str(vehicle_b.uuid), "start_date": "2026-07-01"},
        format="json",
    )

    assert response.status_code == 400
    assert "rider" in response.data["errors"]


def test_second_active_assignment_same_vehicle_returns_400(make_user, auth_client):
    vehicle = VehicleFactory()
    rider_a, rider_b = RiderFactory(), RiderFactory()
    Assignment.objects.create(rider=rider_a, vehicle=vehicle, start_date=date(2026, 1, 1))
    client = auth_client(_assignments_user(make_user))

    response = client.post(
        "/api/assignments/",
        {"rider": str(rider_b.uuid), "vehicle": str(vehicle.uuid), "start_date": "2026-07-01"},
        format="json",
    )

    assert response.status_code == 400
    assert "vehicle" in response.data["errors"]


def test_new_active_assignment_allowed_after_ending_the_old_one(make_user, auth_client):
    rider = RiderFactory()
    vehicle_a, vehicle_b = VehicleFactory(), VehicleFactory()
    old = Assignment.objects.create(rider=rider, vehicle=vehicle_a, start_date=date(2026, 1, 1))
    old.status = Assignment.Status.ENDED
    old.end_date = date(2026, 6, 30)
    old.save()
    client = auth_client(_assignments_user(make_user))

    response = client.post(
        "/api/assignments/",
        {"rider": str(rider.uuid), "vehicle": str(vehicle_b.uuid), "start_date": "2026-07-01"},
        format="json",
    )

    assert response.status_code == 201


def test_assignment_list_deny_by_default(make_user, auth_client):
    no_access = make_user()
    response = auth_client(no_access).get("/api/assignments/")
    assert response.status_code == 403


def test_assignment_list_anonymous_401(api_client):
    response = api_client.get("/api/assignments/")
    assert response.status_code == 401


def test_assignment_response_shape(make_user, auth_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    assignment = Assignment.objects.create(rider=rider, vehicle=vehicle, start_date=date(2026, 1, 1))
    client = auth_client(_assignments_user(make_user))

    response = client.get(f"/api/assignments/{assignment.uuid}/")

    assert response.status_code == 200
    assert response.data["id"] == str(assignment.uuid)
    assert "pk" not in response.data
    assert response.data["rider"] == str(rider.uuid)
    assert response.data["vehicle"] == str(vehicle.uuid)
