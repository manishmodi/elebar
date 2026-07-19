"""Yango driver-id linking: duplicate link -> 409 at the view layer, and the
DB partial-unique constraint is the backstop (IntegrityError on a direct
second write bypassing the view)."""

import pytest
from django.db import IntegrityError

from apps.authz.sections import Section
from apps.riders.models import Rider
from conftest import RiderFactory

pytestmark = pytest.mark.django_db


def _riders_edit_user(make_user):
    return make_user(sections={Section.RIDERS: ("view", "edit")})


def test_link_duplicate_yango_driver_id_returns_409(make_user, auth_client):
    holder = RiderFactory(yango_driver_id="yd-shared-1")
    other = RiderFactory()
    client = auth_client(_riders_edit_user(make_user))

    response = client.put(
        f"/api/yango/riders/{other.uuid}/link/", {"yango_driver_id": "yd-shared-1"}, format="json"
    )

    assert response.status_code == 409
    other.refresh_from_db()
    assert other.yango_driver_id != "yd-shared-1"


def test_link_unique_driver_id_succeeds(make_user, auth_client):
    rider = RiderFactory()
    client = auth_client(_riders_edit_user(make_user))

    response = client.put(
        f"/api/yango/riders/{rider.uuid}/link/", {"yango_driver_id": "yd-fresh-1"}, format="json"
    )

    assert response.status_code == 200
    rider.refresh_from_db()
    assert rider.yango_driver_id == "yd-fresh-1"


def test_db_constraint_rejects_a_second_rider_with_the_same_yango_driver_id():
    RiderFactory(yango_driver_id="yd-constraint-1")
    with pytest.raises(IntegrityError):
        RiderFactory(yango_driver_id="yd-constraint-1")


def test_db_constraint_allows_multiple_riders_with_blank_yango_driver_id():
    # The partial unique constraint excludes the empty string — unlinked
    # riders (the default) must not collide with each other.
    RiderFactory(yango_driver_id="")
    RiderFactory(yango_driver_id="")
    assert Rider.objects.filter(yango_driver_id="").count() == 2
