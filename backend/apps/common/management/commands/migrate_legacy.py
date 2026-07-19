"""
migrate_legacy — one-way import of the legacy Elebhar (TS/Express/Drizzle)
Postgres database into this Django schema.

    python manage.py migrate_legacy --source "$SOURCE_DATABASE_URL" [--dry-run]
        [--only users,riders] [--wipe --yes-i-know]
    python manage.py migrate_legacy --self-test

Design notes (reviewed before the real cutover — keep these true):

- The SOURCE is never written. The psycopg connection is opened with
  ``default_transaction_read_only=on`` and the session is additionally forced
  read-only with SET SESSION CHARACTERISTICS.
- The whole load runs in ONE destination transaction; --dry-run rolls it back
  after printing per-table counts and a warnings summary.
- Legacy integer PKs are never persisted. Each table keeps an in-memory
  {legacy_id: new_obj} map (Ctx.maps) used to resolve FKs; tables run in
  dependency order. New rows get fresh UUIDs from UuidMixin automatically.
- Idempotency: every table upserts on a natural key (users.email,
  vehicles.vehicle_number, rider+date uniques, pay_config parameter+
  effective_from, fleet_handovers.idempotency_key, riders on
  (full_name, phone_number)). Tables without a real natural key use a
  pseudo-key that includes the legacy created_at timestamp — which we preserve
  on insert — so re-runs converge instead of duplicating.
- Money is parsed with Decimal only (never float): commas/whitespace stripped,
  ""/None -> None, garbage -> None + warning (or 0 + warning where the
  destination column is NOT NULL).
- Dates arrive as text "YYYY-MM-DD"; tolerant parsing returns None + warning
  on garbage. Rows missing a REQUIRED date/FK are skipped with a warning.
  Nepali BS date columns stay text and map onto the CharFields.
- Field-name traps carried over deliberately:
  * legacy attendance.distance_in was the MORNING odometer -> morning_odometer;
    distance_out was the EVENING odometer -> evening_odometer.
  * legacy users.password_hash (bcrypt) becomes Django "bcrypt$<hash>" so
    BCryptPasswordHasher verifies it (and upgrades to Argon2 on first login).
"""

import json
import os
from datetime import date, datetime, timezone as dt_timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.contrib.auth.hashers import make_password
from django.core.exceptions import FieldDoesNotExist
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import ActivityLog, SectionPermission, User
from apps.authz.sections import ALL_SECTIONS
from apps.fleet.models import Assignment, Maintenance, ServiceHistory, Vehicle
from apps.operations.models import (
    Attendance,
    CashCollection,
    DailyLog,
    FleetHandover,
    RiderDailyTarget,
    RiderRideStats,
    RiderTargetOverride,
)
from apps.payroll.models import (
    Expense,
    ExpenseCategory,
    PayConfig,
    PayRecord,
    SalaryAdvance,
    SalaryPayment,
    Streak,
)
from apps.riders.models import Rider

# ---------------------------------------------------------------------------
# Infrastructure: warnings context, tolerant row parsing, upsert
# ---------------------------------------------------------------------------

MONEY_MAX = Decimal("9999999999")  # DecimalField(max_digits=12, decimal_places=2)
CENT = Decimal("0.01")

DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y")


class SkipRow(Exception):
    """Raised inside a row handler when the row cannot be loaded."""


class DryRunRollback(Exception):
    """Sentinel to roll the destination transaction back after reporting."""


class SourceTableMissing(Exception):
    """The legacy table does not exist on this source database."""


class Ctx:
    """Shared state for one migration run."""

    def __init__(self):
        self.maps = {}       # legacy table -> {legacy_id: new model instance}
        self.warnings = []   # (table, legacy_pk, column, message)
        self.counts = {}     # table -> {"created"/"updated"/"skipped"/"mapped"/"unmatched": n}
        self.seen_keys = set()      # duplicate-natural-key detection within a run
        self.map_only_tables = set()  # tables processed only to fill self.maps

    def begin_table(self, table):
        self.counts[table] = {"created": 0, "updated": 0, "skipped": 0, "mapped": 0, "unmatched": 0}
        self.maps.setdefault(table, {})

    def bump(self, table, key):
        self.counts[table][key] += 1

    def remember(self, row, obj):
        if obj is not None:
            self.maps[row.table][row.pk] = obj


class Row:
    """One legacy row (dict keyed by legacy column names) + tolerant parsers.

    Every parser logs a warning through self.warn() when it drops a value, so
    the dry-run report shows exactly what will not survive the migration.
    """

    def __init__(self, ctx, table, data):
        self.ctx = ctx
        self.table = table
        self.data = data
        self.pk = data.get("id")

    def warn(self, column, message):
        self.ctx.warnings.append((self.table, self.pk, column or "-", message))

    # -- scalar parsers ------------------------------------------------------

    def text(self, col):
        val = self.data.get(col)
        return "" if val is None else str(val).strip()

    def money(self, col, required=False):
        """Decimal or None. Never float. Garbage -> None (or 0 if required)."""
        fallback = Decimal("0") if required else None
        val = self.data.get(col)
        cleaned = "" if val is None else str(val).replace(",", "").replace(" ", "").strip()
        if cleaned in ("", "-", "null", "None"):
            if required and val not in (None, ""):
                self.warn(col, f"unparseable money value {val!r} -> 0")
            elif required:
                self.warn(col, "required money value missing -> 0")
            return fallback
        try:
            amount = Decimal(cleaned)
        except InvalidOperation:
            self.warn(col, f"unparseable money value {val!r} -> {fallback!r}")
            return fallback
        if not amount.is_finite() or abs(amount) > MONEY_MAX:
            self.warn(col, f"money value out of range {val!r} -> {fallback!r}")
            return fallback
        return amount.quantize(CENT, rounding=ROUND_HALF_UP)

    def date_(self, col, required=False):
        """date or None; text "YYYY-MM-DD" plus a few tolerant formats.
        required=True skips the whole row when no date can be parsed."""
        val = self.data.get(col)
        if isinstance(val, datetime):
            return val.date()
        if isinstance(val, date):
            return val
        text = "" if val is None else str(val).strip()
        if text and text not in ("null", "None", "0000-00-00"):
            for fmt in DATE_FORMATS:
                try:
                    return datetime.strptime(text, fmt).date()
                except ValueError:
                    pass
            try:  # ISO date-times ("2026-05-01T00:00:00Z" etc.)
                return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
            except ValueError:
                pass
            self.warn(col, f"unparseable date {val!r} -> None")
        if required:
            if not text:
                self.warn(col, "required date missing — row skipped")
            else:
                self.warn(col, "required date unparseable — row skipped")
            raise SkipRow
        return None

    def int_(self, col, lo=None, hi=None, required=False):
        val = self.data.get(col)
        n = None
        if isinstance(val, bool):
            n = int(val)
        elif val is not None and str(val).strip() != "":
            try:
                n = int(Decimal(str(val).replace(",", "").strip()))
            except (InvalidOperation, ValueError):
                self.warn(col, f"unparseable integer {val!r} -> None")
        if n is not None and ((lo is not None and n < lo) or (hi is not None and n > hi)):
            self.warn(col, f"integer {n} outside [{lo}, {hi}] -> None")
            n = None
        if n is None and required:
            self.warn(col, "required integer missing/invalid — row skipped")
            raise SkipRow
        return n

    def bool_(self, col, default=None):
        val = self.data.get(col)
        if val is None:
            return default
        if isinstance(val, bool):
            return val
        text = str(val).strip().lower()
        if text in ("t", "true", "1", "yes"):
            return True
        if text in ("f", "false", "0", "no"):
            return False
        self.warn(col, f"unparseable boolean {val!r} -> {default!r}")
        return default

    def dt(self, col):
        """Aware datetime or None. Naive legacy timestamps are assumed UTC."""
        val = self.data.get(col)
        if val is None:
            return None
        if not isinstance(val, datetime):
            try:
                val = datetime.fromisoformat(str(val).strip().replace("Z", "+00:00"))
            except ValueError:
                self.warn(col, f"unparseable timestamp {val!r} -> None")
                return None
        if val.tzinfo is None:
            val = val.replace(tzinfo=dt_timezone.utc)
        return val

    def json_(self, col, default=None):
        val = self.data.get(col)
        if val is None:
            return default
        if isinstance(val, (dict, list)):
            return val
        try:
            return json.loads(val)
        except (TypeError, ValueError):
            self.warn(col, f"unparseable JSON {str(val)[:40]!r} -> {default!r}")
            return default

    def fk(self, col, table, required=False):
        """Resolve a legacy integer FK through Ctx.maps."""
        legacy_id = self.data.get(col)
        if legacy_id is None:
            if required:
                self.warn(col, "required FK missing — row skipped")
                raise SkipRow
            return None
        obj = self.ctx.maps.get(table, {}).get(legacy_id)
        if obj is None:
            self.warn(col, f"unresolved FK {col}={legacy_id} -> {table}"
                           + (" — row skipped" if required else " -> None"))
            if required:
                raise SkipRow
        return obj


def _clip_strings(model, values, row):
    """Truncate over-long strings to the destination CharField max_length."""
    for name, value in list(values.items()):
        if not isinstance(value, str):
            continue
        try:
            field = model._meta.get_field(name)
        except FieldDoesNotExist:
            continue
        max_length = getattr(field, "max_length", None)
        if max_length and len(value) > max_length:
            row.warn(name, f"value truncated to {max_length} chars")
            values[name] = value[:max_length]


def upsert(ctx, row, model, lookup, defaults, force=None):
    """Natural-key upsert. `force` holds auto_now_add-style timestamps we
    preserve from legacy via a post-save queryset .update() (bypassing auto).
    In map-only mode (FK parent of an --only selection) nothing is written —
    we only match existing destination rows to fill the FK maps."""
    _clip_strings(model, lookup, row)
    _clip_strings(model, defaults, row)

    if row.table in ctx.map_only_tables:
        obj = model.objects.filter(**lookup).first()
        if obj is not None:
            ctx.bump(row.table, "mapped")
        else:
            row.warn(None, "map-only: no destination row matches natural key")
            ctx.bump(row.table, "unmatched")
        return obj

    key = (row.table,) + tuple((k, str(v)) for k, v in sorted(lookup.items()))
    if key in ctx.seen_keys:
        row.warn(None, "duplicate natural key in source — merged into earlier row")
    ctx.seen_keys.add(key)

    obj = model.objects.filter(**lookup).first()
    if obj is None:
        obj = model(**lookup, **defaults)
        obj.save()
        ctx.bump(row.table, "created")
    else:
        for name, value in defaults.items():
            setattr(obj, name, value)
        obj.save()
        ctx.bump(row.table, "updated")

    forced = {k: v for k, v in (force or {}).items() if v is not None}
    if forced:
        model.objects.filter(pk=obj.pk).update(**forced)
        for name, value in forced.items():
            setattr(obj, name, value)
    return obj


def _with_created(lookup, created_at):
    """Pseudo-natural-key helper: include the (preserved) legacy created_at so
    keyless tables stay idempotent across re-runs."""
    if created_at is not None:
        lookup["created_at"] = created_at
    return lookup


# ---------------------------------------------------------------------------
# Per-table row handlers (dependency order = TABLES registry order below)
# ---------------------------------------------------------------------------

def migrate_users(ctx, row):
    email = row.text("email").lower()
    if not email:
        row.warn("email", "empty email — row skipped")
        raise SkipRow
    legacy_hash = row.text("password_hash")
    if legacy_hash.startswith("$2"):  # $2a / $2b / $2y bcrypt variants
        password = f"bcrypt${legacy_hash}"  # verified by BCryptPasswordHasher
    else:
        row.warn("password_hash", "not a bcrypt hash — password set unusable")
        password = make_password(None)
    obj = upsert(
        ctx, row, User,
        {"email": email},
        {
            "full_name": row.text("full_name") or email,
            "is_active": row.bool_("is_active", default=True),
            "password": password,
        },
        force={"created_at": row.dt("created_at")},
    )
    ctx.remember(row, obj)


def migrate_user_permissions(ctx, row):
    user = row.fk("user_id", "users", required=True)
    section = row.text("section")
    if section not in ALL_SECTIONS:
        row.warn("section", f"unknown section {section!r} — row skipped")
        raise SkipRow
    upsert(
        ctx, row, SectionPermission,
        {"user": user, "section": section},
        {
            "can_view": row.bool_("can_view", default=False),
            "can_create": row.bool_("can_create", default=False),
            "can_edit": row.bool_("can_edit", default=False),
            "can_delete": row.bool_("can_delete", default=False),
        },
    )


def migrate_riders(ctx, row):
    full_name = row.text("full_name")
    if not full_name:
        row.warn("full_name", "empty full_name — row skipped")
        raise SkipRow
    obj = upsert(
        ctx, row, Rider,
        {"full_name": full_name, "phone_number": row.text("phone_number")},
        {
            # KYC / personal — Gregorian text dates become DateField
            "kyc_submission_date": row.date_("kyc_submission_date"),
            "secondary_phone": row.text("secondary_phone"),
            "date_of_birth": row.date_("date_of_birth"),
            "gender": row.text("gender"),
            "marital_status": row.text("marital_status"),
            "blood_group": row.text("blood_group"),
            "permanent_address": row.text("permanent_address"),
            "temporary_address": row.text("temporary_address"),
            "address": row.text("address"),
            "email": row.text("email"),
            "emergency_contact": row.text("emergency_contact"),
            # Identity documents — issue dates are Nepali BS text, kept as text
            "citizenship_number": row.text("citizenship_number"),
            "citizenship_issue_date": row.text("citizenship_issue_date"),
            "citizenship_issue_district": row.text("citizenship_issue_district"),
            "citizenship_image_url": row.text("citizenship_image_url"),
            "nid_number": row.text("nid_number"),
            "nid_issue_date": row.text("nid_issue_date"),
            "nid_issue_district": row.text("nid_issue_district"),
            # License — expiry is Gregorian (DateField), issue date is BS text
            "license_number": row.text("license_number"),
            "license_expiry_date": row.date_("license_expiry_date"),
            "license_issue_date": row.text("license_issue_date"),
            "license_issue_district": row.text("license_issue_district"),
            "license_type": row.text("license_type"),
            "license_image_url": row.text("license_image_url"),
            "driving_experience": row.text("driving_experience"),
            # Family
            "father_name": row.text("father_name"),
            "father_phone": row.text("father_phone"),
            "mother_name": row.text("mother_name"),
            "mother_phone": row.text("mother_phone"),
            "spouse_name": row.text("spouse_name"),
            "spouse_phone": row.text("spouse_phone"),
            "grandfather_name": row.text("grandfather_name"),
            "grandmother_name": row.text("grandmother_name"),
            "family_address": row.text("family_address"),
            # Emergency contact
            "emergency_contact_name": row.text("emergency_contact_name"),
            "emergency_contact_phone": row.text("emergency_contact_phone"),
            "emergency_contact_relationship": row.text("emergency_contact_relationship"),
            "relationship_proof_url": row.text("relationship_proof_url"),
            # Employment
            "joining_date": row.date_("joining_date"),
            "employment_type": row.text("employment_type") or Rider.EmploymentType.FULL_TIME,
            "salary_structure": row.text("salary_structure"),
            "monthly_salary": row.money("monthly_salary"),
            "daily_ride_target": row.int_("daily_ride_target", lo=0),
            "assigned_supervisor": row.text("assigned_supervisor"),
            "security_deposit": row.money("security_deposit"),
            "bank_account_details": row.text("bank_account_details"),
            "status": row.text("status") or Rider.Status.ACTIVE,
            "yango_driver_id": row.text("yango_driver_id"),
            "fleet_pilot": row.bool_("fleet_pilot", default=False),
        },
        force={"created_at": row.dt("created_at")},
    )
    ctx.remember(row, obj)


def migrate_vehicles(ctx, row):
    vehicle_number = row.text("vehicle_number")
    if not vehicle_number:
        row.warn("vehicle_number", "empty vehicle_number — row skipped")
        raise SkipRow
    obj = upsert(
        ctx, row, Vehicle,
        {"vehicle_number": vehicle_number},
        {
            "plate_number": row.text("plate_number"),
            "vehicle_type": row.text("vehicle_type"),
            "brand": row.text("brand"),
            "model": row.text("model"),
            "manufacture_year": row.int_("manufacture_year", lo=1980, hi=2100),
            "color": row.text("color"),
            "purchase_date": row.date_("purchase_date"),
            "purchase_cost": row.money("purchase_cost"),
            "battery_details": row.text("battery_details"),
            "insurance_issue_date": row.date_("insurance_issue_date"),
            "insurance_expiry": row.date_("insurance_expiry"),
            "tax_expiry": row.date_("tax_expiry"),
            "service_due_date": row.date_("service_due_date"),
            "last_service_date": row.date_("last_service_date"),
            "last_service_odometer": row.int_("last_service_odometer", lo=0),
            "servicing_payment": row.text("servicing_payment"),
            "odometer_reading": row.text("odometer_reading"),
            "status": row.text("status") or Vehicle.Status.ACTIVE,
            "location_branch": row.text("location_branch"),
            "gps_installed": row.text("gps_installed"),
            "gps_number": row.text("gps_number"),
            "gps_id_password": row.text("gps_id_password"),
            "scooter_branding": row.text("scooter_branding"),
            "yango_branding_date": row.date_("yango_branding_date"),
            "branding_payment": row.text("branding_payment"),
            "brandwrap_expire_date": row.date_("brandwrap_expire_date"),
            "bluebook_issue_date": row.date_("bluebook_issue_date"),
            "bluebook_expiry_date": row.date_("bluebook_expiry_date"),
            "in_servicing_since": row.dt("in_servicing_since"),
        },
        force={"created_at": row.dt("created_at")},
    )
    ctx.remember(row, obj)


def migrate_assignments(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    vehicle = row.fk("vehicle_id", "vehicles", required=True)
    start_date = row.date_("start_date", required=True)
    created_at = row.dt("created_at")
    upsert(
        ctx, row, Assignment,
        _with_created({"rider": rider, "vehicle": vehicle, "start_date": start_date}, created_at),
        {
            "end_date": row.date_("end_date"),
            "shift_type": row.text("shift_type") or Assignment.Shift.DAY,
            "status": row.text("status") or Assignment.Status.ACTIVE,
        },
        force={"created_at": created_at},
    )


def migrate_daily_logs(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    vehicle = row.fk("vehicle_id", "vehicles", required=True)
    english_date = row.date_("english_date", required=True)
    upsert(
        ctx, row, DailyLog,
        {"rider": rider, "english_date": english_date},
        {
            "vehicle": vehicle,
            "nepali_date": row.text("nepali_date"),  # BS text, stays text
            "check_in_time": row.text("check_in_time"),
            "check_out_time": row.text("check_out_time"),
            "daily_bonus_set": row.int_("daily_bonus_set", lo=0),
            "total_rides_received": row.int_("total_rides_received", lo=0),
            "rides_completed": row.int_("rides_completed", lo=0),
            "acceptance_rate": row.text("acceptance_rate"),
            "bonus_target_completion": row.bool_("bonus_target_completion"),
            "total_ride_distance_km": row.text("total_ride_distance_km"),
            "total_ride_hours": row.text("total_ride_hours"),
            "total_app_online": row.text("total_app_online"),
            "cash_as_per_app": row.money("cash_as_per_app"),
            "goal_bonus": row.money("goal_bonus"),
            "promotion_bonus_other": row.money("promotion_bonus_other"),
            "total_income": row.money("total_income"),
            "cash_given_by_driver": row.money("cash_given_by_driver"),
            "cash_transferred_online": row.money("cash_transferred_online"),
            "cash_check": row.money("cash_check"),
            "daily_allowance": row.money("daily_allowance"),
            "additional_expenses": row.money("additional_expenses"),
            "remarks": row.text("remarks"),
            "is_draft": row.bool_("is_draft", default=False),
            "yango_synced_at": row.dt("yango_synced_at"),
        },
        force={"created_at": row.dt("created_at")},
    )


def migrate_attendance(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    day = row.date_("date", required=True)
    upsert(
        ctx, row, Attendance,
        {"rider": rider, "date": day},
        {
            "nepali_date": row.text("nepali_date"),
            "type": row.text("type") or Attendance.Type.PRESENT,
            "remarks": row.text("remarks"),
            "vehicle": row.fk("vehicle_id", "vehicles"),
            "battery_out": row.int_("battery_out", lo=0, hi=100),
            "battery_in": row.int_("battery_in", lo=0, hi=100),
            "scooter_out": row.text("scooter_out"),
            "scooter_in": row.text("scooter_in"),
            "rider_time_in": row.text("rider_time_in"),
            "rider_time_out": row.text("rider_time_out"),
            # Legacy naming was inverted: distance_in = MORNING odometer,
            # distance_out = EVENING odometer.
            "morning_odometer": row.int_("distance_in", lo=0),
            "evening_odometer": row.int_("distance_out", lo=0),
            "vehicle_override_reason": row.text("vehicle_override_reason"),
        },
        force={"created_at": row.dt("created_at")},
    )


def migrate_maintenance(ctx, row):
    vehicle = row.fk("vehicle_id", "vehicles", required=True)
    day = row.date_("date", required=True)
    created_at = row.dt("created_at")
    upsert(
        ctx, row, Maintenance,
        _with_created(
            {"vehicle": vehicle, "date": day, "maintenance_type": row.text("maintenance_type")},
            created_at,
        ),
        {
            "cost": row.money("cost"),
            "description": row.text("description"),
            "next_service_date": row.date_("next_service_date"),
        },
        force={"created_at": created_at},
    )


def migrate_service_history(ctx, row):
    vehicle = row.fk("vehicle_id", "vehicles", required=True)
    service_date = row.date_("service_date", required=True)
    created_at = row.dt("created_at")
    upsert(
        ctx, row, ServiceHistory,
        _with_created({"vehicle": vehicle, "service_date": service_date}, created_at),
        {
            "odometer_at_service": row.int_("odometer_at_service", lo=0, required=True),
            "notes": row.text("notes"),
            "cost": row.money("cost"),
        },
        force={"created_at": created_at},
    )


ACTIVITY_ACTION_ALIASES = {
    "create": "created", "created": "created",
    "update": "updated", "updated": "updated",
    "delete": "deleted", "deleted": "deleted",
    "login": "login", "logout": "logout",
    "login_failed": "login_failed", "failed_login": "login_failed",
}


def migrate_activity_logs(ctx, row):
    action_raw = row.text("action").lower()
    action = ACTIVITY_ACTION_ALIASES.get(action_raw)
    if action is None:
        action = action_raw[:16]
        row.warn("action", f"unknown action {action_raw!r} — kept verbatim")
    created_at = row.dt("created_at")  # legacy column is naive; treated as UTC
    upsert(
        ctx, row, ActivityLog,
        _with_created(
            {"user_name": row.text("user_name") or "system", "action": action,
             "section": row.text("section")},
            created_at,
        ),
        {
            # Legacy user_id has no FK constraint; unresolved -> None (SET_NULL semantics)
            "user": row.fk("user_id", "users"),
            "description": row.text("description"),
        },
        force={"created_at": created_at},
    )


def migrate_salary_payments(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    period_from = row.date_("period_from", required=True)
    period_to = row.date_("period_to", required=True)
    processed_at = row.dt("processed_at")
    pay_model = row.text("pay_model") or SalaryPayment.PayModel.LEGACY
    if pay_model not in SalaryPayment.PayModel.values:
        row.warn("pay_model", f"unknown pay_model {pay_model!r} -> 'legacy'")
        pay_model = SalaryPayment.PayModel.LEGACY
    lookup = {"rider": rider, "period_from": period_from, "period_to": period_to}
    if processed_at is not None:  # pseudo-key part (voided+reprocessed periods)
        lookup["processed_at"] = processed_at
    obj = upsert(
        ctx, row, SalaryPayment,
        lookup,
        {
            "days_worked": row.int_("days_worked", lo=0) or 0,
            "times_target_missed": row.int_("times_target_missed", lo=0) or 0,
            "base_salary": row.money("base_salary", required=True),
            "total_allowances": row.money("total_allowances", required=True),
            "total_advances": row.money("total_advances", required=True),
            "total_cash_variance": row.money("total_cash_variance", required=True),
            "final_salary": row.money("final_salary", required=True),
            "salary_processed": row.money("salary_processed"),
            "salary_difference": row.money("salary_difference"),
            "pay_model": pay_model,
            "flagged": row.bool_("flagged", default=False),
            "processed_by": row.text("processed_by"),
            "notes": row.text("notes"),
        },
        force={"processed_at": processed_at},
    )
    ctx.remember(row, obj)


def migrate_salary_advances(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    day = row.date_("date", required=True)
    amount = row.money("amount", required=True)
    created_at = row.dt("created_at")
    upsert(
        ctx, row, SalaryAdvance,
        _with_created({"rider": rider, "date": day, "amount": amount}, created_at),
        {
            "notes": row.text("notes"),
            "applied_at": row.dt("applied_at"),
            "salary_payment": row.fk("salary_payment_id", "salary_payments"),
        },
        force={"created_at": created_at},
    )


def migrate_expense_categories(ctx, row):
    name = row.text("name")
    if not name:
        row.warn("name", "empty category name — row skipped")
        raise SkipRow
    obj = upsert(
        ctx, row, ExpenseCategory,
        {"name": name},
        {"description": row.text("description")},
        force={"created_at": row.dt("created_at")},
    )
    ctx.remember(row, obj)


def migrate_expenses(ctx, row):
    category = row.fk("category_id", "expense_categories", required=True)
    day = row.date_("date", required=True)
    amount = row.money("amount", required=True)
    created_at = row.dt("created_at")
    upsert(
        ctx, row, Expense,
        _with_created({"category": category, "date": day, "amount": amount}, created_at),
        {
            "notes": row.text("notes"),
            "rider": row.fk("rider_id", "riders"),
            "vehicle": row.fk("vehicle_id", "vehicles"),
            "created_by": row.text("created_by"),
        },
        force={"created_at": created_at},
    )


def migrate_cash_collections(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    english_date = row.date_("english_date", required=True)
    upsert(
        ctx, row, CashCollection,
        {"rider": rider, "english_date": english_date},
        {
            "nepali_date": row.text("nepali_date"),
            "denom_1000": row.int_("denom_1000", lo=0) or 0,
            "denom_500": row.int_("denom_500", lo=0) or 0,
            "denom_100": row.int_("denom_100", lo=0) or 0,
            "denom_50": row.int_("denom_50", lo=0) or 0,
            "denom_20": row.int_("denom_20", lo=0) or 0,
            "denom_10": row.int_("denom_10", lo=0) or 0,
            "cash_total": row.money("cash_total", required=True),
            "wallet_amount": row.money("wallet_amount", required=True),
            "grand_total": row.money("grand_total", required=True),
            "note": row.text("note"),
            "submitted_by": row.fk("submitted_by", "users"),
            "submitted_by_name": row.text("submitted_by_name"),
            "approval_status": row.text("approval_status") or CashCollection.ApprovalStatus.PENDING,
            "approved_by": row.fk("approved_by", "users"),
            "approved_by_name": row.text("approved_by_name"),
            "approved_at": row.dt("approved_at"),
            "approval_note": row.text("approval_note"),
        },
        force={"submitted_at": row.dt("submitted_at")},
    )


# Legacy rider-app payload keys -> the keys verify_handover consumes. Legacy
# rows carry camelCase (odometerOut/batteryOutPct/...); an untranslated
# pending handover would verify into all-None attendance readings.
HANDOVER_KEY_MAP = {
    "odometerOut": "odometer", "odometerIn": "odometer",
    "odometer": "odometer",
    "batteryOutPct": "battery", "batteryInPct": "battery",
    "battery": "battery",
    "goalTier": "goal_tier",
    "cashDeclared": "cash",
    "walletDeclared": "wallet",
    "photoPaths": "photo_paths",
    "time": "time",
    "reason": "reason",
}


def _translate_handover_payload(payload, row):
    """Map legacy camelCase payload keys to the new consumer's keys; exchange
    payloads translate their closing/opening legs recursively. Unknown keys
    are kept verbatim with a warning (visible in the dry-run report)."""
    if not isinstance(payload, dict):
        return payload
    translated = {}
    for key, value in payload.items():
        if key in ("closing", "opening") and isinstance(value, dict):
            translated[key] = _translate_handover_payload(value, row)
            continue
        new_key = HANDOVER_KEY_MAP.get(key)
        if new_key is None:
            row.warn("payload", f"unknown handover payload key {key!r} — kept verbatim")
            new_key = key
        translated[new_key] = value
    return translated


def migrate_fleet_handovers(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    english_date = row.date_("english_date", required=True)
    idempotency_key = row.text("idempotency_key")
    if not idempotency_key:
        row.warn("idempotency_key", "empty idempotency_key — row skipped")
        raise SkipRow
    payload = row.json_("payload")
    if payload is None:
        row.warn("payload", "null payload -> {}")
        payload = {}
    payload = _translate_handover_payload(payload, row)
    upsert(
        ctx, row, FleetHandover,
        {"idempotency_key": idempotency_key},
        {
            "rider": rider,
            "english_date": english_date,
            "kind": row.text("kind"),
            "status": row.text("status") or FleetHandover.Status.PENDING,
            "payload": payload,
            "vehicle": row.fk("vehicle_id", "vehicles"),
            "cash_expected": row.money("cash_expected"),
            "cash_variance": row.money("cash_variance"),
            "verified_by": row.fk("verified_by", "users"),
            "verified_by_name": row.text("verified_by_name"),
            "verified_at": row.dt("verified_at"),
            "reject_reason": row.text("reject_reason"),
        },
        force={"submitted_at": row.dt("submitted_at")},
    )


# Legacy ramp tiers are camelCase; the pay engine reads snake_case — an
# untranslated ramp would KeyError inside every pay lock post-cutover.
RAMP_TIER_KEY_MAP = {
    "fromDay": "from_day", "toDay": "to_day",
    "gateRides": "gate_rides", "gateCash": "gate_cash",
    "prize": "prize",
}


def _translate_ramp_value(value, row):
    try:
        tiers = json.loads(value)
    except (TypeError, ValueError):
        row.warn("value", "ramp value is not valid JSON — kept verbatim")
        return value
    if not isinstance(tiers, list):
        row.warn("value", "ramp value is not a JSON array — kept verbatim")
        return value
    translated = [
        {RAMP_TIER_KEY_MAP.get(k, k): v for k, v in tier.items()}
        if isinstance(tier, dict) else tier
        for tier in tiers
    ]
    return json.dumps(translated)


def migrate_pay_config(ctx, row):
    parameter = row.text("parameter")
    if not parameter:
        row.warn("parameter", "empty parameter — row skipped")
        raise SkipRow
    if parameter not in PayConfig.Parameter.values:
        row.warn("parameter", f"unknown pay_config parameter {parameter!r} — kept verbatim")
    value = row.text("value")
    if parameter == PayConfig.Parameter.RAMP:
        value = _translate_ramp_value(value, row)
    upsert(
        ctx, row, PayConfig,
        {"parameter": parameter, "effective_from": row.date_("effective_from", required=True)},
        {"value": value},
        force={"created_at": row.dt("created_at")},
    )


def migrate_pay_records(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    english_date = row.date_("english_date", required=True)
    upsert(
        ctx, row, PayRecord,
        {"rider": rider, "english_date": english_date},
        {
            "base": row.money("base", required=True),
            "commission": row.money("commission", required=True),
            "prize": row.money("prize", required=True),
            "growth": row.money("growth", required=True),
            "daily_pay": row.money("daily_pay", required=True),
            "gates_applied": row.json_("gates_applied", default={}) or {},
            "flags": row.json_("flags", default={}) or {},
            "status": row.text("status") or PayRecord.Status.COMPUTED,
            "computed_at": row.dt("computed_at"),
            "locked_at": row.dt("locked_at"),
        },
        force={"created_at": row.dt("computed_at")},
    )


def migrate_streaks(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    upsert(
        ctx, row, Streak,
        {"rider": rider},
        {
            "current_streak": row.int_("current_streak", lo=0) or 0,
            "best_streak": row.int_("best_streak", lo=0) or 0,
            "last_qualifying_date": row.date_("last_qualifying_date"),
        },
    )


def migrate_rider_daily_targets(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    day = row.date_("date", required=True)
    upsert(
        ctx, row, RiderDailyTarget,
        {"rider": rider, "date": day},
        {
            "working_day_count": row.int_("working_day_count", lo=0) or 0,
            "avg_7day": row.text("avg_7day"),
            "tier": row.text("tier") or "new",
            "tier_adj": row.int_("tier_adj") or 0,  # may be negative
            "tier_c_streak": row.int_("tier_c_streak", lo=0) or 0,
            "improvement_streak": row.int_("improvement_streak", lo=0) or 0,
            "tier_c_accel": row.bool_("tier_c_accel", default=False),
            "calculated_target": row.int_("calculated_target", lo=0, required=True),
            "final_target": row.int_("final_target", lo=0, required=True),
            "needs_hr_review": row.bool_("needs_hr_review", default=False),
            "computed_at": row.dt("computed_at"),
        },
    )


def migrate_rider_ride_stats(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    day = row.date_("date", required=True)
    upsert(
        ctx, row, RiderRideStats,
        {"rider": rider, "date": day},
        {
            "rides_completed": row.int_("rides_completed", lo=0) or 0,
            "rides_received": row.int_("rides_received", lo=0) or 0,
            "pulled_at": row.dt("pulled_at"),
        },
    )


def migrate_rider_target_overrides(ctx, row):
    rider = row.fk("rider_id", "riders", required=True)
    day = row.date_("date", required=True)
    created_at = row.dt("created_at")
    upsert(
        ctx, row, RiderTargetOverride,
        _with_created({"rider": rider, "date": day}, created_at),
        {
            # Legacy overridden_by is an unconstrained integer; unresolved -> None
            "overridden_by": row.fk("overridden_by", "users"),
            "overridden_by_name": row.text("overridden_by_name"),
            "from_target": row.int_("from_target", lo=0, required=True),
            "to_target": row.int_("to_target", lo=0, required=True),
            "reason": row.text("reason"),
        },
        force={"created_at": created_at},
    )


# ---------------------------------------------------------------------------
# Registry: (legacy table, destination model, per-row handler, FK parents)
# Order = load order = dependency order. --wipe deletes in REVERSE order.
# ---------------------------------------------------------------------------

TABLES = [
    ("users", User, migrate_users, ()),
    ("user_permissions", SectionPermission, migrate_user_permissions, ("users",)),
    ("riders", Rider, migrate_riders, ()),
    ("vehicles", Vehicle, migrate_vehicles, ()),
    ("assignments", Assignment, migrate_assignments, ("riders", "vehicles")),
    ("daily_logs", DailyLog, migrate_daily_logs, ("riders", "vehicles")),
    ("attendance", Attendance, migrate_attendance, ("riders", "vehicles")),
    ("maintenance", Maintenance, migrate_maintenance, ("vehicles",)),
    ("service_history", ServiceHistory, migrate_service_history, ("vehicles",)),
    ("activity_logs", ActivityLog, migrate_activity_logs, ("users",)),
    ("salary_payments", SalaryPayment, migrate_salary_payments, ("riders",)),
    ("salary_advances", SalaryAdvance, migrate_salary_advances, ("riders", "salary_payments")),
    ("expense_categories", ExpenseCategory, migrate_expense_categories, ()),
    ("expenses", Expense, migrate_expenses, ("expense_categories", "riders", "vehicles")),
    ("cash_collections", CashCollection, migrate_cash_collections, ("riders", "users")),
    ("fleet_handovers", FleetHandover, migrate_fleet_handovers, ("riders", "vehicles", "users")),
    ("pay_config", PayConfig, migrate_pay_config, ()),
    ("pay_records", PayRecord, migrate_pay_records, ("riders",)),
    ("streaks", Streak, migrate_streaks, ("riders",)),
    ("rider_daily_targets", RiderDailyTarget, migrate_rider_daily_targets, ("riders",)),
    ("rider_ride_stats", RiderRideStats, migrate_rider_ride_stats, ("riders",)),
    ("rider_target_overrides", RiderTargetOverride, migrate_rider_target_overrides, ("riders", "users")),
]

SPEC = {table: (model, fn, parents) for table, model, fn, parents in TABLES}
TABLE_ORDER = [t for t, *_ in TABLES]


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

class PgSource:
    """Read-only psycopg connection to the legacy database."""

    def __init__(self, dsn):
        import psycopg
        from psycopg.rows import dict_row

        if dsn.startswith("postgres://"):  # psycopg wants the long scheme
            dsn = "postgresql://" + dsn[len("postgres://"):]
        self.psycopg = psycopg
        self.conn = psycopg.connect(
            dsn,
            row_factory=dict_row,
            autocommit=True,  # per-statement; read-only enforced below
            options="-c default_transaction_read_only=on",
        )
        with self.conn.cursor() as cur:
            cur.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")

    def rows(self, table):
        if table not in SPEC:  # identifier allowlist — never interpolate user input
            raise CommandError(f"unknown legacy table {table!r}")
        try:
            with self.conn.cursor() as cur:
                cur.execute(f'SELECT * FROM "{table}" ORDER BY id')
                return cur.fetchall()
        except self.psycopg.errors.UndefinedTable:
            raise SourceTableMissing(table)

    def close(self):
        self.conn.close()


class FixtureSource:
    """--self-test stand-in: {table: [row dicts]} instead of a cursor."""

    def __init__(self, fixture):
        self.fixture = fixture

    def rows(self, table):
        if table not in self.fixture:
            raise SourceTableMissing(table)
        return self.fixture[table]

    def close(self):
        pass


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------

class Command(BaseCommand):
    help = (
        "One-way import of the legacy Elebhar Postgres database. The source is "
        "opened read-only; the destination load runs in a single transaction. "
        "Safe to re-run (natural-key upserts). Use --dry-run first."
    )

    def add_arguments(self, parser):
        parser.add_argument("--source", help="Legacy Postgres URL (e.g. $SOURCE_DATABASE_URL)")
        parser.add_argument("--dry-run", action="store_true",
                            help="Run the full load, print the report, then roll back")
        parser.add_argument("--only", default="",
                            help="Comma-separated legacy table names to load; FK parents "
                                 "are auto-resolved read-only against existing rows")
        parser.add_argument("--wipe", action="store_true",
                            help="DELETE all destination rows of the selected tables first "
                                 "(users included — this removes ERP accounts!)")
        parser.add_argument("--yes-i-know", action="store_true",
                            help="Required confirmation flag for --wipe")
        parser.add_argument("--self-test", action="store_true",
                            help="Run the parse/mapping pipeline against an in-memory "
                                 "fixture (no source DB needed) and roll back")

    # -- entry point ---------------------------------------------------------

    def handle(self, *args, **opts):
        if opts["self_test"]:
            return self.run_self_test()

        # Prefer the env var: a DSN on argv exposes the password to `ps` and
        # shell history. --source stays as an override for ad-hoc use.
        source = opts["source"] or os.environ.get("SOURCE_DATABASE_URL", "")
        if not source:
            raise CommandError(
                "Set SOURCE_DATABASE_URL (preferred) or pass --source (or use --self-test)."
            )
        opts["source"] = source
        if opts["wipe"] and not opts["yes_i_know"]:
            raise CommandError("--wipe is destructive; pass --yes-i-know to confirm.")

        plan = self.build_plan(opts["only"])
        src = PgSource(opts["source"])
        try:
            self.execute_run(src, plan, dry_run=opts["dry_run"], wipe=opts["wipe"])
        finally:
            src.close()

    # -- planning ------------------------------------------------------------

    def build_plan(self, only_arg):
        """[(table, "load"|"map")] in dependency order. Map-only tables are FK
        parents of an --only selection: they fill Ctx.maps from existing
        destination rows but never write."""
        if not only_arg.strip():
            return [(t, "load") for t in TABLE_ORDER]
        selected = {t.strip() for t in only_arg.split(",") if t.strip()}
        unknown = selected - set(TABLE_ORDER)
        if unknown:
            raise CommandError(
                f"unknown table(s) {sorted(unknown)}; valid: {', '.join(TABLE_ORDER)}"
            )
        needed = set()

        def add_parents(table):
            for parent in SPEC[table][2]:
                if parent not in selected and parent not in needed:
                    needed.add(parent)
                    add_parents(parent)

        for table in selected:
            add_parents(table)
        return [
            (t, "load" if t in selected else "map")
            for t in TABLE_ORDER
            if t in selected or t in needed
        ]

    # -- execution -----------------------------------------------------------

    def execute_run(self, src, plan, *, dry_run, wipe):
        try:
            with transaction.atomic():
                if wipe:
                    self.wipe_tables([t for t, mode in plan if mode == "load"])
                ctx = self.run_pipeline(src, plan)
                self.report(ctx, plan)
                if dry_run:
                    raise DryRunRollback
            self.stdout.write(self.style.SUCCESS("Committed."))
        except DryRunRollback:
            self.stdout.write(self.style.WARNING(
                "Dry run — transaction rolled back; no changes were committed."
            ))

    def run_pipeline(self, src, plan):
        ctx = Ctx()
        ctx.map_only_tables = {t for t, mode in plan if mode == "map"}
        for table, _mode in plan:
            model, fn, _parents = SPEC[table]
            ctx.begin_table(table)
            try:
                rows = src.rows(table)
            except SourceTableMissing:
                ctx.warnings.append((table, "-", "-", "legacy table missing on source — skipped"))
                continue
            for data in rows:
                row = Row(ctx, table, data)
                try:
                    fn(ctx, row)
                except SkipRow:
                    ctx.bump(table, "skipped")
        return ctx

    def wipe_tables(self, tables):
        self.stdout.write(self.style.WARNING(f"Wiping destination tables: {', '.join(tables)}"))
        for table in reversed(TABLE_ORDER):  # children before parents (PROTECT FKs)
            if table not in tables:
                continue
            model = SPEC[table][0]
            deleted, _ = model.objects.all().delete()
            self.stdout.write(f"  wiped {table}: {deleted} rows")

    # -- reporting -----------------------------------------------------------

    def report(self, ctx, plan):
        modes = dict(plan)
        warn_counts = {}
        for table, *_ in ctx.warnings:
            warn_counts[table] = warn_counts.get(table, 0) + 1

        self.stdout.write("")
        self.stdout.write(
            f"{'table':<24}{'mode':<6}{'created':>9}{'updated':>9}"
            f"{'skipped':>9}{'mapped':>9}{'warn':>7}"
        )
        for table, counts in ctx.counts.items():
            self.stdout.write(
                f"{table:<24}{modes.get(table, '-'):<6}"
                f"{counts['created']:>9}{counts['updated']:>9}{counts['skipped']:>9}"
                f"{counts['mapped']:>9}{warn_counts.get(table, 0):>7}"
            )

        if ctx.warnings:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(f"{len(ctx.warnings)} warning(s):"))
            shown = ctx.warnings[:200]
            for table, pk, column, message in shown:
                self.stdout.write(f"  {table}#{pk} {column}: {message}")
            if len(ctx.warnings) > len(shown):
                self.stdout.write(f"  ... and {len(ctx.warnings) - len(shown)} more")
        else:
            self.stdout.write(self.style.SUCCESS("No warnings."))

    # -----------------------------------------------------------------------
    # Self-test: fixture rows through the real pipeline, twice, then rollback
    # -----------------------------------------------------------------------

    def run_self_test(self):
        fixture, secrets = _build_fixture()
        src = FixtureSource(fixture)
        plan = self.build_plan("")
        try:
            with transaction.atomic():
                ctx1 = self.run_pipeline(src, plan)
                self.report(ctx1, plan)
                _self_test_asserts_pass1(ctx1, secrets)
                # Second pass over the same source: must be a pure no-op upsert.
                ctx2 = self.run_pipeline(src, plan)
                _self_test_asserts_pass2(ctx2)
                raise DryRunRollback
        except DryRunRollback:
            pass
        self.stdout.write(self.style.SUCCESS(
            "SELF-TEST PASSED (2 passes, idempotent; transaction rolled back)"
        ))


def _check(cond, msg):
    if not cond:
        raise CommandError(f"self-test failed: {msg}")


def _build_fixture():
    """Representative legacy rows, including deliberately dirty values."""
    import bcrypt

    T0 = datetime(2026, 5, 1, 4, 30, tzinfo=dt_timezone.utc)
    password = "Secret#123"
    bcrypt_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()

    fixture = {
        "users": [
            {"id": 1, "full_name": "Legacy Admin", "email": " Legacy.Admin@Example.com ",
             "password_hash": bcrypt_hash, "is_active": True, "created_at": T0},
            {"id": 2, "full_name": "Broken Hash", "email": "broken@example.com",
             "password_hash": "plaintext-oops", "is_active": False, "created_at": T0},
        ],
        "user_permissions": [
            {"id": 1, "user_id": 1, "section": "daily-logs",
             "can_view": True, "can_create": True, "can_edit": True, "can_delete": True},
            {"id": 2, "user_id": 1, "section": "made-up-section",
             "can_view": True, "can_create": False, "can_edit": False, "can_delete": False},
            {"id": 3, "user_id": 2, "section": "attendance",
             "can_view": True, "can_create": False, "can_edit": False, "can_delete": False},
        ],
        "riders": [
            {"id": 1, "full_name": "Pemba Selftest", "phone_number": "9800000001",
             "kyc_submission_date": "13/45/2020",       # garbage -> None + warning
             "date_of_birth": "1995-04-12",
             "citizenship_issue_date": "2052-01-15",    # BS date stays text
             "monthly_salary": " 15,000.50 ",           # money cleanup
             "security_deposit": "", "daily_ride_target": 25,
             "employment_type": None, "status": "active", "fleet_pilot": True,
             "yango_driver_id": "yd-123", "created_at": T0},
            {"id": 2, "full_name": "Dawa Selftest", "phone_number": "9800000002",
             "monthly_salary": "abc",                    # garbage -> None + warning
             "status": "inactive", "created_at": T0},
        ],
        "vehicles": [
            {"id": 1, "vehicle_number": "V-901", "plate_number": "BA-2-PA 1234",
             "purchase_cost": "2,50,000", "purchase_date": "2025-01-15",
             "manufacture_year": 2024, "odometer_reading": "12500",
             "status": "active", "created_at": T0},
        ],
        "assignments": [
            {"id": 1, "rider_id": 1, "vehicle_id": 1, "start_date": "2025-02-01",
             "end_date": None, "shift_type": "day", "status": "active", "created_at": T0},
        ],
        "daily_logs": [
            {"id": 1, "rider_id": 1, "vehicle_id": 1, "english_date": "2026-05-01",
             "nepali_date": "2083-01-18", "cash_as_per_app": "1,234",
             "goal_bonus": "N/A",                        # garbage -> None + warning
             "total_income": "2200.755",                 # quantized to 2 dp
             "rides_completed": 24, "is_draft": False, "bonus_target_completion": True,
             "yango_synced_at": T0, "created_at": T0},
            {"id": 2, "rider_id": 2, "vehicle_id": 1, "english_date": "not-a-date",
             "created_at": T0},                          # required date -> skipped
        ],
        "attendance": [
            {"id": 1, "rider_id": 1, "date": "2026-05-01", "type": "present",
             "vehicle_id": 1,
             "battery_out": 150,                         # out of 0-100 -> None + warning
             "battery_in": 95,
             "distance_in": "12,345",                    # MORNING odometer
             "distance_out": "12400",                    # EVENING odometer
             "rider_time_in": "06:15", "created_at": T0},
        ],
        "maintenance": [
            {"id": 1, "vehicle_id": 1, "maintenance_type": "battery_service",
             "date": "2026-03-10", "cost": "1500", "next_service_date": "",
             "created_at": T0},
        ],
        "service_history": [
            {"id": 1, "vehicle_id": 1, "service_date": "2026-04-01",
             "odometer_at_service": 12000, "cost": "800.5", "created_at": T0},
        ],
        "activity_logs": [
            {"id": 1, "user_id": 1, "user_name": "Legacy Admin", "action": "create",
             "section": "riders", "description": "Created rider",
             "created_at": datetime(2026, 5, 1, 4, 30)},  # naive -> assumed UTC
        ],
        "salary_payments": [
            {"id": 1, "rider_id": 1, "period_from": "2026-04-01", "period_to": "2026-04-30",
             "days_worked": 26, "times_target_missed": 1, "base_salary": "18000",
             "total_allowances": "0", "total_advances": "2000", "total_cash_variance": "150",
             "final_salary": "15850", "salary_processed": "15850", "salary_difference": "0",
             "pay_model": "vpe", "flagged": False, "processed_at": T0,
             "processed_by": "Legacy Admin"},
        ],
        "salary_advances": [
            {"id": 1, "rider_id": 1, "date": "2026-04-15", "amount": "2,000",
             "notes": "fuel", "applied_at": T0, "salary_payment_id": 1, "created_at": T0},
        ],
        "expense_categories": [
            {"id": 1, "name": "Charging (selftest)", "description": "", "created_at": T0},
        ],
        "expenses": [
            {"id": 1, "category_id": 1, "date": "2026-04-20", "amount": "1 500",
             "rider_id": 1, "vehicle_id": 1, "created_by": "Legacy Admin",
             "created_at": T0},
        ],
        "cash_collections": [
            {"id": 1, "rider_id": 1, "english_date": "2026-05-01",
             "nepali_date": "2083-01-18", "denom_1000": 2, "denom_500": 1,
             "denom_100": 3, "denom_50": 0, "denom_20": 0, "denom_10": 0,
             "cash_total": "2800", "wallet_amount": "500", "grand_total": "3300",
             "note": None, "submitted_by": 1, "submitted_by_name": "Legacy Admin",
             "submitted_at": T0, "approval_status": "approved", "approved_by": 1,
             "approved_by_name": "Legacy Admin", "approved_at": T0},
        ],
        "fleet_handovers": [
            {"id": 1, "rider_id": 1, "english_date": "2026-05-01", "kind": "checkin",
             "status": "verified", "idempotency_key": "selftest-r1-20260501-checkin",
             "payload": {"odometer": 12400, "battery": 95}, "vehicle_id": 1,
             "cash_expected": "3300", "cash_variance": "0", "submitted_at": T0,
             "verified_by": 1, "verified_by_name": "Legacy Admin", "verified_at": T0},
        ],
        "pay_config": [
            {"id": 1, "parameter": "base_amount", "value": "600",
             "effective_from": "2026-07-01", "created_at": T0},
            {"id": 2, "parameter": "ramp",
             "value": '[{"fromDay":1,"toDay":3,"gateRides":17}]',
             "effective_from": "2026-07-01", "created_at": T0},
        ],
        "pay_records": [
            {"id": 1, "rider_id": 1, "english_date": "2026-05-01", "base": "600",
             "commission": "240.5", "prize": "250", "growth": "0", "daily_pay": "1090.5",
             "gates_applied": None,                      # null jsonb -> {}
             "flags": {"gatesHit": True}, "status": "locked",
             "computed_at": T0, "locked_at": T0},
        ],
        "streaks": [
            {"id": 1, "rider_id": 1, "current_streak": 3, "best_streak": 7,
             "last_qualifying_date": "2026-05-01", "updated_at": T0},
        ],
        "rider_daily_targets": [
            {"id": 1, "rider_id": 1, "date": "2026-05-01", "working_day_count": 40,
             "avg_7day": "23.4", "tier": "B", "tier_adj": -1, "calculated_target": 24,
             "final_target": 24, "computed_at": T0},
        ],
        "rider_ride_stats": [
            {"id": 1, "rider_id": 1, "date": "2026-05-01", "rides_completed": 24,
             "rides_received": 30, "pulled_at": T0},
        ],
        "rider_target_overrides": [
            {"id": 1, "rider_id": 1, "date": "2026-05-02", "overridden_by": 1,
             "overridden_by_name": "Legacy Admin", "from_target": 26, "to_target": 22,
             "reason": "injury recovery", "created_at": T0},
        ],
    }
    return fixture, {"password": password, "T0": T0}


def _has_warning(ctx, table, pk, column):
    return any(w[0] == table and w[1] == pk and w[2] == column for w in ctx.warnings)


def _self_test_asserts_pass1(ctx, secrets):
    T0 = secrets["T0"]

    # users: bcrypt hash format + verification; bad hash -> unusable
    admin = ctx.maps["users"][1]
    _check(admin.email == "legacy.admin@example.com", "user email not normalized")
    _check(admin.password.startswith("bcrypt$$2"), f"unexpected password format {admin.password[:12]!r}")
    _check(admin.check_password(secrets["password"]), "bcrypt password does not verify")
    _check(not ctx.maps["users"][2].has_usable_password(), "bad legacy hash should be unusable")

    # user_permissions: unknown section skipped
    _check(ctx.counts["user_permissions"]["created"] == 2, "expected 2 permissions created")
    _check(ctx.counts["user_permissions"]["skipped"] == 1, "unknown section should be skipped")

    # riders: money/date parsing, BS text preserved
    r1 = ctx.maps["riders"][1]
    _check(r1.monthly_salary == Decimal("15000.50"), f"monthly_salary={r1.monthly_salary!r}")
    _check(r1.date_of_birth == date(1995, 4, 12), "date_of_birth parse failed")
    _check(r1.kyc_submission_date is None, "garbage kyc date should be None")
    _check(_has_warning(ctx, "riders", 1, "kyc_submission_date"), "missing kyc date warning")
    _check(r1.citizenship_issue_date == "2052-01-15", "BS date must stay text")
    r2 = ctx.maps["riders"][2]
    _check(r2.monthly_salary is None, "garbage money should be None")
    _check(_has_warning(ctx, "riders", 2, "monthly_salary"), "missing money warning")

    # vehicles: money cleanup
    v1 = ctx.maps["vehicles"][1]
    _check(v1.purchase_cost == Decimal("250000.00"), f"purchase_cost={v1.purchase_cost!r}")

    # assignments: FK remap
    assignment = Assignment.objects.get(rider=r1, vehicle=v1, start_date=date(2025, 2, 1))
    _check(assignment.status == "active", "assignment status lost")

    # daily_logs: money quantization, required-date skip, yango fields
    _check(ctx.counts["daily_logs"]["created"] == 1, "expected 1 daily log")
    _check(ctx.counts["daily_logs"]["skipped"] == 1, "garbage english_date should skip row")
    dl = DailyLog.objects.get(rider=r1, english_date=date(2026, 5, 1))
    _check(dl.cash_as_per_app == Decimal("1234.00"), f"cash_as_per_app={dl.cash_as_per_app!r}")
    _check(dl.goal_bonus is None, "garbage goal_bonus should be None")
    _check(dl.total_income == Decimal("2200.76"), f"total_income={dl.total_income!r}")
    _check(dl.is_draft is False and dl.yango_synced_at == T0, "is_draft/yango_synced_at lost")

    # attendance: distance_in/out -> morning/evening odometer; battery validation
    att = Attendance.objects.get(rider=r1, date=date(2026, 5, 1))
    _check(att.morning_odometer == 12345, f"morning_odometer={att.morning_odometer!r} (distance_in)")
    _check(att.evening_odometer == 12400, f"evening_odometer={att.evening_odometer!r} (distance_out)")
    _check(att.battery_out is None and _has_warning(ctx, "attendance", 1, "battery_out"),
           "battery 150 must be dropped with a warning")
    _check(att.battery_in == 95, "valid battery lost")

    # activity_logs: action normalization + naive timestamp made aware
    log = ActivityLog.objects.get(section="riders", user_name="Legacy Admin", created_at=T0)
    _check(log.action == "created", f"action={log.action!r} (should normalize 'create')")

    # payroll: pay_model, FK to payment, money cleanup
    payment = ctx.maps["salary_payments"][1]
    _check(payment.pay_model == "vpe", "pay_model lost")
    advance = SalaryAdvance.objects.get(rider=r1, date=date(2026, 4, 15))
    _check(advance.amount == Decimal("2000.00"), f"advance amount={advance.amount!r}")
    _check(advance.salary_payment_id == payment.pk, "advance -> payment FK remap failed")

    # expenses: internal-space money cleanup
    expense = Expense.objects.get(rider=r1, date=date(2026, 4, 20))
    _check(expense.amount == Decimal("1500.00"), f"expense amount={expense.amount!r}")

    # cash_collections: user FK remap + preserved submitted_at (auto_now_add bypass)
    cc = CashCollection.objects.get(rider=r1, english_date=date(2026, 5, 1))
    _check(cc.submitted_by_id == admin.pk and cc.approved_by_id == admin.pk,
           "cash collection user FK remap failed")
    _check(cc.grand_total == Decimal("3300.00"), "grand_total lost")
    _check(cc.submitted_at == T0, f"submitted_at not preserved: {cc.submitted_at!r}")

    # fleet_handovers: payload jsonb + idempotency key
    fh = FleetHandover.objects.get(idempotency_key="selftest-r1-20260501-checkin")
    _check(fh.payload == {"odometer": 12400, "battery": 95}, "payload lost")
    _check(fh.cash_expected == Decimal("3300.00"), "cash_expected lost")

    # pay_config / pay_records / streaks / targeting tables
    pc = PayConfig.objects.get(parameter="base_amount", effective_from=date(2026, 7, 1))
    _check(pc.value == "600", "pay_config value lost")
    # Cutover blocker guard: the migrated camelCase ramp must be readable by
    # the pay engine (snake_case keys), or every post-cutover pay lock 500s.
    ramp_row = PayConfig.objects.get(parameter="ramp", effective_from=date(2026, 7, 1))
    ramp = json.loads(ramp_row.value)
    _check(
        ramp and all(set(t) <= {"from_day", "to_day", "gate_rides", "gate_cash", "prize"}
                     for t in ramp),
        f"ramp keys not engine-compatible: {ramp_row.value}",
    )
    from apps.payroll.engine import _ramp_tier
    tier = _ramp_tier(ramp, 2)
    _check(tier["gate_rides"] == 17, "engine cannot resolve the migrated ramp tier")
    pr = PayRecord.objects.get(rider=r1, english_date=date(2026, 5, 1))
    _check(pr.gates_applied == {} and pr.flags == {"gatesHit": True},
           "gates_applied null->{} / flags jsonb failed")
    _check(pr.daily_pay == Decimal("1090.50"), f"daily_pay={pr.daily_pay!r}")
    streak = Streak.objects.get(rider=r1)
    _check(streak.last_qualifying_date == date(2026, 5, 1), "streak date parse failed")
    target = RiderDailyTarget.objects.get(rider=r1, date=date(2026, 5, 1))
    _check(target.tier_adj == -1, "negative tier_adj lost")
    stats = RiderRideStats.objects.get(rider=r1, date=date(2026, 5, 1))
    _check(stats.rides_received == 30, "ride stats lost")
    override = RiderTargetOverride.objects.get(rider=r1, date=date(2026, 5, 2))
    _check(override.overridden_by_id == admin.pk, "override user FK remap failed")


def _self_test_asserts_pass2(ctx):
    """Re-running against the same source must create nothing new."""
    for table, counts in ctx.counts.items():
        _check(counts["created"] == 0,
               f"second pass created {counts['created']} rows in {table} — not idempotent")
    _check(Rider.objects.filter(full_name__endswith="Selftest").count() == 2,
           "rider duplicates after re-run")
