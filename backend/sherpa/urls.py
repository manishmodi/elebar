from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from apps.common.storage_views import StorageObjectView, StorageUploadView


def healthz(request):
    return JsonResponse({"status": "ok"})


api_patterns = [
    path("", include("apps.accounts.urls")),
    path("", include("apps.riders.urls")),
    path("", include("apps.fleet.urls")),
    path("", include("apps.operations.urls")),
    path("", include("apps.payroll.urls")),
    path("storage/upload/", StorageUploadView.as_view(), name="storage-upload"),
    path("storage/objects/uploads/<str:name>", StorageObjectView.as_view(), name="storage-object"),
    path("yango/", include("apps.operations.yango_urls")),
    # Rider-app service-token plane (bearer FLEET_SERVICE_TOKEN, not JWT).
    path("fleet/v1/", include("apps.operations.fleet_v1_urls")),
]

urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
]
