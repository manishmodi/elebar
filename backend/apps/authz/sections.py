"""
The permission surface of the ERP: a fixed catalogue of sections.

Access is a per-user matrix of (section) x (view/create/edit/delete) rows —
no row means no access (deny-by-default). "Admin" is not a flag: a user is
admin iff they hold full CRUD on every section (see apps.accounts.models).
"""

from django.db import models


class Section(models.TextChoices):
    DASHBOARD = "dashboard", "Dashboard"
    DAILY_LOGS = "daily-logs", "Daily Logs"
    VEHICLES = "vehicles", "Vehicles"
    RIDERS = "riders", "Riders"
    SALARY = "salary", "Salary"
    ASSIGNMENTS = "assignments", "Assignments"
    ATTENDANCE = "attendance", "Attendance"
    MAINTENANCE = "maintenance", "Maintenance"
    FINANCIALS = "financials", "Financials"
    REPORTS = "reports", "Reports"
    EXPENSES = "expenses", "Expenses"
    CASH_COLLECTION = "cash-collection", "Cash Collection"
    PERFORMANCE = "performance", "Performance"


ALL_SECTIONS = [s.value for s in Section]

ACTIONS = ("view", "create", "edit", "delete")
