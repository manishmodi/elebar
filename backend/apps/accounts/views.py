from django.contrib.auth import authenticate
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authz.permissions import IsAdmin, IsAuthenticatedActive
from apps.common.pagination import AdminPageNumberPagination

from .models import ActivityLog, User, log_activity
from .serializers import SectionPermissionSerializer, UserSerializer, UserWriteSerializer


class LoginThrottle(AnonRateThrottle):
    scope = "login"


class LoginView(APIView):
    """POST {email, password} -> {access, refresh, user}. Throttled."""

    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        user = authenticate(request, username=email, password=password)
        if user is None or not user.is_active:
            log_activity(None, ActivityLog.Action.LOGIN_FAILED, "auth",
                         f"Failed login for {email}", user_name=email or "unknown")
            return Response({"detail": "Invalid credentials."}, status=status.HTTP_401_UNAUTHORIZED)

        refresh = RefreshToken.for_user(user)
        log_activity(user, ActivityLog.Action.LOGIN, "auth", f"{user.email} logged in")
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        })


class RefreshView(APIView):
    """Rotating refresh: the old token is blacklisted and a new pair issued.
    A deactivated user's refresh token stops working immediately."""

    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get("refresh") or ""
        try:
            refresh = RefreshToken(token)
        except TokenError:
            return Response({"detail": "Invalid refresh token."}, status=status.HTTP_401_UNAUTHORIZED)

        user = User.objects.filter(pk=refresh.get("user_id"), is_active=True).first()
        if user is None:
            return Response({"detail": "Invalid refresh token."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            refresh.blacklist()
        except TokenError:
            return Response({"detail": "Invalid refresh token."}, status=status.HTTP_401_UNAUTHORIZED)
        new_refresh = RefreshToken.for_user(user)
        return Response({"access": str(new_refresh.access_token), "refresh": str(new_refresh)})


class MeView(APIView):
    permission_classes = [IsAuthenticatedActive]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class LogoutView(APIView):
    """Blacklists the presented refresh token so logout actually revokes."""

    permission_classes = [IsAuthenticatedActive]

    def post(self, request):
        token = request.data.get("refresh") or ""
        if token:
            try:
                RefreshToken(token).blacklist()
            except TokenError:
                pass  # already invalid/blacklisted — logout is still fine
        log_activity(request.user, ActivityLog.Action.LOGOUT, "auth", f"{request.user.email} logged out")
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserViewSet(viewsets.ModelViewSet):
    """User management — admin only."""

    permission_classes = [IsAdmin]
    pagination_class = AdminPageNumberPagination
    lookup_field = "uuid"
    queryset = User.objects.prefetch_related("section_permissions").order_by("id")

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return UserWriteSerializer
        return UserSerializer

    def perform_create(self, serializer):
        user = serializer.save()
        log_activity(self.request.user, ActivityLog.Action.CREATED, "users", f"Created user {user.email}")

    def perform_update(self, serializer):
        user = serializer.save()
        log_activity(self.request.user, ActivityLog.Action.UPDATED, "users", f"Updated user {user.email}")

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance == request.user:
            return Response({"detail": "You cannot delete your own account."},
                            status=status.HTTP_400_BAD_REQUEST)
        log_activity(request.user, ActivityLog.Action.DELETED, "users", f"Deleted user {instance.email}")
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get", "put"], url_path="permissions")
    def permissions_matrix(self, request, uuid=None):
        user = self.get_object()
        if request.method == "PUT":
            serializer = SectionPermissionSerializer(data=request.data, many=True)
            serializer.is_valid(raise_exception=True)
            UserWriteSerializer._replace_permissions(user, serializer.validated_data)
            log_activity(request.user, ActivityLog.Action.UPDATED, "users",
                         f"Replaced permissions for {user.email}")
        return Response(user.permission_matrix())


class ActivityLogListView(APIView):
    """Admin-only audit trail with basic filters."""

    permission_classes = [IsAdmin]

    def get(self, request):
        qs = ActivityLog.objects.all()
        if section := request.query_params.get("section"):
            qs = qs.filter(section=section)
        if act := request.query_params.get("action"):
            qs = qs.filter(action=act)
        if date_from := request.query_params.get("date_from"):
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to := request.query_params.get("date_to"):
            qs = qs.filter(created_at__date__lte=date_to)
        rows = qs.select_related("user")[:1000]
        return Response([
            {
                "id": row.id,
                "user": str(row.user.uuid) if row.user else None,
                "user_name": row.user_name,
                "action": row.action,
                "section": row.section,
                "description": row.description,
                "created_at": row.created_at,
            }
            for row in rows
        ])
