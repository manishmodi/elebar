from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("vehicles", views.VehicleViewSet, basename="vehicles")
router.register("assignments", views.AssignmentViewSet, basename="assignments")
router.register("maintenance", views.MaintenanceViewSet, basename="maintenance")
router.register("servicing/history", views.ServiceHistoryViewSet, basename="servicing-history")

urlpatterns = [
    path("servicing/status/", views.ServicingStatusView.as_view(), name="servicing-status"),
    path("servicing/send/", views.ServicingSendView.as_view(), name="servicing-send"),
    path("servicing/cancel/", views.ServicingCancelView.as_view(), name="servicing-cancel"),
    path("", include(router.urls)),
]
