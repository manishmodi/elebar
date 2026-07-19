"""Hermetic test settings: SQLite, locmem cache, eager Celery, fast hashing."""

import os

os.environ.setdefault("DATABASE_URL", "")
os.environ.setdefault("REDIS_URL", "")

from .settings import *  # noqa: F401,F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CELERY_TASK_ALWAYS_EAGER = True
# MD5 first for speed (all factory-created users); BCrypt kept available so
# migrate_legacy's imported hashes (and its --self-test) can still verify —
# production carries Argon2/PBKDF2/BCrypt (see settings.py) for the same reason.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
    "django.contrib.auth.hashers.BCryptPasswordHasher",
]
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": []}  # noqa: F405

# Deterministic regardless of the developer's local .env.
DEBUG = True
ALLOWED_HOSTS = ["testserver"]
