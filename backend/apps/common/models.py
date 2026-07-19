"""
Base model mixins shared by every app.

Conventions (do not regress):
- Public identifiers are UUIDs — integer PKs never appear in URLs or payloads.
- User-deletable models soft-delete; hard deletes are reserved for migrations.
"""

import uuid

from django.db import models
from django.utils import timezone


class UuidMixin(models.Model):
    """Integer PK internally, UUID externally. Serializers expose
    `id = UUIDField(source="uuid")`; URLs use `<uuid:...>`."""

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class SoftDeleteQuerySet(models.QuerySet):
    def delete(self):
        return super().update(is_deleted=True, deleted_at=timezone.now())

    def hard_delete(self):
        return super().delete()

    def alive(self):
        return self.filter(is_deleted=False)


class SoftDeleteManager(models.Manager):
    """Default manager hides deleted rows; use `all_objects` to see everything."""

    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db).filter(is_deleted=False)


class SoftDeleteModel(models.Model):
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = SoftDeleteManager()
    all_objects = SoftDeleteQuerySet.as_manager()

    class Meta:
        abstract = True

    def delete(self, using=None, keep_parents=False):
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(update_fields=["is_deleted", "deleted_at"])

    def hard_delete(self, using=None, keep_parents=False):
        super().delete(using=using, keep_parents=keep_parents)


class BaseModel(UuidMixin, TimeStampedModel):
    """Standard base for exposed, non-deletable models."""

    class Meta:
        abstract = True


class OwnedBaseModel(UuidMixin, TimeStampedModel, SoftDeleteModel):
    """Standard base for user-managed records (soft-deletable)."""

    class Meta:
        abstract = True
