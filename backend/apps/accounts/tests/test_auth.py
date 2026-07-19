"""Login happy path + permission matrix, login throttle, refresh rotation,
logout blacklist."""

import pytest
from django.core.cache import cache

from apps.accounts.models import User
from conftest import FULL_CRUD

pytestmark = pytest.mark.django_db

PASSWORD = "Testpass123!"


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _create_user(email="pilot@test.com", **sections):
    user = User.objects.create_user(email=email, password=PASSWORD, full_name="Pilot User")
    return user


def test_login_happy_path_returns_tokens_and_permission_matrix(api_client, make_user):
    user = make_user(email="matrixed@test.com")
    from apps.accounts.models import SectionPermission
    from apps.authz.sections import Section

    SectionPermission.objects.create(
        user=user, section=Section.RIDERS, can_view=True, can_create=True, can_edit=False, can_delete=False
    )
    user.set_password(PASSWORD)
    user.save()

    response = api_client.post(
        "/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json"
    )

    assert response.status_code == 200
    assert "access" in response.data and "refresh" in response.data
    assert response.data["user"]["email"] == user.email
    assert response.data["user"]["id"] == str(user.uuid)
    matrix = response.data["user"]["permissions"]
    assert matrix[Section.RIDERS] == {"view": True, "create": True, "edit": False, "delete": False}
    assert matrix[Section.VEHICLES] == {"view": False, "create": False, "edit": False, "delete": False}
    assert response.data["user"]["is_admin"] is False


def test_login_invalid_credentials_401(api_client):
    response = api_client.post(
        "/api/auth/login/", {"email": "nope@test.com", "password": "wrong"}, format="json"
    )
    assert response.status_code == 401


def test_login_throttled_after_ten_attempts(api_client):
    user = _create_user()
    for _ in range(10):
        response = api_client.post(
            "/api/auth/login/", {"email": user.email, "password": "wrong-password"}, format="json"
        )
        assert response.status_code == 401

    eleventh = api_client.post(
        "/api/auth/login/", {"email": user.email, "password": "wrong-password"}, format="json"
    )
    assert eleventh.status_code == 429


def test_refresh_rotates_and_old_token_401_after_use(api_client):
    user = _create_user()
    login = api_client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
    old_refresh = login.data["refresh"]

    first_refresh = api_client.post("/api/auth/refresh/", {"refresh": old_refresh}, format="json")
    assert first_refresh.status_code == 200
    assert "access" in first_refresh.data

    reused = api_client.post("/api/auth/refresh/", {"refresh": old_refresh}, format="json")
    assert reused.status_code == 401


def test_logout_blacklists_refresh_token(api_client):
    user = _create_user()
    login = api_client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
    access, refresh = login.data["access"], login.data["refresh"]

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    logout = api_client.post("/api/auth/logout/", {"refresh": refresh}, format="json")
    assert logout.status_code == 204

    api_client.credentials()
    reuse = api_client.post("/api/auth/refresh/", {"refresh": refresh}, format="json")
    assert reuse.status_code == 401
