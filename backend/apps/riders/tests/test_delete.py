"""Rider delete-blocking: 409 with linked records, 204 on a clean delete."""

from datetime import date

import pytest

from apps.authz.sections import Section
from apps.fleet.models import Assignment
from apps.riders.models import Rider
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def _riders_user(make_user):
    return make_user(sections={Section.RIDERS: ("view", "create", "edit", "delete")})


def test_delete_rider_with_linked_assignment_returns_409(make_user, auth_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    Assignment.objects.create(rider=rider, vehicle=vehicle, start_date=date(2026, 1, 1))
    client = auth_client(_riders_user(make_user))

    response = client.delete(f"/api/riders/{rider.uuid}/")

    assert response.status_code == 409
    assert Rider.objects.filter(pk=rider.pk).exists()


def test_delete_rider_with_no_linked_records_returns_204(make_user, auth_client):
    rider = RiderFactory()
    client = auth_client(_riders_user(make_user))

    response = client.delete(f"/api/riders/{rider.uuid}/")

    assert response.status_code == 204
    assert not Rider.objects.filter(pk=rider.pk).exists()


def test_rider_list_deny_by_default(make_user, auth_client):
    no_access = make_user()
    response = auth_client(no_access).get("/api/riders/")
    assert response.status_code == 403


def test_rider_list_anonymous_401(api_client):
    response = api_client.get("/api/riders/")
    assert response.status_code == 401


def test_rider_response_shape(make_user, auth_client):
    rider = RiderFactory()
    client = auth_client(_riders_user(make_user))
    response = client.get(f"/api/riders/{rider.uuid}/")

    assert response.status_code == 200
    assert response.data["id"] == str(rider.uuid)
    assert "pk" not in response.data
