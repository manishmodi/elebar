from django.db import models

from apps.common.models import BaseModel

MONEY = dict(max_digits=12, decimal_places=2, null=True, blank=True)


class Rider(BaseModel):
    """Rider (driver) with full KYC. Deleting is blocked while operational
    records reference the rider — set status=inactive instead."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        INACTIVE = "inactive"

    class EmploymentType(models.TextChoices):
        FULL_TIME = "full_time"
        PART_TIME = "part_time"
        CONTRACT = "contract"

    # KYC
    kyc_submission_date = models.DateField(null=True, blank=True)

    # Personal
    full_name = models.CharField(max_length=255)
    phone_number = models.CharField(max_length=32)
    secondary_phone = models.CharField(max_length=32, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=16, blank=True)
    marital_status = models.CharField(max_length=16, blank=True)
    blood_group = models.CharField(max_length=8, blank=True)
    permanent_address = models.CharField(max_length=255, blank=True)
    temporary_address = models.CharField(max_length=255, blank=True)
    address = models.CharField(max_length=255, blank=True)
    email = models.EmailField(blank=True)
    emergency_contact = models.CharField(max_length=64, blank=True)

    # Identity documents
    citizenship_number = models.CharField(max_length=64, blank=True)
    citizenship_issue_date = models.CharField(max_length=32, blank=True)  # may be a BS date
    citizenship_issue_district = models.CharField(max_length=64, blank=True)
    citizenship_image_url = models.CharField(max_length=512, blank=True)
    nid_number = models.CharField(max_length=64, blank=True)
    nid_issue_date = models.CharField(max_length=32, blank=True)
    nid_issue_district = models.CharField(max_length=64, blank=True)

    # Driving license
    license_number = models.CharField(max_length=64, blank=True)
    license_expiry_date = models.DateField(null=True, blank=True)
    license_issue_date = models.CharField(max_length=32, blank=True)
    license_issue_district = models.CharField(max_length=64, blank=True)
    license_type = models.CharField(max_length=32, blank=True)
    license_image_url = models.CharField(max_length=512, blank=True)
    driving_experience = models.CharField(max_length=64, blank=True)

    # Family
    father_name = models.CharField(max_length=255, blank=True)
    father_phone = models.CharField(max_length=32, blank=True)
    mother_name = models.CharField(max_length=255, blank=True)
    mother_phone = models.CharField(max_length=32, blank=True)
    spouse_name = models.CharField(max_length=255, blank=True)
    spouse_phone = models.CharField(max_length=32, blank=True)
    grandfather_name = models.CharField(max_length=255, blank=True)
    grandmother_name = models.CharField(max_length=255, blank=True)
    family_address = models.CharField(max_length=255, blank=True)

    # Emergency contact
    emergency_contact_name = models.CharField(max_length=255, blank=True)
    emergency_contact_phone = models.CharField(max_length=32, blank=True)
    emergency_contact_relationship = models.CharField(max_length=64, blank=True)
    relationship_proof_url = models.CharField(max_length=512, blank=True)

    # Employment
    joining_date = models.DateField(null=True, blank=True)
    employment_type = models.CharField(
        max_length=16, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    salary_structure = models.CharField(max_length=64, blank=True)
    monthly_salary = models.DecimalField(**MONEY)
    daily_ride_target = models.PositiveIntegerField(null=True, blank=True)
    assigned_supervisor = models.CharField(max_length=255, blank=True)
    security_deposit = models.DecimalField(**MONEY)
    bank_account_details = models.CharField(max_length=255, blank=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True)

    # Integrations
    yango_driver_id = models.CharField(max_length=128, blank=True, db_index=True)
    # Gates the rider-app Fleet tab and the Variable Pay Engine.
    fleet_pilot = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["full_name"])]
        constraints = [
            # A Yango driver id is a rider-app identity — two riders sharing
            # one would shadow each other's handovers, cash and pay.
            models.UniqueConstraint(
                fields=["yango_driver_id"],
                condition=~models.Q(yango_driver_id=""),
                name="uniq_rider_yango_driver_id",
            ),
        ]

    def __str__(self):
        return self.full_name
