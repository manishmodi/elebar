from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from apps.common.storage_views import StorageObjectView, StorageUploadView
from apps.operations import yango_views


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
    path("yango/status/", yango_views.YangoStatusView.as_view(), name="yango-status"),
    path("yango/drivers/", yango_views.YangoDriversView.as_view(), name="yango-drivers"),
    path("yango/riders/<uuid:uuid>/link/", yango_views.YangoRiderLinkView.as_view(), name="yango-rider-link"),
]

urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
]
