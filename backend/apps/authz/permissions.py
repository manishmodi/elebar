"""
Deny-by-default DRF permission classes.

Every view must declare its section (`section = Section.RIDERS`) or be
explicitly marked public. A view with no declaration is unreachable — that is
intended.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

#: HTTP method -> matrix action
METHOD_ACTION = {
    "GET": "view",
    "HEAD": "view",
    "OPTIONS": "view",
    "POST": "create",
    "PUT": "edit",
    "PATCH": "edit",
    "DELETE": "delete",
}


class RegistryPermission(BasePermission):
    """Global default: deny everything. Views opt in with SectionPermission,
    IsAdmin, or AllowAny — an undeclared endpoint returns 403."""

    def has_permission(self, request, view):
        return False


class IsAuthenticatedActive(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active)


class SectionPermission(IsAuthenticatedActive):
    """Checks the user's (section, action) grant. The view declares
    `section = "<section>"`; the action derives from the HTTP method unless the
    view declares `section_action_overrides = {"POST": "edit"}`."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        section = getattr(view, "section", None)
        if section is None:  # undeclared — deny, never guess
            return False
        overrides = getattr(view, "section_action_overrides", {})
        action = overrides.get(request.method, METHOD_ACTION.get(request.method))
        if action is None:
            return False
        return request.user.has_section_permission(section, action)


class SectionViewPermission(IsAuthenticatedActive):
    """Read-style endpoints that mutate nothing but use POST (e.g. sync
    previews) — requires only `view` on the section."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        section = getattr(view, "section", None)
        if section is None:
            return False
        return request.user.has_section_permission(section, "view")


class IsAdmin(IsAuthenticatedActive):
    """Full-CRUD-on-every-section users only (user management, activity logs)."""

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_admin


class ReadOnly(BasePermission):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS
