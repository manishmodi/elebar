"""
Guard verification: project a rider-app handover into the canonical
Attendance row (and, on check-in, create the CashCollection).

Guard corrections in the verify payload override the rider's declared numbers.
"""

from django.db import transaction
from django.utils import timezone

from apps.payroll.engine import recompute_if_locked

from .models import Attendance, CashCollection, FleetHandover


class HandoverError(Exception):
    pass


def _clean_odometer(value):
    """Round decimals; '0'/0 means 'no reading'."""
    if value in (None, "", "0", 0):
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _clean_battery(value):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return None
    return value if 0 <= value <= 100 else None


@transaction.atomic
def verify_handover(handover, guard, corrections=None):
    """Apply a pending handover to attendance and return the updated handover.
    `corrections` may override any payload field. Concurrency-safe via a row
    lock on the handover."""
    handover = FleetHandover.objects.select_for_update().get(pk=handover.pk)
    if handover.status != FleetHandover.Status.PENDING:
        raise HandoverError("Handover is no longer pending.")

    data = {**handover.payload, **(corrections or {})}
    attendance, _ = Attendance.objects.select_for_update().get_or_create(
        rider=handover.rider,
        date=handover.english_date,
        defaults={"type": Attendance.Type.PRESENT, "vehicle": handover.vehicle},
    )
    if handover.vehicle and attendance.vehicle_id != handover.vehicle_id:
        attendance.vehicle = handover.vehicle

    if handover.kind == FleetHandover.Kind.CHECKOUT:
        attendance.battery_out = _clean_battery(data.get("battery"))
        attendance.morning_odometer = _clean_odometer(data.get("odometer"))
        attendance.rider_time_in = data.get("time") or timezone.localtime().strftime("%H:%M")
        attendance.scooter_out = data.get("time") or attendance.scooter_out

    elif handover.kind == FleetHandover.Kind.EXCHANGE:
        # Closing leg updates the evening numbers; the opening leg re-opens
        # the day on the replacement vehicle.
        closing, opening = data.get("closing", {}), data.get("opening", {})
        attendance.battery_in = _clean_battery(closing.get("battery"))
        attendance.evening_odometer = _clean_odometer(closing.get("odometer"))
        attendance.battery_out = _clean_battery(opening.get("battery")) or attendance.battery_out
        attendance.vehicle_override_reason = data.get("reason", "vehicle exchange")

    elif handover.kind == FleetHandover.Kind.CHECKIN:
        attendance.battery_in = _clean_battery(data.get("battery"))
        attendance.evening_odometer = _clean_odometer(data.get("odometer"))
        attendance.rider_time_out = data.get("time") or timezone.localtime().strftime("%H:%M")
        attendance.scooter_in = data.get("time") or attendance.scooter_in
        _create_cash_collection(handover, data)

    attendance.save()

    handover.status = FleetHandover.Status.VERIFIED
    handover.verified_by = guard
    handover.verified_by_name = guard.full_name
    handover.verified_at = timezone.now()
    handover.save(update_fields=["status", "verified_by", "verified_by_name", "verified_at"])

    recompute_if_locked(handover.rider, handover.english_date, actor=guard)
    return handover


def _create_cash_collection(handover, data):
    if CashCollection.objects.filter(
        rider=handover.rider, english_date=handover.english_date
    ).exists():
        return
    collection = CashCollection(
        rider=handover.rider,
        english_date=handover.english_date,
        wallet_amount=data.get("wallet") or 0,
        note=f"Auto-created from handover {handover.uuid}",
        submitted_by=handover.verified_by,
        submitted_by_name=handover.verified_by_name or "guard console",
    )
    for value, field in CashCollection.DENOMS:
        setattr(collection, field, int(data.get(field, 0) or 0))
    collection.compute_totals()
    collection.save()


@transaction.atomic
def reject_handover(handover, guard, reason):
    handover = FleetHandover.objects.select_for_update().get(pk=handover.pk)
    if handover.status != FleetHandover.Status.PENDING:
        raise HandoverError("Handover is no longer pending.")
    handover.status = FleetHandover.Status.REJECTED
    handover.verified_by = guard
    handover.verified_by_name = guard.full_name
    handover.verified_at = timezone.now()
    handover.reject_reason = reason
    handover.save()
    return handover
