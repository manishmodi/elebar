"""Shared pytest fixtures/factories for the whole backend test suite.

Kept at the repo root (not inside an app) so every `apps/<app>/tests/`
package can use them without duplication. Hermetic settings
(`sherpa.settings_test`) are wired via pytest.ini.
"""

from datetime import date
from decimal import Decimal

import factory
import pytest
from factory.django import DjangoModelFactory
from rest_framework.test import APIClient

from apps.accounts.models import SectionPermission, User
from apps.authz.sections import ALL_SECTIONS
from apps.fleet.models import Vehicle
from apps.operations.models import FleetHandover
from apps.payroll.models import PayRecord
from apps.riders.models import Rider

FULL_CRUD = ("view", "create", "edit", "delete")


class RiderFactory(DjangoModelFactory):
    class Meta:
        model = Rider

    full_name = factory.Sequence(lambda n: f"Rider {n}")
    phone_number = factory.Sequence(lambda n: f"9800{n:06d}")
    status = Rider.Status.ACTIVE
    employment_type = Rider.EmploymentType.FULL_TIME
    monthly_salary = Decimal("20000")
    daily_ride_target = 20
    fleet_pilot = False


class VehicleFactory(DjangoModelFactory):
    class Meta:
        model = Vehicle

    vehicle_number = factory.Sequence(lambda n: f"V-{n:03d}")
    plate_number = factory.Sequence(lambda n: f"BA-{n}-PA-1234")
    status = Vehicle.Status.ACTIVE


class UserFactory(DjangoModelFactory):
    class Meta:
        model = User
        skip_postgeneration_save = True

    email = factory.Sequence(lambda n: f"user{n}@test.com")
    full_name = factory.Sequence(lambda n: f"User {n}")
    is_active = True

    @factory.post_generation
    def set_password(self, create, extracted, **kwargs):  # noqa: ARG002
        self.set_password(extracted or "Testpass123!")
        if create:
            self.save()


class FleetHandoverFactory(DjangoModelFactory):
    class Meta:
        model = FleetHandover

    rider = factory.SubFactory(RiderFactory)
    vehicle = factory.SubFactory(VehicleFactory)
    english_date = date(2026, 7, 6)
    kind = FleetHandover.Kind.CHECKOUT
    status = FleetHandover.Status.PENDING
    idempotency_key = factory.Sequence(lambda n: f"idem-key-{n:08d}")
    payload = factory.LazyFunction(dict)


class PayRecordFactory(DjangoModelFactory):
    class Meta:
        model = PayRecord

    rider = factory.SubFactory(RiderFactory)
    english_date = date(2026, 7, 6)
    base = Decimal("600")
    commission = Decimal("0")
    prize = Decimal("0")
    growth = Decimal("0")
    daily_pay = Decimal("600")
    gates_applied = factory.LazyFunction(dict)
    flags = factory.LazyFunction(dict)
    status = PayRecord.Status.LOCKED


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def make_user(db):
    """make_user(sections={Section.RIDERS: ("view", "edit")}, is_superuser=False)."""

    def _make(sections=None, is_superuser=False, **kwargs):
        user = UserFactory(is_superuser=is_superuser, **kwargs)
        for section, actions in (sections or {}).items():
            SectionPermission.objects.create(
                user=user,
                section=section,
                can_view="view" in actions,
                can_create="create" in actions,
                can_edit="edit" in actions,
                can_delete="delete" in actions,
            )
        return user

    return _make


@pytest.fixture
def admin_user(make_user):
    return make_user(sections={section: FULL_CRUD for section in ALL_SECTIONS})


@pytest.fixture
def auth_client(api_client):
    """auth_client(user) -> authenticated APIClient (force_authenticate)."""

    def _auth(user):
        api_client.force_authenticate(user=user)
        return api_client

    return _auth
