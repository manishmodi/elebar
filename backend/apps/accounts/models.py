from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models

from apps.authz.sections import ALL_SECTIONS, Section
from apps.common.models import BaseModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        user = self.create_user(email, password, **extra_fields)
        user.grant_all_sections()
        return user


class User(BaseModel, AbstractBaseUser, PermissionsMixin):
    """ERP operator account. Access is governed by SectionPermission rows —
    a user with no rows can log in but reach nothing (deny-by-default)."""

    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django admin site only

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    objects = UserManager()

    def __str__(self):
        return self.email

    # -- section matrix ------------------------------------------------------

    def permission_matrix(self):
        """{section: {view,create,edit,delete}} for the frontend."""
        rows = {p.section: p for p in self.section_permissions.all()}
        return {
            section: {
                "view": getattr(rows.get(section), "can_view", False),
                "create": getattr(rows.get(section), "can_create", False),
                "edit": getattr(rows.get(section), "can_edit", False),
                "delete": getattr(rows.get(section), "can_delete", False),
            }
            for section in ALL_SECTIONS
        }

    def has_section_permission(self, section, action):
        if self.is_superuser:
            return True
        try:
            row = self.section_permissions.get(section=section)
        except SectionPermission.DoesNotExist:
            return False
        return getattr(row, f"can_{action}", False)

    @property
    def is_admin(self):
        """Admin is derived, not a flag: full CRUD on every section."""
        if self.is_superuser:
            return True
        rows = {p.section: p for p in self.section_permissions.all()}
        return all(
            (p := rows.get(section)) is not None
            and p.can_view and p.can_create and p.can_edit and p.can_delete
            for section in ALL_SECTIONS
        )

    def grant_all_sections(self):
        for section in ALL_SECTIONS:
            SectionPermission.objects.update_or_create(
                user=self,
                section=section,
                defaults={"can_view": True, "can_create": True, "can_edit": True, "can_delete": True},
            )


class SectionPermission(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="section_permissions")
    section = models.CharField(max_length=32, choices=Section.choices)
    can_view = models.BooleanField(default=False)
    can_create = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)
    can_delete = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "section"], name="uniq_user_section"),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.section}"


class ActivityLog(models.Model):
    """Append-only audit trail. `user` is null for service (rider-app) actions;
    `user_name` is denormalized so the trail survives user deletion."""

    class Action(models.TextChoices):
        CREATED = "created"
        UPDATED = "updated"
        DELETED = "deleted"
        LOGIN = "login"
        LOGIN_FAILED = "login_failed"
        LOGOUT = "logout"

    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    user_name = models.CharField(max_length=255)
    action = models.CharField(max_length=16, choices=Action.choices)
    section = models.CharField(max_length=32)
    description = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["section", "action"])]
        ordering = ["-created_at"]


def log_activity(user, action, section, description, user_name=None):
    """Best-effort audit write — never let logging break the request."""
    try:
        ActivityLog.objects.create(
            user=user if getattr(user, "pk", None) else None,
            user_name=user_name or getattr(user, "full_name", "") or "system",
            action=action,
            section=section,
            description=description,
        )
    except Exception:  # pragma: no cover — audit must not raise
        pass
