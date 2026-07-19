from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("salary/advances", views.SalaryAdvanceViewSet, basename="salary-advances")
router.register("expense-categories", views.ExpenseCategoryViewSet, basename="expense-categories")
router.register("expenses", views.ExpenseViewSet, basename="expenses")

urlpatterns = [
    path("salary/calculate/", views.SalaryCalculateView.as_view(), name="salary-calculate"),
    path("salary/process/", views.SalaryProcessView.as_view(), name="salary-process"),
    path("salary/history/", views.SalaryHistoryView.as_view(), name="salary-history"),
    path("salary/payments/<uuid:uuid>/", views.SalaryPaymentVoidView.as_view(), name="salary-payment-void"),
    path("salary/pay-config/", views.PayConfigView.as_view(), name="salary-pay-config"),
    path("salary/pay-records.csv", views.PayRecordsCsvView.as_view(), name="salary-pay-records-csv"),
    path("", include(router.urls)),
]
