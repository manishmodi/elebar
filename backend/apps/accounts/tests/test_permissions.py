"""Permission matrix replace (atomic + duplicate-section rejection), is_admin
derivation, self-delete guard, /api/users/ admin-only gate."""

import pytest

from apps.accounts.models import SectionPermission, User
from apps.authz.sections import ALL_SECTIONS, Section
from conftest import FULL_CRUD

pytestmark = pytest.mark.django_db


def test_permissions_put_replaces_matrix_atomically(admin_user, auth_client):
    target = User.objects.create_user(email="target@test.com", password="Testpass123!", full_name="T")
    SectionPermission.objects.create(user=target, section=Section.RIDERS, can_view=True)
    client = auth_client(admin_user)

    payload = [
        {"section": Section.VEHICLES, "can_view": True, "can_create": True, "can_edit": False, "can_delete": False},
        {"section": Section.SALARY, "can_view": True, "can_create": False, "can_edit": False, "can_delete": False},
    ]
    response = client.put(f"/api/users/{target.uuid}/permissions/", payload, format="json")

    assert response.status_code == 200
    sections = set(target.section_permissions.values_list("section", flat=True))
    assert sections == {Section.VEHICLES, Section.SALARY}  # old RIDERS row replaced


def test_permissions_put_duplicate_section_is_400_and_matrix_unchanged(admin_user, auth_client):
    target = User.objects.create_user(email="target2@test.com", password="Testpass123!", full_name="T")
    SectionPermission.objects.create(user=target, section=Section.RIDERS, can_view=True)
    client = auth_client(admin_user)

    payload = [
        {"section": Section.VEHICLES, "can_view": True, "can_create": False, "can_edit": False, "can_delete": False},
        {"section": Section.VEHICLES, "can_view": True, "can_create": True, "can_edit": False, "can_delete": False},
    ]
    response = client.put(f"/api/users/{target.uuid}/permissions/", payload, format="json")

    assert response.status_code == 400
    sections = list(target.section_permissions.values_list("section", flat=True))
    assert sections == [Section.RIDERS]  # untouched


def test_is_admin_requires_full_crud_on_every_section(make_user):
    partial = make_user(sections={s: FULL_CRUD for s in ALL_SECTIONS[:-1]})  # missing one section
    assert partial.is_admin is False

    full = make_user(sections={s: FULL_CRUD for s in ALL_SECTIONS})
    assert full.is_admin is True


def test_is_admin_false_when_one_section_missing_an_action():
    from apps.accounts.models import User as U

    user = U.objects.create_user(email="almost@test.com", password="Testpass123!", full_name="Almost")
    for section in ALL_SECTIONS:
        SectionPermission.objects.create(
            user=user, section=section, can_view=True, can_create=True, can_edit=True,
            can_delete=(section != ALL_SECTIONS[0]),  # one section missing delete
        )
    assert user.is_admin is False


def test_superuser_is_admin_without_any_section_rows():
    from apps.accounts.models import User as U

    superuser = U.objects.create_superuser(email="root@test.com", password="Testpass123!", full_name="Root")
    assert superuser.is_admin is True


def test_self_delete_returns_400(admin_user, auth_client):
    client = auth_client(admin_user)
    response = client.delete(f"/api/users/{admin_user.uuid}/")
    assert response.status_code == 400
    assert User.objects.filter(pk=admin_user.pk).exists()


def test_admin_can_delete_other_user(admin_user, auth_client):
    target = User.objects.create_user(email="deleteme@test.com", password="Testpass123!", full_name="D")
    client = auth_client(admin_user)
    response = client.delete(f"/api/users/{target.uuid}/")
    assert response.status_code == 204
    assert not User.objects.filter(pk=target.pk).exists()


def test_non_admin_forbidden_on_users_list(make_user, auth_client):
    non_admin = make_user(sections={Section.RIDERS: FULL_CRUD})  # full CRUD on one section only
    client = auth_client(non_admin)
    response = client.get("/api/users/")
    assert response.status_code == 403


def test_anonymous_users_list_is_401(api_client):
    response = api_client.get("/api/users/")
    assert response.status_code == 401
