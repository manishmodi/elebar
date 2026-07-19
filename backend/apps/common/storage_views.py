"""
Server-proxied file storage for KYC documents and handover photos.

Files land in MEDIA_ROOT/uploads/<uuid><ext> and are served back only through
the authenticated download view — KYC documents are never public.
"""

import uuid
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.parsers import FileUploadParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import BasePermission

from apps.authz.permissions import IsAuthenticatedActive

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}


class CanAccessDocuments(BasePermission):
    """Uploads hold KYC documents and handover photos — restrict to the
    sections that own them (riders for KYC, attendance for handover photos)."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.is_active):
            return False
        return (
            user.has_section_permission("riders", "view")
            or user.has_section_permission("attendance", "view")
        )


class StorageUploadView(APIView):
    permission_classes = [IsAuthenticatedActive, CanAccessDocuments]
    parser_classes = [MultiPartParser, FileUploadParser]

    def post(self, request):
        upload = request.FILES.get("file") or request.data.get("file")
        if upload is None:
            return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_UPLOAD_BYTES:
            return Response({"detail": "File exceeds the 15 MB limit."},
                            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        original = request.query_params.get("name") or upload.name or ""
        ext = Path(original).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return Response({"detail": f"File type {ext or '(none)'} not allowed."},
                            status=status.HTTP_400_BAD_REQUEST)

        name = f"{uuid.uuid4()}{ext}"
        target_dir = Path(settings.MEDIA_ROOT) / "uploads"
        target_dir.mkdir(parents=True, exist_ok=True)
        with open(target_dir / name, "wb") as fh:
            for chunk in upload.chunks():
                fh.write(chunk)

        return Response({"object_path": f"/objects/uploads/{name}"}, status=status.HTTP_201_CREATED)


class StorageObjectView(APIView):
    """Authenticated download; the path segment is a server-generated UUID
    filename so traversal isn't possible, but we normalize anyway."""

    permission_classes = [IsAuthenticatedActive, CanAccessDocuments]

    def get(self, request, name):
        base = (Path(settings.MEDIA_ROOT) / "uploads").resolve()
        target = (base / name).resolve()
        if base not in target.parents or not target.is_file():
            raise Http404
        return FileResponse(open(target, "rb"))
