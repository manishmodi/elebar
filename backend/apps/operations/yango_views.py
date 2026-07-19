"""
Yango integration endpoints (/api/yango/...).

Convention: NEVER send traffic when unconfigured — every Yango-touching
endpoint returns 503 {"detail": "Yango integration is not configured."}
before any network I/O.

Permissions mirror the legacy Express routes: driver-directory endpoints
require riders.edit; sync endpoints require daily-logs.create (including the
GET status poll, which exposes the preview figures produced by a create-level
action).
"""

import uuid as uuid_lib
from datetime import date

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ActivityLog, log_activity
from apps.authz.permissions import SectionPermission
from apps.authz.sections import Section
from apps.riders.models import Rider

from . import tasks, yango_sync
from .yango import YangoClient, YangoNotConfigured

NOT_CONFIGURED = {"detail": "Yango integration is not configured."}


def _not_configured_response():
    return Response(NOT_CONFIGURED, status=status.HTTP_503_SERVICE_UNAVAILABLE)


def _parse_date(value, default):
    """YYYY-MM-DD -> date; returns (day, error_response)."""
    if value in (None, ""):
        return default, None
    try:
        return date.fromisoformat(str(value)), None
    except ValueError:
        return None, Response(
            {"detail": "date must be YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST
        )


def _parse_rider_uuids(value):
    """Optional list of rider UUIDs -> (list[str] | None, error_response).
    Absent/empty means "all linked riders"."""
    if value in (None, ""):
        return None, None
    if not isinstance(value, list):
        return None, Response(
            {"detail": "riders must be a list of rider UUIDs."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    rider_uuids = []
    for item in value:
        try:
            rider_uuids.append(str(uuid_lib.UUID(str(item))))
        except (ValueError, AttributeError, TypeError):
            return None, Response(
                {"detail": f"Invalid rider UUID: {item!r}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    return rider_uuids or None, None


class YangoStatusView(APIView):
    section = Section.DAILY_LOGS
    permission_classes = [SectionPermission]

    def get(self, request):
        return Response({"configured": YangoClient().configured})


class YangoDriversView(APIView):
    """Driver directory served from the Django-cache copy of the park's
    driver list (refreshed via POST /drivers/refresh/). ?q= searches by
    name / phone / driver id (max 50 rows); without q the full cache returns."""

    section = Section.RIDERS
    permission_classes = [SectionPermission]
    section_action_overrides = {"GET": "edit"}

    def get(self, request):
        if not YangoClient().configured:
            return _not_configured_response()
        drivers, cache_state = yango_sync.get_driver_cache()
        query = (request.query_params.get("q") or "").strip()
        if query:
            drivers = yango_sync.search_drivers(query, drivers)
        return Response({"drivers": drivers, "cache": cache_state})


class YangoDriversRefreshView(APIView):
    """Re-pull the park driver list into the cache. Runs as a Celery task:
    inline in dev (eager), background in prod — the response carries the
    cache state as of dispatch, so eager callers see the fresh totals."""

    section = Section.RIDERS
    permission_classes = [SectionPermission]
    section_action_overrides = {"POST": "edit"}

    def post(self, request):
        if not YangoClient().configured:
            return _not_configured_response()
        tasks.refresh_driver_cache.delay()
        drivers, cache_state = yango_sync.get_driver_cache()
        return Response({"detail": "Driver refresh started.", "cache": cache_state})


class YangoRiderLinkView(APIView):
    section = Section.RIDERS
    permission_classes = [SectionPermission]
    section_action_overrides = {"PUT": "edit", "DELETE": "edit"}

    def put(self, request, uuid):
        rider = get_object_or_404(Rider, uuid=uuid)
        driver_id = (request.data.get("yango_driver_id") or "").strip()
        holder = Rider.objects.filter(yango_driver_id=driver_id).exclude(pk=rider.pk).first()
        if driver_id and holder is not None:
            return Response(
                {"detail": f"This Yango driver is already linked to {holder.full_name}."},
                status=status.HTTP_409_CONFLICT,
            )
        if not driver_id:
            return Response({"detail": "yango_driver_id is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        rider.yango_driver_id = driver_id
        rider.save(update_fields=["yango_driver_id"])
        log_activity(request.user, ActivityLog.Action.UPDATED, Section.RIDERS,
                     f"Linked {rider.full_name} to Yango driver {driver_id}")
        return Response({"detail": "Linked."})

    def delete(self, request, uuid):
        rider = get_object_or_404(Rider, uuid=uuid)
        rider.yango_driver_id = ""
        rider.save(update_fields=["yango_driver_id"])
        return Response({"detail": "Unlinked."})


class YangoSyncPreviewStartView(APIView):
    """POST {date?, riders?: [uuid]} — start a background preview job and
    return {job_id} immediately; the UI polls the status endpoint. Single
    flight: same-date requests attach to the running job, a different date
    is a 409 conflict."""

    section = Section.DAILY_LOGS
    permission_classes = [SectionPermission]
    section_action_overrides = {"POST": "create"}

    def post(self, request):
        if not YangoClient().configured:
            return _not_configured_response()
        day, error = _parse_date(request.data.get("date"), yango_sync.yesterday_nepal())
        if error:
            return error
        rider_uuids, error = _parse_rider_uuids(request.data.get("riders"))
        if error:
            return error
        job, conflict = yango_sync.start_preview_job(day, rider_uuids)
        if conflict:
            return Response(
                {"detail": f"A sync for {job['date']} is already running. "
                           "Please wait for it to finish, then try again."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({
            "job_id": job["id"],
            "date": job["date"],
            "status": job["status"],
            "progress": {"completed": job["completed"], "total": job["total"]},
        })


class YangoSyncPreviewStatusView(APIView):
    section = Section.DAILY_LOGS
    permission_classes = [SectionPermission]
    # The poll exposes figures produced by a create-level action (legacy
    # required daily-logs.canCreate here too).
    section_action_overrides = {"GET": "create"}

    def get(self, request, job_id):
        job = yango_sync.get_preview_job(str(job_id))
        if job is None:
            return Response(
                {"detail": "Preview job not found or expired. Please start a new sync."},
                status=status.HTTP_404_NOT_FOUND,
            )
        payload = {
            "job_id": job["id"],
            "date": job["date"],
            "status": job["status"],
            "progress": {"completed": job["completed"], "total": job["total"]},
        }
        if job["status"] == "done":
            payload["result"] = job["result"]
        if job["status"] == "error":
            payload["error"] = job.get("error")
        return Response(payload)


class YangoSyncView(APIView):
    """Persist draft daily logs.

    - POST {job_id}: fast path — persist the figures a finished preview job
      already computed (server-side cache; no client-supplied stats, no Yango
      re-fetch).
    - POST {date?, riders?}: slow path — fetch from Yango and persist
      (cron/manual use; may take minutes for many riders).
    """

    section = Section.DAILY_LOGS
    permission_classes = [SectionPermission]
    section_action_overrides = {"POST": "create"}

    def post(self, request):
        job_id = request.data.get("job_id")
        if job_id:
            job = yango_sync.get_preview_job(str(job_id))
            if job is None:
                return Response(
                    {"detail": "Preview job not found or expired. Please start a new sync."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if job["status"] != "done":
                return Response(
                    {"detail": f"Preview job is {job['status']} — it must finish before syncing."},
                    status=status.HTTP_409_CONFLICT,
                )
            day = date.fromisoformat(job["date"])
            result = yango_sync.persist_from_preview(day, job["result"]["riders"])
        else:
            if not YangoClient().configured:
                return _not_configured_response()
            day, error = _parse_date(request.data.get("date"), yango_sync.yesterday_nepal())
            if error:
                return error
            rider_uuids, error = _parse_rider_uuids(request.data.get("riders"))
            if error:
                return error
            try:
                result = yango_sync.sync_for_date(day, rider_uuids)
            except YangoNotConfigured:
                return _not_configured_response()
        log_activity(
            request.user, ActivityLog.Action.CREATED, Section.DAILY_LOGS,
            f"Yango sync {result['date']}: {result['created']} created, "
            f"{result['updated']} updated, {result['skipped']} skipped",
        )
        return Response(result)
