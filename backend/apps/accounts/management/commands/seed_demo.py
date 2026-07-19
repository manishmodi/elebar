"""Seed demo data: an admin, a guard, riders, vehicles, assignments, a week of
daily logs/attendance, pay config, and an expense category. Idempotent."""

import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import SectionPermission, User
from apps.authz.sections import ALL_SECTIONS
from apps.fleet.models import Assignment, Vehicle
from apps.operations.models import Attendance, DailyLog
from apps.payroll.engine import DEFAULT_PARAMS
from apps.payroll.models import ExpenseCategory, PayConfig
from apps.riders.models import Rider

ADMIN_EMAIL = "admin@sherpamobility.com"
GUARD_EMAIL = "guard@sherpamobility.com"


class Command(BaseCommand):
    help = "Seed demo data for local development (idempotent)."

    @transaction.atomic
    def handle(self, *args, **options):
        random.seed(42)

        admin, created = User.objects.get_or_create(
            email=ADMIN_EMAIL, defaults={"full_name": "Sherpa Admin"}
        )
        if created:
            admin.set_password("Admin@12345")
            admin.save()
        admin.grant_all_sections()

        guard, created = User.objects.get_or_create(
            email=GUARD_EMAIL, defaults={"full_name": "Gate Guard"}
        )
        if created:
            guard.set_password("Guard@12345")
            guard.save()
        SectionPermission.objects.update_or_create(
            user=guard, section="attendance",
            defaults={"can_view": True, "can_create": True, "can_edit": True, "can_delete": False},
        )

        for parameter, value in DEFAULT_PARAMS.items():
            PayConfig.objects.get_or_create(
                parameter=parameter, effective_from=date(2026, 7, 1), defaults={"value": value}
            )

        ExpenseCategory.objects.get_or_create(name="Fuel & Charging")
        ExpenseCategory.objects.get_or_create(name="Repairs")

        rider_names = ["Pemba Sherpa", "Anil Tamang", "Sunita Rai", "Dipesh Gurung", "Kiran Magar"]
        riders = []
        for index, name in enumerate(rider_names):
            rider, _ = Rider.objects.get_or_create(
                full_name=name,
                defaults={
                    "phone_number": f"98000000{index:02d}",
                    "joining_date": date.today() - timedelta(days=90 + index * 30),
                    "monthly_salary": Decimal("22000"),
                    "daily_ride_target": 22,
                    "fleet_pilot": index < 2,  # first two ride on the VPE track
                },
            )
            riders.append(rider)

        vehicles = []
        for index in range(len(riders)):
            number = f"V-{index + 1:03d}"
            vehicle, _ = Vehicle.objects.get_or_create(
                vehicle_number=number,
                defaults={
                    "plate_number": f"BA-99-PA-{1000 + index}",
                    "vehicle_type": "scooter",
                    "brand": "Yadea",
                    "last_service_odometer": 0,
                    "last_service_date": date.today() - timedelta(days=30),
                },
            )
            vehicles.append(vehicle)

        for rider, vehicle in zip(riders, vehicles):
            Assignment.objects.get_or_create(
                rider=rider, vehicle=vehicle, status=Assignment.Status.ACTIVE,
                defaults={"start_date": date.today() - timedelta(days=60)},
            )

        for offset in range(7, 0, -1):
            day = date.today() - timedelta(days=offset)
            if day.weekday() == 5:  # Saturday off
                continue
            for rider, vehicle in zip(riders, vehicles):
                rides = random.randint(15, 30)
                cash = Decimal(random.randint(1500, 3500))
                DailyLog.objects.get_or_create(
                    rider=rider, english_date=day,
                    defaults={
                        "vehicle": vehicle,
                        "rides_completed": rides,
                        "total_rides_received": rides + random.randint(0, 5),
                        "daily_bonus_set": 22,
                        "cash_as_per_app": cash,
                        "goal_bonus": Decimal("300") if rides >= 22 else Decimal("0"),
                        "total_income": cash + Decimal("300"),
                        "cash_given_by_driver": cash,
                        "daily_allowance": Decimal("200"),
                        "cash_check": Decimal("0"),
                    },
                )
                Attendance.objects.get_or_create(
                    rider=rider, date=day,
                    defaults={
                        "vehicle": vehicle,
                        "type": Attendance.Type.PRESENT,
                        "rider_time_in": "08:00",
                        "rider_time_out": "18:30",
                        "battery_out": 100,
                        "battery_in": random.randint(20, 60),
                        "morning_odometer": 1000 + offset * 60,
                        "evening_odometer": 1000 + offset * 60 + random.randint(40, 80),
                    },
                )

        self.stdout.write(self.style.SUCCESS(
            f"Seeded. Admin: {ADMIN_EMAIL} / Admin@12345 — Guard: {GUARD_EMAIL} / Guard@12345"
        ))
