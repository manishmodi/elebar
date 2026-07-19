from rest_framework.pagination import CursorPagination, PageNumberPagination


class DefaultCursorPagination(CursorPagination):
    """Keyset pagination for hot tables — never offset."""

    page_size = 25
    max_page_size = 100
    page_size_query_param = "page_size"
    ordering = "-created_at"


class AdminPageNumberPagination(PageNumberPagination):
    """Small, cold admin lists where page numbers are genuinely useful."""

    page_size = 25
    max_page_size = 100
    page_size_query_param = "page_size"
