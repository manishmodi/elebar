from django.urls import path

from . import yango_views

urlpatterns = [
    path("status/", yango_views.YangoStatusView.as_view(), name="yango-status"),
    path("drivers/", yango_views.YangoDriversView.as_view(), name="yango-drivers"),
    path("drivers/refresh/", yango_views.YangoDriversRefreshView.as_view(), name="yango-drivers-refresh"),
    path("riders/<uuid:uuid>/link/", yango_views.YangoRiderLinkView.as_view(), name="yango-rider-link"),
    path("sync/preview/start/", yango_views.YangoSyncPreviewStartView.as_view(), name="yango-sync-preview-start"),
    path(
        "sync/preview/status/<uuid:job_id>/",
        yango_views.YangoSyncPreviewStatusView.as_view(),
        name="yango-sync-preview-status",
    ),
    path("sync/", yango_views.YangoSyncView.as_view(), name="yango-sync"),
]
