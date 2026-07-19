from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("daily-logs", views.DailyLogViewSet, basename="daily-logs")
router.register("attendance", views.AttendanceViewSet, basename="attendance")
router.register("cash-collection", views.CashCollectionViewSet, basename="cash-collection")

urlpatterns = [
    path("fleet/handovers/pending/", views.PendingHandoversView.as_view(), name="handovers-pending"),
    path("fleet/handovers/<uuid:uuid>/verify/", views.HandoverVerifyView.as_view(), name="handover-verify"),
    path("fleet/handovers/<uuid:uuid>/reject/", views.HandoverRejectView.as_view(), name="handover-reject"),
    path("dashboard/summary/", views.DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("dashboard/fleet-stats/", views.FleetStatsView.as_view(), name="dashboard-fleet-stats"),
    path("dashboard/rider/<uuid:uuid>/", views.RiderDashboardView.as_view(), name="dashboard-rider"),
    path("dashboard/vehicle/<uuid:uuid>/", views.VehicleDashboardView.as_view(), name="dashboard-vehicle"),
    path("performance/", views.PerformanceView.as_view(), name="performance"),
    path("performance/rider/<uuid:uuid>/", views.RiderPerformanceView.as_view(), name="performance-rider"),
    path("", include(router.urls)),
]
