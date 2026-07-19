from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ActivityLog, log_activity
from apps.authz.permissions import SectionPermission
from apps.authz.sections import Section
from apps.riders.models import Rider

from .yango import YangoClient, YangoNotConfigured


class YangoStatusView(APIView):
    section = Section.DAILY_LOGS
    permission_classes = [SectionPermission]

    def get(self, request):
        return Response({"configured": YangoClient().configured})


class YangoDriversView(APIView):
    section = Section.RIDERS
    permission_classes = [SectionPermission]
    section_action_overrides = {"GET": "edit"}

    def get(self, request):
        client = YangoClient()
        try:
            data = client.driver_profiles()
        except YangoNotConfigured:
            return Response({"detail": "Yango integration is not configured."},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        drivers = [
            {
                "id": row.get("driver_profile", {}).get("id"),
                "name": " ".join(filter(None, [
                    row.get("driver_profile", {}).get("first_name"),
                    row.get("driver_profile", {}).get("last_name"),
                ])),
                "phone": (row.get("driver_profile", {}).get("phones") or [None])[0],
            }
            for row in data.get("driver_profiles", [])
        ]
        return Response({"drivers": drivers})


class YangoRiderLinkView(APIView):
    section = Section.RIDERS
    permission_classes = [SectionPermission]
    section_action_overrides = {"PUT": "edit", "DELETE": "edit"}

    def put(self, request, uuid):
        rider = get_object_or_404(Rider, uuid=uuid)
        driver_id = (request.data.get("yango_driver_id") or "").strip()
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
