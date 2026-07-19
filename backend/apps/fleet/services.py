"""Servicing status board: km-since-last-service per active vehicle."""

from apps.operations.models import Attendance

from .models import SERVICE_DUE_SOON_KM, SERVICE_INTERVAL_KM, Vehicle


def current_odometer(vehicle):
    """Latest evening odometer from attendance is the freshest reading."""
    row = (
        Attendance.objects.filter(vehicle=vehicle, evening_odometer__isnull=False)
        .order_by("-date")
        .first()
    )
    if row:
        return row.evening_odometer
    try:
        return int(float(vehicle.odometer_reading))
    except (TypeError, ValueError):
        return None


def servicing_status():
    rows = []
    for vehicle in Vehicle.objects.exclude(status=Vehicle.Status.INACTIVE).order_by("vehicle_number"):
        odometer = current_odometer(vehicle)
        km_since = None
        state = "unknown"
        if odometer is not None and vehicle.last_service_odometer is not None:
            km_since = odometer - vehicle.last_service_odometer
            if km_since >= SERVICE_INTERVAL_KM:
                state = "overdue"
            elif km_since >= SERVICE_DUE_SOON_KM:
                state = "due_soon"
            else:
                state = "ok"
        rows.append({
            "vehicle": str(vehicle.uuid),
            "vehicle_number": vehicle.vehicle_number,
            "plate_number": vehicle.plate_number,
            "status": vehicle.status,
            "in_servicing_since": vehicle.in_servicing_since,
            "current_odometer": odometer,
            "last_service_odometer": vehicle.last_service_odometer,
            "last_service_date": vehicle.last_service_date,
            "km_since_service": km_since,
            "km_until_due": (SERVICE_INTERVAL_KM - km_since) if km_since is not None else None,
            "service_status": state,
        })
    return rows
