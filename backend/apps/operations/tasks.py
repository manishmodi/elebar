"""
Celery tasks for the Yango integration and the targeting engine.

All Yango-touching tasks are clean no-ops when the YANGO_* credentials are
unset (the beat schedule in sherpa/settings.py ships enabled everywhere).
Tasks take only JSON-serializable arguments (ISO date strings, UUID strings).
"""

import logging
from datetime import date

from celery import shared_task

from . import targeting, yango_sync
from .yango import YangoClient

logger = logging.getLogger(__name__)


def _parse_day(date_str, default):
    return date.fromisoformat(date_str) if date_str else default


@shared_task
def sync_yango_day(date_str=None, rider_uuids=None):
    """Sync one Nepal day (default: yesterday Nepal — the 00:30 UTC beat run
    picks up the day that ended a few hours earlier) into draft DailyLogs."""
    if not YangoClient().configured:
        logger.info("[Yango Sync] Skipped — integration not configured.")
        return {"skipped": True, "reason": "not_configured"}
    day = _parse_day(date_str, yango_sync.yesterday_nepal())
    return yango_sync.sync_for_date(day, rider_uuids)


@shared_task
def run_yango_preview(job_id, date_str, rider_uuids=None):
    """Background preview job: fetch per-rider figures without writing the DB,
    publishing progress + result into the Django cache under the job id."""
    day = date.fromisoformat(date_str)
    job = yango_sync.get_preview_job(job_id) or {
        "id": job_id, "date": date_str, "status": "running", "total": 0, "completed": 0,
    }

    def on_progress(completed, total):
        job["completed"] = completed
        job["total"] = total
        yango_sync.save_preview_job(job)

    try:
        if not YangoClient().configured:
            job["status"] = "error"
            job["error"] = "Yango integration is not configured."
        else:
            result = yango_sync.preview_for_date(day, rider_uuids, on_progress)
            job["status"] = "done"
            job["result"] = result
    except Exception as exc:
        logger.exception("[Yango Preview] Job %s failed", job_id)
        job["status"] = "error"
        job["error"] = str(exc)
    finally:
        from django.utils import timezone

        job["finished_at"] = timezone.now().isoformat()
        yango_sync.save_preview_job(job)
        yango_sync.clear_running_marker(job_id)
    return {"job_id": job_id, "status": job["status"]}


@shared_task
def compute_daily_targets(date_str=None):
    """Nightly auto-targeting. Default date: today in Nepal — at the 20:00 UTC
    beat time it is already 01:45 in Nepal, so this computes the target for
    the Nepal working day that has just begun ("tomorrow" from the UTC
    perspective of the schedule). Pure DB computation — no Yango traffic."""
    day = _parse_day(date_str, yango_sync.today_nepal())
    return targeting.compute_targets_for_date(day)


@shared_task
def refresh_driver_cache():
    """Re-pull the park driver directory into the Django cache (24h TTL).
    Clean no-op when unconfigured."""
    return yango_sync.refresh_driver_cache_now()
