"""Unit tests for the migrate_legacy parse helpers/translators, plus one
integration-style run of the command's --self-test fixture pipeline."""

import json
from datetime import date
from io import StringIO

import bcrypt
import pytest
from django.contrib.auth.hashers import BCryptPasswordHasher
from django.core.management import call_command

from apps.common.management.commands.migrate_legacy import (
    Ctx,
    Row,
    SkipRow,
    _translate_handover_payload,
    _translate_ramp_value,
    migrate_users,
)
from apps.payroll.engine import _ramp_tier

pytestmark = pytest.mark.django_db


def _row(data, table="riders"):
    ctx = Ctx()
    ctx.begin_table(table)
    return Row(ctx, table, data)


# --- Row.money ----------------------------------------------------------------

def test_money_strips_commas_and_whitespace():
    row = _row({"amount": " 15,000.50 "})
    assert row.money("amount") == pytest.approx(15000.50)


def test_money_garbage_returns_none_with_warning():
    row = _row({"amount": "abc"})
    assert row.money("amount") is None
    assert row.ctx.warnings and row.ctx.warnings[0][2] == "amount"


def test_money_required_missing_defaults_to_zero_with_warning():
    row = _row({})
    assert row.money("amount", required=True) == 0
    assert any(w[2] == "amount" for w in row.ctx.warnings)


def test_money_quantizes_two_decimal_places_half_up():
    row = _row({"amount": "2200.755"})
    from decimal import Decimal
    assert row.money("amount") == Decimal("2200.76")


def test_money_blank_optional_is_none_without_warning():
    row = _row({"amount": ""})
    assert row.money("amount") is None
    assert row.ctx.warnings == []


# --- Row.date_ ------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("2026-07-06", date(2026, 7, 6)),
    ("2026/07/06", date(2026, 7, 6)),
    ("06/07/2026", date(2026, 7, 6)),
    ("06-07-2026", date(2026, 7, 6)),
])
def test_date_tolerant_formats(text, expected):
    row = _row({"d": text})
    assert row.date_("d") == expected


def test_date_iso_datetime_string():
    row = _row({"d": "2026-07-06T04:30:00Z"})
    assert row.date_("d") == date(2026, 7, 6)


def test_date_garbage_returns_none_with_warning():
    row = _row({"d": "13/45/2020"})
    assert row.date_("d") is None
    assert any(w[2] == "d" for w in row.ctx.warnings)


def test_date_required_missing_raises_skiprow():
    row = _row({})
    with pytest.raises(SkipRow):
        row.date_("d", required=True)


def test_date_required_unparseable_raises_skiprow():
    row = _row({"d": "not-a-date"})
    with pytest.raises(SkipRow):
        row.date_("d", required=True)


# --- Row.int_ / bool_ -----------------------------------------------------------

def test_int_out_of_range_dropped_with_warning():
    row = _row({"battery": 150})
    assert row.int_("battery", lo=0, hi=100) is None
    assert any(w[2] == "battery" for w in row.ctx.warnings)


def test_int_required_missing_raises_skiprow():
    row = _row({})
    with pytest.raises(SkipRow):
        row.int_("battery", required=True)


def test_int_parses_comma_separated_string():
    row = _row({"n": "12,345"})
    assert row.int_("n") == 12345


def test_bool_parses_common_truthy_falsy_strings():
    row = _row({"a": "t", "b": "0", "c": True})
    assert row.bool_("a") is True
    assert row.bool_("b") is False
    assert row.bool_("c") is True


def test_bool_garbage_falls_back_to_default_with_warning():
    row = _row({"a": "maybe"})
    assert row.bool_("a", default=False) is False
    assert any(w[2] == "a" for w in row.ctx.warnings)


# --- _translate_ramp_value: camelCase -> engine-compatible snake_case -----------

def test_translate_ramp_value_camel_case_to_snake_case():
    row = _row({}, table="pay_config")
    value = json.dumps([
        {"fromDay": 1, "toDay": 3, "gateRides": 17, "gateCash": 1500, "prize": 200},
        {"fromDay": 4, "toDay": None, "gateRides": 22, "gateCash": 2000, "prize": 250},
    ])

    translated = _translate_ramp_value(value, row)
    tiers = json.loads(translated)

    assert tiers[0] == {"from_day": 1, "to_day": 3, "gate_rides": 17, "gate_cash": 1500, "prize": 200}
    # The migrated ramp must be directly readable by the pay engine.
    tier = _ramp_tier(tiers, 2)
    assert tier["gate_rides"] == 17
    tier8 = _ramp_tier(tiers, 8)
    assert tier8["gate_rides"] == 22


def test_translate_ramp_value_invalid_json_kept_verbatim_with_warning():
    row = _row({}, table="pay_config")
    result = _translate_ramp_value("not valid json", row)
    assert result == "not valid json"
    assert row.ctx.warnings


def test_translate_ramp_value_non_list_kept_verbatim_with_warning():
    row = _row({}, table="pay_config")
    value = json.dumps({"not": "a list"})
    result = _translate_ramp_value(value, row)
    assert result == value
    assert row.ctx.warnings


# --- _translate_handover_payload -------------------------------------------------

def test_translate_checkout_payload_camelcase_keys():
    row = _row({}, table="fleet_handovers")
    payload = {"odometerOut": 100, "batteryOutPct": 80, "goalTier": 2, "time": "08:00"}

    translated = _translate_handover_payload(payload, row)

    assert translated == {"odometer": 100, "battery": 80, "goal_tier": 2, "time": "08:00"}


def test_translate_checkin_payload_declared_amounts():
    row = _row({}, table="fleet_handovers")
    payload = {"cashDeclared": "500", "walletDeclared": "50"}

    translated = _translate_handover_payload(payload, row)

    assert translated == {"cash": "500", "wallet": "50"}


def test_translate_exchange_payload_closing_opening_legs_recursively():
    row = _row({}, table="fleet_handovers")
    payload = {
        "closing": {"odometerOut": 100, "batteryOutPct": 50},
        "opening": {"odometerIn": 10, "batteryInPct": 90},
        "reason": "battery_low",
    }

    translated = _translate_handover_payload(payload, row)

    assert translated["closing"] == {"odometer": 100, "battery": 50}
    assert translated["opening"] == {"odometer": 10, "battery": 90}
    assert translated["reason"] == "battery_low"


def test_translate_handover_payload_unknown_key_kept_verbatim_with_warning():
    row = _row({}, table="fleet_handovers")
    payload = {"weirdLegacyKey": "x"}

    translated = _translate_handover_payload(payload, row)

    assert translated == {"weirdLegacyKey": "x"}
    assert any(w[2] == "payload" for w in row.ctx.warnings)


# --- bcrypt hash wrapping --------------------------------------------------------

def test_bcrypt_hash_wrapping_verifies_with_django_hasher():
    raw_password = "Secret#123"
    legacy_hash = bcrypt.hashpw(raw_password.encode(), bcrypt.gensalt(rounds=4)).decode()
    wrapped = f"bcrypt${legacy_hash}"

    assert BCryptPasswordHasher().verify(raw_password, wrapped)
    assert not BCryptPasswordHasher().verify("wrong-password", wrapped)


def test_migrate_users_wraps_bcrypt_hash_and_login_verifies():
    raw_password = "Secret#123"
    legacy_hash = bcrypt.hashpw(raw_password.encode(), bcrypt.gensalt(rounds=4)).decode()
    ctx = Ctx()
    ctx.begin_table("users")
    row = Row(ctx, "users", {
        "id": 1, "full_name": "Legacy Admin", "email": "legacy@example.com",
        "password_hash": legacy_hash, "is_active": True,
    })

    migrate_users(ctx, row)

    user = ctx.maps["users"][1]
    assert user.password.startswith("bcrypt$$2")
    assert user.check_password(raw_password)


def test_migrate_users_non_bcrypt_hash_is_unusable_with_warning():
    ctx = Ctx()
    ctx.begin_table("users")
    row = Row(ctx, "users", {
        "id": 1, "full_name": "Broken", "email": "broken@example.com",
        "password_hash": "plaintext-oops",
    })

    migrate_users(ctx, row)

    user = ctx.maps["users"][1]
    assert not user.has_usable_password()
    assert any(w[2] == "password_hash" for w in ctx.warnings)


# --- integration: --self-test exits cleanly -------------------------------------

def test_self_test_exits_cleanly():
    out = StringIO()
    call_command("migrate_legacy", "--self-test", stdout=out)
    assert "SELF-TEST PASSED" in out.getvalue()
