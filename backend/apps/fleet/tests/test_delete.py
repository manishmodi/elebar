"""Vehicle delete-blocking: 409 with linked records, 204 on a clean delete."""

from datetime import date

import pytest

from apps.authz.sections import Section
from apps.fleet.models import Assignment, Vehicle
from conftest import RiderFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def _vehicles_user(make_user):
    return make_user(sections={Section.VEHICLES: ("view", "create", "edit", "delete")})


def test_delete_vehicle_with_linked_assignment_returns_409(make_user, auth_client):
    rider, vehicle = RiderFactory(), VehicleFactory()
    Assignment.objects.create(rider=rider, vehicle=vehicle, start_date=date(2026, 1, 1))
    client = auth_client(_vehicles_user(make_user))

    response = client.delete(f"/api/vehicles/{vehicle.uuid}/")

    assert response.status_code == 409
    assert Vehicle.objects.filter(pk=vehicle.pk).exists()


def test_delete_vehicle_with_no_linked_records_returns_204(make_user, auth_client):
    vehicle = VehicleFactory()
    client = auth_client(_vehicles_user(make_user))

    response = client.delete(f"/api/vehicles/{vehicle.uuid}/")

    assert response.status_code == 204
    assert not Vehicle.objects.filter(pk=vehicle.pk).exists()
