"""
Rider-app service-token API (/api/fleet/v1/*) — ported from the legacy
Express `fleet.ts`. Consumed by the Riders Club backend, never by browsers.

Auth plane (distinct from the JWT plane):
- Every request carries `Authorization: Bearer <FLEET_SERVICE_TOKEN>` (env
  var). The comparison is timing-safe. When the env var is unset EVERY
  endpoint answers 503 service-not-configured — never an auth bypass.
- This plane never accepts JWTs, and the JWT plane never accepts the service
  token: these views use their own authentication/permission pair and the
  default JWT authenticator is not installed here.
- Rider-scoped routes additionally require `X-Rider-Yango-Id`, resolved to an
  ACTIVE rider with fleet_pilot=True: 400 missing header, 404 unknown driver
  id, 403 inactive/non-pilot rider.

Write endpoints (checkout/exchange/checkin) require `X-Idempotency-Key`
(8-128 chars); replays return the original handover with 200. Handover
payloads use the keys apps.operations.handovers.verify_handover consumes
(odometer/battery/goal_tier/cash/wallet/closing/opening/photo_paths/time).
"""

import hmac
import json
import os
import re
import uuid as uuid_lib
from calendar import monthrange
from datetime import date as date_cls
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.db import IntegrityError, transaction
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import (
    APIException,
    AuthenticationFailed,
    NotFound,
    ParseError,
    PermissionDenied,
)
from rest_framework.parsers import BaseParser
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ActivityLog, log_activity
from apps.authz.sections import Section
from apps.fleet.models import Assignment, Vehicle
from apps.payroll.engine import _ramp_tier, _tenure_day, compute_day, resolve_param
from apps.payroll.models import PayRecord, SalaryAdvance, Streak
from apps.riders.models import Rider

from .models import Attendance, DailyLog, FleetHandover

FLEET_SERVICE_AUTH = "fleet-service-token"
MAX_PHOTO_BYTES = 10 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
EXCHANGE_REASONS = ("battery_low", "breakdown", "puncture", "other")

ZERO = Decimal("0")
CENT = Decimal("0.01")


# --- Helpers ----------------------------------------------------------------

def _org_now():
    return timezone.now().astimezone(ZoneInfo(settings.ORG_TIMEZONE))


def _org_today():
    return _org_now().date()


def _decimal(value, fallback="0"):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(fallback)


def _money(value):
    """Decimal -> string with 2dp; None stays None (never fake zeros)."""
    if value is None:
        return None
    return str(_decimal(value).quantize(CENT))


# --- Auth plane -------------------------------------------------------------

class ServiceNotConfigured(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Fleet service is not configured."
    default_code = "service_not_configured"


class FleetServiceAuthentication(BaseAuthentication):
    """Timing-safe shared-token check against env FLEET_SERVICE_TOKEN.

    Unset token -> 503 on every request (fail closed, loudly). A missing or
    non-Bearer header -> unauthenticated (401 via the permission class); a
    wrong token -> 401. Successful auth marks request.auth with a sentinel the
    paired permission class checks — request.user stays anonymous, so nothing
    section-permission-gated can ever be reached with this token.
    """

    #: A weak shared token would arm the whole rider-app plane — refuse it.
    MIN_TOKEN_LENGTH = 32

    def authenticate(self, request):
        expected = (os.environ.get("FLEET_SERVICE_TOKEN") or "").strip()
        if len(expected) < self.MIN_TOKEN_LENGTH:
            raise ServiceNotConfigured()
        header = request.headers.get("Authorization") or ""
        if not header.startswith("Bearer "):
            return None
        supplied = header[len("Bearer "):].strip()
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            raise AuthenticationFailed("Invalid service token.")
        return (AnonymousUser(), FLEET_SERVICE_AUTH)

    def authenticate_header(self, request):
        return "Bearer"


class HasFleetServiceToken(BasePermission):
    message = "Fleet service token required."

    def has_permission(self, request, view):
        return request.auth == FLEET_SERVICE_AUTH


class FleetV1View(APIView):
    authentication_classes = [FleetServiceAuthentication]
    permission_classes = [HasFleetServiceToken]
    # Server-to-server plane: one caller IP for all riders, so the per-IP user
    # throttle would starve legitimate polling. The caller rate-limits itself.
    throttle_classes = []


class RiderScopedFleetView(FleetV1View):
    """Adds X-Rider-Yango-Id resolution; sets self.rider."""

    rider = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        yango_id = (request.headers.get("X-Rider-Yango-Id") or "").strip()
        if not yango_id:
            raise ParseError("X-Rider-Yango-Id header required.")
        rider = Rider.objects.filter(yango_driver_id=yango_id).first()
        if rider is None:
            raise NotFound("No rider with this Yango driver id.")
        if rider.status != Rider.Status.ACTIVE or not rider.fleet_pilot:
            raise PermissionDenied("Rider is not an active fleet pilot.")
        self.rider = rider


# --- Body validation --------------------------------------------------------

class OdometerField(serializers.Field):
    """Integer odometer reading; 0 / "0" / null all mean "no reading" -> None
    (matches apps.operations.handovers._clean_odometer)."""

    def to_internal_value(self, data):
        if isinstance(data, bool):
            raise serializers.ValidationError("Odometer must be an integer or null.")
        if data in ("", 0, "0"):
            return None
        if isinstance(data, (int, float)):
            value = int(round(data))
        elif isinstance(data, str):
            try:
                value = int(data.strip())
            except ValueError:
                raise serializers.ValidationError("Odometer must be an integer or null.")
        else:
            raise serializers.ValidationError("Odometer must be an integer or null.")
        if value < 0:
            raise serializers.ValidationError("Odometer cannot be negative.")
        return value

    def to_representation(self, value):
        return value


class PhotoPathsField(serializers.DictField):
    child = serializers.CharField()

    def to_internal_value(self, data):
        mapping = super().to_internal_value(data)
        for label, path in mapping.items():
            if not path.startswith("/objects/"):
                raise serializers.ValidationError(
                    f"Photo path for '{label}' must start with /objects/."
                )
        return mapping


def _battery_field():
    return serializers.IntegerField(min_value=0, max_value=100)


def _money_field():
    return serializers.DecimalField(max_digits=12, decimal_places=2, min_value=ZERO)


class CheckoutSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    vehicle_id = serializers.UUIDField(required=False)
    vehicle_qr = serializers.CharField(required=False)
    odometer = OdometerField(required=True, allow_null=True)
    battery = _battery_field()
    goal_tier = serializers.IntegerField(min_value=1)
    photo_paths = PhotoPathsField(required=False, default=dict)


class ExchangeClosingSerializer(serializers.Serializer):
    odometer = OdometerField(required=True, allow_null=True)
    battery = _battery_field()
    photo_paths = PhotoPathsField(required=False, default=dict)


class ExchangeOpeningSerializer(serializers.Serializer):
    vehicle_id = serializers.UUIDField(required=False)
    vehicle_qr = serializers.CharField(required=False)
    odometer = OdometerField(required=True, allow_null=True)
    battery = _battery_field()
    photo_paths = PhotoPathsField(required=False, default=dict)


class ExchangeSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    closing = ExchangeClosingSerializer()
    reason = serializers.ChoiceField(choices=EXCHANGE_REASONS)
    reason_note = serializers.CharField(required=False, allow_blank=True, max_length=500)
    opening = ExchangeOpeningSerializer()


class CheckinSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    odometer = OdometerField(required=True, allow_null=True)
    battery = _battery_field()
    cash = _money_field()
    wallet = _money_field()
    photo_paths = PhotoPathsField(required=False, default=dict)


def _validation_failed(errors):
    return Response(
        {"detail": "Validation failed.", "errors": errors},
        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


# --- Domain helpers ---------------------------------------------------------

def _fleet_enabled(on_date):
    # DEFAULT_PARAMS has fleet_enabled=true, so an absent config row cannot
    # brick the pilot; the PayConfig row is the kill switch (legacy semantics).
    return resolve_param("fleet_enabled", on_date) == "true"


def _idempotency_key(request):
    key = (request.headers.get("X-Idempotency-Key") or "").strip()
    return key if 8 <= len(key) <= 128 else None


def _todays_handovers(rider, on_date):
    return list(
        FleetHandover.objects.filter(rider=rider, english_date=on_date)
        .exclude(status=FleetHandover.Status.REJECTED)
        .order_by("id")
    )


def _shift_state(handovers):
    checkout = next((h for h in handovers if h.kind == FleetHandover.Kind.CHECKOUT), None)
    checkin = next((h for h in handovers if h.kind == FleetHandover.Kind.CHECKIN), None)
    if not checkout:
        return "not_started"
    if checkout.status == FleetHandover.Status.PENDING:
        return "pending_checkout"
    if checkin:
        return "pending_checkin" if checkin.status == FleetHandover.Status.PENDING else "closed"
    return "active"


def _resolve_vehicle(vehicle_id, vehicle_qr):
    """Resolve by UUID or by QR payload (vehicle number or plate)."""
    if vehicle_id:
        return Vehicle.objects.filter(uuid=vehicle_id).first()
    if vehicle_qr:
        qr = vehicle_qr.strip()
        return (
            Vehicle.objects.filter(vehicle_number=qr).first()
            or Vehicle.objects.filter(plate_number=qr).first()
        )
    return None


def _vehicle_info(vehicle):
    if vehicle is None:
        return None
    return {
        "id": str(vehicle.uuid),
        "vehicle_number": vehicle.vehicle_number,
        "plate": vehicle.plate_number,
        "model": vehicle.model,
    }


def _handover_reply(handover):
    reply = {
        "handover_id": str(handover.uuid),
        "status": (
            "pending_verify"
            if handover.status == FleetHandover.Status.PENDING
            else handover.status
        ),
    }
    if handover.kind == FleetHandover.Kind.CHECKIN:
        reply.update(
            cash_expected=_money(handover.cash_expected),
            variance=_money(handover.cash_variance),
            provisional=True,
        )
    return reply


class IdempotencyConflict(Exception):
    """The key already belongs to a different rider's handover."""


def _replay_for(rider, key):
    """Rider-scoped idempotent replay lookup. A key held by ANOTHER rider is a
    conflict, never a replay — returning the foreign row would leak that
    rider's handover (id/status/cash figures) and silently drop this one."""
    existing = FleetHandover.objects.filter(idempotency_key=key).first()
    if existing is None:
        return None
    if existing.rider_id != rider.pk:
        raise IdempotencyConflict()
    return existing


def _create_handover(rider, on_date, kind, key, vehicle, payload, **extra):
    """Insert; on an idempotency-key race, return this rider's winner.
    -> (row, created)"""
    try:
        with transaction.atomic():
            row = FleetHandover.objects.create(
                rider=rider,
                english_date=on_date,
                kind=kind,
                idempotency_key=key,
                vehicle=vehicle,
                payload=payload,
                **extra,
            )
        return row, True
    except IntegrityError:
        existing = _replay_for(rider, key)
        if existing is None:
            raise
        return existing, False


IDEMPOTENCY_CONFLICT_RESPONSE = dict(
    data={"detail": "Idempotency key is already in use by another rider."},
    status=status.HTTP_409_CONFLICT,
)


def _day_target(rider, on_date):
    """Pay-Model-v2 target for a rider-day: what the day is worth and the
    gates that price it (config + ramp driven). Raw Decimals/ints."""
    cfg = {
        p: resolve_param(p, on_date)
        for p in (
            "base_amount", "base_min_hours", "base_min_rides",
            "commission_rate", "revenue_cap", "growth_rate", "ramp",
        )
    }
    tier = _ramp_tier(json.loads(cfg["ramp"]), _tenure_day(rider, on_date))
    return {
        "gate_rides": int(tier["gate_rides"]),
        "gate_cash": _decimal(tier["gate_cash"]),
        "prize": _decimal(tier["prize"]),
        "base_amount": _decimal(cfg["base_amount"]),
        "base_min_rides": int(cfg["base_min_rides"]),
        "base_min_hours": _decimal(cfg["base_min_hours"]),
        "commission_rate": _decimal(cfg["commission_rate"]),
        "revenue_cap": _decimal(cfg["revenue_cap"]),
        "growth_rate": _decimal(cfg["growth_rate"]),
    }


# --- GET /pilots ------------------------------------------------------------

class FleetPilotsView(FleetV1View):
    def get(self, request):
        today = _org_today()
        pilots = (
            Rider.objects.filter(fleet_pilot=True, status=Rider.Status.ACTIVE)
            .exclude(yango_driver_id="")
            .order_by("full_name")
        )
        return Response({
            "fleet_enabled": _fleet_enabled(today),
            "pilots": [
                {
                    "rider_id": str(r.uuid),
                    "yango_driver_id": r.yango_driver_id,
                    "full_name": r.full_name,
                }
                for r in pilots
            ],
        })


# --- GET /today -------------------------------------------------------------

class FleetTodayView(RiderScopedFleetView):
    def get(self, request):
        rider = self.rider
        today = _org_today()
        tz = ZoneInfo(settings.ORG_TIMEZONE)

        handovers = _todays_handovers(rider, today)
        checkout = next(
            (h for h in handovers if h.kind == FleetHandover.Kind.CHECKOUT), None
        )
        attendance = Attendance.objects.filter(rider=rider, date=today).first()
        log = DailyLog.objects.filter(rider=rider, english_date=today).first()
        streak = Streak.objects.filter(rider=rider).first()
        assignment = (
            Assignment.objects.filter(rider=rider, status=Assignment.Status.ACTIVE)
            .select_related("vehicle")
            .order_by("-id")
            .first()
        )
        month_locked = PayRecord.objects.filter(
            rider=rider,
            status=PayRecord.Status.LOCKED,
            english_date__year=today.year,
            english_date__month=today.month,
        ).aggregate(earned=Sum("daily_pay"), days=Count("id"))

        # ONE clock: the live shift clock reads attendance.rider_time_in
        # (stamped at checkout verification, staff-correctable while the day is
        # open); the verify timestamp is only the fallback — so "hours so far"
        # and the pay engine's day-end hours can never diverge.
        verified_checkout = next(
            (
                h for h in handovers
                if h.kind == FleetHandover.Kind.CHECKOUT
                and h.status == FleetHandover.Status.VERIFIED
            ),
            None,
        )
        shift_start = None
        if verified_checkout:
            match = re.match(r"^(\d{1,2}):(\d{2})", attendance.rider_time_in if attendance else "")
            if match:
                shift_start = datetime(
                    today.year, today.month, today.day,
                    int(match.group(1)), int(match.group(2)), tzinfo=tz,
                )
            else:
                shift_start = verified_checkout.verified_at or verified_checkout.submitted_at

        hours_so_far = None
        if shift_start is not None:
            hours_so_far = max(
                0.0, round((timezone.now() - shift_start).total_seconds() / 3600, 1)
            )

        checkout_payload = checkout.payload if checkout else {}
        open_handover = next(
            (h for h in reversed(handovers) if h.status == FleetHandover.Status.PENDING),
            None,
        )

        yango_day = None
        if log is not None:
            bonus = _decimal(log.goal_bonus or 0) + _decimal(log.promotion_bonus_other or 0)
            yango_day = {
                "rides": log.rides_completed or 0,
                "app_cash": _money(log.cash_as_per_app or 0),
                "bonus": _money(bonus),
                "provisional": True,
                "as_of": (log.yango_synced_at or log.created_at).isoformat(),
            }

        # Live, provisional estimate from today's (possibly draft) Yango data.
        # Pure computation — the official number is only ever a locked
        # PayRecord, written elsewhere on cash-collection approval.
        pay_projection = None
        if log is not None:
            amounts, _snapshot, _gate_ok = compute_day(rider, log, attendance, today)
            pay_projection = {
                "base": _money(amounts["base"]),
                "commission": _money(amounts["commission"]),
                "prize": _money(amounts["prize"]),
                "growth": _money(amounts["growth"]),
                "total": _money(amounts["daily_pay"]),
                "provisional": True,
            }

        target = _day_target(rider, today)
        rides = (log.rides_completed or 0) if log is not None else None
        app_cash = _decimal(log.cash_as_per_app or 0) if log is not None else None
        gaps = {
            "rides_to_gate": max(0, target["gate_rides"] - rides) if rides is not None else None,
            "cash_to_gate": (
                _money(max(ZERO, target["gate_cash"] - app_cash))
                if app_cash is not None else None
            ),
            "rides_to_base": (
                max(0, target["base_min_rides"] - rides) if rides is not None else None
            ),
            "hours_so_far": hours_so_far,
            "hours_to_base": (
                max(0.0, round(float(target["base_min_hours"]) - hours_so_far, 1))
                if hours_so_far is not None else None
            ),
        }

        return Response({
            "fleet_enabled": _fleet_enabled(today),
            "date": str(today),
            "shift_state": _shift_state(handovers),
            "shift_started_at": shift_start.isoformat() if shift_start else None,
            "assigned_vehicle": _vehicle_info(assignment.vehicle if assignment else None),
            "vehicle": _vehicle_info(checkout.vehicle if checkout else None),
            "goal_tier": checkout_payload.get("goal_tier"),
            "handover": (
                {
                    "id": str(open_handover.uuid),
                    "kind": open_handover.kind,
                    "status": open_handover.status,
                }
                if open_handover else None
            ),
            "yango_day": yango_day,
            "pay_projection": pay_projection,
            "streak": {
                "current": streak.current_streak if streak else 0,
                "best": streak.best_streak if streak else 0,
            },
            "month_to_date": {
                "earned": _money(month_locked["earned"] or ZERO),
                "days_locked": month_locked["days"] or 0,
            },
            "pay_target": {
                "gate_rides": target["gate_rides"],
                "gate_cash": _money(target["gate_cash"]),
                "prize": _money(target["prize"]),
                "base_amount": _money(target["base_amount"]),
                "base_min_rides": target["base_min_rides"],
                "base_min_hours": str(target["base_min_hours"]),
                "commission_rate": str(target["commission_rate"]),
                "revenue_cap": _money(target["revenue_cap"]),
                "growth_rate": str(target["growth_rate"]),
            },
            "gaps": gaps,
        })


# --- POST /photos -----------------------------------------------------------

class RawImageParser(BaseParser):
    """The rider app PUTs raw image bytes, not multipart. Reads are bounded —
    an unbounded stream.read() would buffer a multi-GB body into memory
    before any size check could run."""

    media_type = "*/*"

    def parse(self, stream, media_type=None, parser_context=None):
        return stream.read(MAX_PHOTO_BYTES + 1)


class FleetPhotoUploadView(RiderScopedFleetView):
    parser_classes = [RawImageParser]

    def post(self, request):
        # Reject oversized uploads on the declared length BEFORE reading the
        # body; the bounded parser is the backstop for lying clients.
        try:
            declared = int(request.headers.get("Content-Length") or 0)
        except ValueError:
            declared = 0
        if declared > MAX_PHOTO_BYTES:
            return Response(
                {"detail": "Photo exceeds the 10 MB limit."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        content_type = (request.content_type or "").split(";")[0].strip().lower()
        ext = PHOTO_TYPES.get(content_type)
        if ext is None:
            return Response(
                {"detail": "Content-Type must be image/jpeg, image/png or image/webp."},
                status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            )
        body = request.data
        if not isinstance(body, bytes) or not body:
            return Response(
                {"detail": "Request body must be the raw image bytes."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(body) > MAX_PHOTO_BYTES:
            return Response(
                {"detail": "Photo exceeds the 10 MB limit."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        # Same layout as apps.common.storage_views: MEDIA_ROOT/uploads/<uuid><ext>,
        # served back only through the authenticated storage download view.
        name = f"{uuid_lib.uuid4()}{ext}"
        target_dir = Path(settings.MEDIA_ROOT) / "uploads"
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / name).write_bytes(body)
        return Response(
            {"photo_path": f"/objects/uploads/{name}"}, status=status.HTTP_201_CREATED
        )


# --- POST /checkout ---------------------------------------------------------

class FleetCheckoutView(RiderScopedFleetView):
    def post(self, request):
        key = _idempotency_key(request)
        if key is None:
            return Response(
                {"detail": "X-Idempotency-Key header required (8-128 chars)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            existing = _replay_for(self.rider, key)
        except IdempotencyConflict:
            return Response(**IDEMPOTENCY_CONFLICT_RESPONSE)
        if existing is not None:
            return Response(_handover_reply(existing))

        ser = CheckoutSerializer(data=request.data)
        if not ser.is_valid():
            return _validation_failed(ser.errors)
        data = ser.validated_data
        on_date = data.get("date") or _org_today()

        vehicle = _resolve_vehicle(data.get("vehicle_id"), data.get("vehicle_qr"))
        if vehicle is None:
            return Response(
                {"detail": "Vehicle not found — scan the scooter QR again or pick the assigned scooter."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        handovers = _todays_handovers(self.rider, on_date)
        if any(h.kind == FleetHandover.Kind.CHECKOUT for h in handovers):
            return Response(
                {"detail": "A checkout already exists for today."},
                status=status.HTTP_409_CONFLICT,
            )

        payload = {
            "odometer": data["odometer"],
            "battery": data["battery"],
            "goal_tier": data["goal_tier"],
            "photo_paths": data.get("photo_paths") or {},
            "time": _org_now().strftime("%H:%M"),
        }
        row, created = _create_handover(
            self.rider, on_date, FleetHandover.Kind.CHECKOUT, key, vehicle, payload
        )
        if not created:
            return Response(_handover_reply(row))

        log_activity(
            None, ActivityLog.Action.CREATED, Section.ATTENDANCE,
            f"Check-out submitted for {on_date} on {vehicle.vehicle_number} — pending guard verification",
            user_name=f"Rider app ({self.rider.full_name})",
        )
        return Response(_handover_reply(row), status=status.HTTP_201_CREATED)


# --- POST /exchange ---------------------------------------------------------

class FleetExchangeView(RiderScopedFleetView):
    def post(self, request):
        key = _idempotency_key(request)
        if key is None:
            return Response(
                {"detail": "X-Idempotency-Key header required (8-128 chars)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            existing = _replay_for(self.rider, key)
        except IdempotencyConflict:
            return Response(**IDEMPOTENCY_CONFLICT_RESPONSE)
        if existing is not None:
            return Response(_handover_reply(existing))

        ser = ExchangeSerializer(data=request.data)
        if not ser.is_valid():
            return _validation_failed(ser.errors)
        data = ser.validated_data
        on_date = data.get("date") or _org_today()

        handovers = _todays_handovers(self.rider, on_date)
        if _shift_state(handovers) != "active":
            return Response(
                {"detail": "Exchange is only possible during an active shift (after guard confirms your check-out)."},
                status=status.HTTP_409_CONFLICT,
            )

        opening = data["opening"]
        new_vehicle = _resolve_vehicle(opening.get("vehicle_id"), opening.get("vehicle_qr"))
        if new_vehicle is None:
            return Response(
                {"detail": "Replacement vehicle not found — scan its QR again."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        payload = {
            "closing": {
                "odometer": data["closing"]["odometer"],
                "battery": data["closing"]["battery"],
                "photo_paths": data["closing"].get("photo_paths") or {},
            },
            "reason": data["reason"],
            "reason_note": data.get("reason_note") or None,
            "opening": {
                "vehicle_id": str(new_vehicle.uuid),
                "odometer": opening["odometer"],
                "battery": opening["battery"],
                "photo_paths": opening.get("photo_paths") or {},
            },
            "time": _org_now().strftime("%H:%M"),
        }
        row, created = _create_handover(
            self.rider, on_date, FleetHandover.Kind.EXCHANGE, key, new_vehicle, payload
        )
        if not created:
            return Response(_handover_reply(row))

        log_activity(
            None, ActivityLog.Action.CREATED, Section.ATTENDANCE,
            f"Scooter exchange submitted for {on_date} (reason: {data['reason']}) — pending guard verification",
            user_name=f"Rider app ({self.rider.full_name})",
        )
        return Response(_handover_reply(row), status=status.HTTP_201_CREATED)


# --- POST /checkin ----------------------------------------------------------

class FleetCheckinView(RiderScopedFleetView):
    def post(self, request):
        key = _idempotency_key(request)
        if key is None:
            return Response(
                {"detail": "X-Idempotency-Key header required (8-128 chars)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            existing = _replay_for(self.rider, key)
        except IdempotencyConflict:
            return Response(**IDEMPOTENCY_CONFLICT_RESPONSE)
        if existing is not None:
            return Response(_handover_reply(existing))

        ser = CheckinSerializer(data=request.data)
        if not ser.is_valid():
            return _validation_failed(ser.errors)
        data = ser.validated_data
        on_date = data.get("date") or _org_today()

        handovers = _todays_handovers(self.rider, on_date)
        checkout = next(
            (h for h in handovers if h.kind == FleetHandover.Kind.CHECKOUT), None
        )
        if checkout is None:
            return Response(
                {"detail": "No shift was started today — check out first."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        if any(h.kind == FleetHandover.Kind.CHECKIN for h in handovers):
            return Response(
                {"detail": "A check-in already exists for today."},
                status=status.HTTP_409_CONFLICT,
            )

        # Provisional expected-handover figure from today's synced Yango data
        # (if any): expected = app cash - the daily allowance the rider keeps.
        # The OFFICIAL variance remains finance's next-day comparison.
        cash_expected = variance = None
        log = DailyLog.objects.filter(rider=self.rider, english_date=on_date).first()
        if log is not None and log.cash_as_per_app and log.cash_as_per_app > ZERO:
            cash_expected = max(
                ZERO, log.cash_as_per_app - (log.daily_allowance or ZERO)
            ).quantize(CENT)
            variance = (data["cash"] + data["wallet"] - cash_expected).quantize(CENT)

        payload = {
            "odometer": data["odometer"],
            "battery": data["battery"],
            "cash": str(data["cash"]),
            "wallet": str(data["wallet"]),
            "photo_paths": data.get("photo_paths") or {},
            "time": _org_now().strftime("%H:%M"),
        }
        row, created = _create_handover(
            self.rider, on_date, FleetHandover.Kind.CHECKIN, key,
            checkout.vehicle, payload,
            cash_expected=cash_expected, cash_variance=variance,
        )
        if not created:
            return Response(_handover_reply(row))

        log_activity(
            None, ActivityLog.Action.CREATED, Section.ATTENDANCE,
            f"Check-in submitted for {on_date} — cash declared {data['cash']} — pending guard verification",
            user_name=f"Rider app ({self.rider.full_name})",
        )
        return Response(_handover_reply(row), status=status.HTTP_201_CREATED)


# --- GET /handovers/<uuid> --------------------------------------------------

class FleetHandoverDetailView(RiderScopedFleetView):
    def get(self, request, uuid):
        row = FleetHandover.objects.filter(uuid=uuid, rider=self.rider).first()
        if row is None:
            raise NotFound("Handover not found.")
        return Response({
            "id": str(row.uuid),
            "kind": row.kind,
            "status": row.status,
            "reject_reason": row.reject_reason or None,
        })


# --- GET /pay/month/<YYYY-MM> and /pay/day/<YYYY-MM-DD> ---------------------

def _pay_rules(snapshot):
    """The rule numbers behind each pay line, from the record's OWN stored
    config snapshot — a day recalibrated later still shows the gates it was
    actually priced under. Percentages are whole numbers (20, not 0.20).
    None for records without a snapshot (app falls back to plain labels)."""
    cfg = (snapshot or {}).get("config") or {}
    tier = ((snapshot or {}).get("inputs") or {}).get("tenure_tier") or {}
    if not cfg or not tier:
        return None
    return {
        "base": {
            "amount": _money(cfg.get("base_amount")),
            "min_rides": int(_decimal(cfg.get("base_min_rides"))),
            "min_hours": str(_decimal(cfg.get("base_min_hours"))),
        },
        "commission": {
            "pct": int(round(_decimal(cfg.get("commission_rate")) * 100)),
            "revenue_cap": _money(cfg.get("revenue_cap")),
        },
        "prize": {
            "amount": _money(tier.get("prize")),
            "gate_rides": int(_decimal(tier.get("gate_rides"))),
            "gate_cash": _money(tier.get("gate_cash")),
        },
        "growth": {
            "pct": int(round(_decimal(cfg.get("growth_rate")) * 100)),
            "above_revenue": _money(cfg.get("revenue_cap")),
        },
    }


def _pay_day_row(record):
    snapshot = record.gates_applied or {}
    inputs = snapshot.get("inputs") or {}
    return {
        "date": str(record.english_date),
        # rides/revenue come from the inputs snapshot every record stores at
        # lock time (part of the rider-app contract).
        "rides": int(_decimal(inputs.get("rides"))),
        "revenue": _money(inputs.get("revenue") or 0),
        "base": _money(record.base),
        "commission": _money(record.commission),
        "prize": _money(record.prize),
        "growth": _money(record.growth),
        "total": _money(record.daily_pay),
        "locked": True,
        "rules": _pay_rules(snapshot),
    }


class FleetPayMonthView(RiderScopedFleetView):
    def get(self, request, month):
        match = re.fullmatch(r"(\d{4})-(\d{2})", month)
        if not match or not 1 <= int(match.group(2)) <= 12:
            return Response(
                {"detail": "Month must be YYYY-MM."}, status=status.HTTP_400_BAD_REQUEST
            )
        year, mon = int(match.group(1)), int(match.group(2))
        first = date_cls(year, mon, 1)
        last = date_cls(year, mon, monthrange(year, mon)[1])

        records = list(
            PayRecord.objects.filter(
                rider=self.rider,
                status=PayRecord.Status.LOCKED,
                english_date__range=(first, last),
            ).order_by("english_date")
        )
        advances = SalaryAdvance.objects.filter(
            rider=self.rider, date__range=(first, last)
        ).aggregate(total=Sum("amount"))

        days = [_pay_day_row(r) for r in records]
        streak_bonuses = sum(
            (_decimal((r.flags or {}).get("streakBonus", "0")) for r in records), ZERO
        )
        month_total = sum((r.daily_pay or ZERO for r in records), ZERO)
        return Response({
            "days": days,
            # Informational: streak awards are already INCLUDED in day totals.
            "streak_bonuses": _money(streak_bonuses),
            "advances": _money(advances["total"] or ZERO),
            "month_total": _money(month_total),
        })


class FleetPayDayView(RiderScopedFleetView):
    def get(self, request, date):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            return Response(
                {"detail": "Date must be YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            on_date = date_cls.fromisoformat(date)
        except ValueError:
            return Response(
                {"detail": "Date must be YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST
            )
        record = PayRecord.objects.filter(
            rider=self.rider, english_date=on_date, status=PayRecord.Status.LOCKED
        ).first()
        if record is None:
            raise NotFound("No locked pay record for this date.")
        row = _pay_day_row(record)
        row.update(gates_applied=record.gates_applied or None, flags=record.flags or None)
        return Response(row)
