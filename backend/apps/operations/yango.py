"""
Yango Fleet API adapter.

Convention: integrations stay INACTIVE until credentials exist — without the
YANGO_* env vars every endpoint reports unconfigured and no dev traffic can
ever hit the live API. The full sync engine (draft daily-log ingestion,
next-day goal-bonus reads) is ported behind this adapter.
"""

import os

import requests

BASE_URL = "https://fleet-api.yango.tech"
TIMEOUT = 15


class YangoNotConfigured(Exception):
    pass


class YangoClient:
    def __init__(self):
        self.client_id = os.environ.get("YANGO_CLIENT_ID", "")
        self.park_id = os.environ.get("YANGO_PARK_ID", "")
        self.api_key = os.environ.get("YANGO_API_KEY", "")

    @property
    def configured(self):
        return bool(self.client_id and self.park_id and self.api_key)

    def _headers(self):
        if not self.configured:
            raise YangoNotConfigured("Yango credentials are not configured.")
        return {
            "X-Client-ID": self.client_id,
            "X-Park-ID": self.park_id,
            "X-API-Key": self.api_key,
        }

    def _post(self, path, payload):
        response = requests.post(
            f"{BASE_URL}{path}", json=payload, headers=self._headers(), timeout=TIMEOUT
        )
        response.raise_for_status()
        return response.json()

    def driver_profiles(self, limit=500):
        return self._post(
            "/v1/parks/driver-profiles/list",
            {"query": {"park": {"id": self.park_id}}, "limit": limit},
        )
