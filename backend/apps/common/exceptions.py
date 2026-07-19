"""Uniform error envelope: {"detail": ..., "errors": {...}} with correct HTTP codes."""

from rest_framework.views import exception_handler


def envelope_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    if isinstance(data, dict) and "detail" in data and len(data) == 1:
        response.data = {"detail": data["detail"]}
    elif isinstance(data, (list, dict)):
        response.data = {"detail": "Validation failed.", "errors": data}
    return response
