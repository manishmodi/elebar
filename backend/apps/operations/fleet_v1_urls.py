"""Rider-app service-token API (/api/fleet/v1/*). Views live in fleet_v1.py.

Month/day path params are plain strings validated in the views so malformed
values get a 400 (legacy semantics) rather than a route miss.
"""

from django.urls import path

from . import fleet_v1 as views

urlpatterns = [
    path("pilots/", views.FleetPilotsView.as_view(), name="fleet-v1-pilots"),
    path("today/", views.FleetTodayView.as_view(), name="fleet-v1-today"),
    path("photos/", views.FleetPhotoUploadView.as_view(), name="fleet-v1-photos"),
    path("checkout/", views.FleetCheckoutView.as_view(), name="fleet-v1-checkout"),
    path("exchange/", views.FleetExchangeView.as_view(), name="fleet-v1-exchange"),
    path("checkin/", views.FleetCheckinView.as_view(), name="fleet-v1-checkin"),
    path("handovers/<uuid:uuid>/", views.FleetHandoverDetailView.as_view(), name="fleet-v1-handover"),
    path("pay/month/<str:month>/", views.FleetPayMonthView.as_view(), name="fleet-v1-pay-month"),
    path("pay/day/<str:date>/", views.FleetPayDayView.as_view(), name="fleet-v1-pay-day"),
]
