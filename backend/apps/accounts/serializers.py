from django.db import transaction
from rest_framework import serializers

from apps.authz.sections import Section
from apps.common.serializers import UuidModelSerializer

from .models import SectionPermission, User


class SectionPermissionSerializer(serializers.ModelSerializer):
    section = serializers.ChoiceField(choices=Section.choices)

    class Meta:
        model = SectionPermission
        fields = ["section", "can_view", "can_create", "can_edit", "can_delete"]


class UserSerializer(UuidModelSerializer):
    permissions = serializers.SerializerMethodField()
    is_admin = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "is_active", "is_admin", "permissions", "created_at"]
        read_only_fields = ["created_at"]

    def get_permissions(self, obj):
        return obj.permission_matrix()


class UserWriteSerializer(UuidModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=10)
    permissions = SectionPermissionSerializer(many=True, required=False, write_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "is_active", "password", "permissions"]

    def create(self, validated_data):
        permissions = validated_data.pop("permissions", [])
        password = validated_data.pop("password", None)
        if not password:
            raise serializers.ValidationError({"password": "Password is required for new users."})
        user = User.objects.create_user(password=password, **validated_data)
        self._replace_permissions(user, permissions)
        return user

    def update(self, instance, validated_data):
        permissions = validated_data.pop("permissions", None)
        password = validated_data.pop("password", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.set_password(password)
        instance.save()
        if permissions is not None:
            self._replace_permissions(instance, permissions)
        return instance

    @staticmethod
    def _replace_permissions(user, permissions):
        sections = [row["section"] for row in permissions]
        if len(sections) != len(set(sections)):
            raise serializers.ValidationError(
                {"permissions": "Duplicate section in permission payload."}
            )
        with transaction.atomic():
            user.section_permissions.all().delete()
            SectionPermission.objects.bulk_create(
                SectionPermission(user=user, **row) for row in permissions
            )

    def to_representation(self, instance):
        return UserSerializer(instance).data
