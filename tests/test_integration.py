"""Tests for Tauron eLicznik integration.

Covers:
- Constants (DOMAIN, URLs, NET_METERING_RATIO)
- TauronCalculatedData computation via TauronElicznikCoordinator._calculate_data()
- Sensor description catalogue (keys, device_class, state_class)
- API response parsing helpers
"""

from __future__ import annotations

import dataclasses
import importlib.util
import os
import sys
import types
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── helpers ──────────────────────────────────────────────────────────────────

def _load(relative_path: str, module_name: str | None = None):
    """Load a Python file from the repo by relative path."""
    abs_path = os.path.join(ROOT, relative_path)
    name = module_name or f"_tauron_{relative_path.replace('/', '_').replace('.py', '')}"
    spec = importlib.util.spec_from_file_location(name, abs_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_with_stubs():
    """Load const, api, coordinator, and sensor with minimal HA stubs.

    Returns (const_mod, coordinator_mod, sensor_mod) tuple.
    """
    import dataclasses as _dc
    from typing import Any as _Any

    # ── stub classes ──────────────────────────────────────────────────────────

    class _Subscriptable:
        def __class_getitem__(cls, item):
            return cls
        def __init__(self, *args, **kwargs):
            pass
        def __init_subclass__(cls, **kwargs):
            pass

    @_dc.dataclass(frozen=True, kw_only=True)
    class _SensorEntityDescription:
        key: str = ""
        name: _Any = None
        device_class: _Any = None
        native_unit_of_measurement: _Any = None
        state_class: _Any = None
        icon: _Any = None
        entity_registry_enabled_default: bool = True
        entity_registry_visible_default: bool = True
        has_entity_name: bool = False
        translation_key: _Any = None
        translation_placeholders: _Any = None
        unit_of_measurement: _Any = None

        def __class_getitem__(cls, item):
            return cls

    # ── sys.modules stubs ─────────────────────────────────────────────────────

    stubs = {
        "homeassistant": types.ModuleType("homeassistant"),
        "homeassistant.components": types.ModuleType("homeassistant.components"),
        "homeassistant.components.sensor": types.SimpleNamespace(
            SensorDeviceClass=types.SimpleNamespace(
                ENERGY="energy",
                TIMESTAMP="timestamp",
            ),
            SensorEntity=type(
                "SensorEntity",
                (),
                {
                    "__class_getitem__": classmethod(lambda c, i: c),
                    "__init__": lambda s, *a, **k: None,
                },
            ),
            SensorEntityDescription=_SensorEntityDescription,
            SensorStateClass=types.SimpleNamespace(
                MEASUREMENT="measurement",
                TOTAL_INCREASING="total_increasing",
            ),
        ),
        "homeassistant.config_entries": types.SimpleNamespace(ConfigEntry=_Subscriptable),
        "homeassistant.const": types.SimpleNamespace(
            Platform=types.SimpleNamespace(BUTTON="button", SENSOR="sensor"),
            UnitOfEnergy=types.SimpleNamespace(KILO_WATT_HOUR="kWh"),
            UnitOfTime=types.SimpleNamespace(DAYS="d"),
            CONF_HOST="host",
            CONF_PORT="port",
        ),
        "homeassistant.core": types.SimpleNamespace(HomeAssistant=object),
        "homeassistant.exceptions": types.SimpleNamespace(ConfigEntryNotReady=Exception),
        "homeassistant.helpers": types.ModuleType("homeassistant.helpers"),
        "homeassistant.helpers.aiohttp_client": types.SimpleNamespace(async_get_clientsession=lambda hass: None),
        "homeassistant.helpers.entity_platform": types.SimpleNamespace(
            AddEntitiesCallback=None,
            AddConfigEntryEntitiesCallback=None,
        ),
        "homeassistant.helpers.update_coordinator": types.SimpleNamespace(
            CoordinatorEntity=type(
                "CoordinatorEntity",
                (),
                {
                    "__class_getitem__": classmethod(lambda c, i: c),
                    "__init__": lambda s, *a, **k: None,
                    "__init_subclass__": classmethod(lambda c, **k: None),
                },
            ),
            DataUpdateCoordinator=_Subscriptable,
            UpdateFailed=Exception,
        ),
        "homeassistant.helpers.device_registry": types.SimpleNamespace(
            DeviceEntryType=types.SimpleNamespace(SERVICE="service"),
            DeviceInfo=dict,
        ),
        "homeassistant.util": types.ModuleType("homeassistant.util"),
        "homeassistant.util.dt": types.SimpleNamespace(
            as_local=lambda dt: dt,
            now=lambda: datetime.now(),
        ),
        "aiohttp": types.SimpleNamespace(ClientSession=object),
    }
    for name, stub in stubs.items():
        sys.modules[name] = stub

    # ── load integration modules ──────────────────────────────────────────────

    pkg_path = os.path.join(ROOT, "custom_components", "eltrue_tauron_elicznik_ha")

    def _load_pkg_module(filename, short):
        full_name = f"custom_components.eltrue_tauron_elicznik_ha.{short}"
        spec = importlib.util.spec_from_file_location(
            full_name, os.path.join(pkg_path, filename)
        )
        mod = importlib.util.module_from_spec(spec)
        sys.modules[full_name] = mod
        spec.loader.exec_module(mod)
        return mod

    sys.modules["custom_components"] = types.ModuleType("custom_components")
    sys.modules["custom_components.eltrue_tauron_elicznik_ha"] = types.ModuleType(
        "custom_components.eltrue_tauron_elicznik_ha"
    )

    const_mod = _load_pkg_module("const.py", "const")
    api_mod = _load_pkg_module("api.py", "api")
    coord_mod = _load_pkg_module("coordinator.py", "coordinator")

    # sensor.py does `from . import TauronElicznikConfigEntry` — stub it on the pkg
    pkg_mod = sys.modules["custom_components.eltrue_tauron_elicznik_ha"]
    pkg_mod.TauronElicznikConfigEntry = _Subscriptable  # type: ignore[attr-defined]

    sensor_mod = _load_pkg_module("sensor.py", "sensor")

    return const_mod, api_mod, coord_mod, sensor_mod


_const, _api, _coord, _sensor = _load_with_stubs()


# ── constants ─────────────────────────────────────────────────────────────────

def test_domain():
    assert _const.DOMAIN == "eltrue_tauron_elicznik_ha"


def test_net_metering_ratio():
    assert _const.NET_METERING_RATIO == 0.8


def test_default_scan_interval():
    assert _const.DEFAULT_SCAN_INTERVAL_HOURS == 12


def test_url_login():
    assert "tauron" in _const.URL_LOGIN.lower()
    assert _const.URL_LOGIN.startswith("https://")


def test_url_api():
    assert "elicznik" in _const.URL_API.lower()
    assert _const.URL_API.startswith("https://")


# ── sensor descriptions ───────────────────────────────────────────────────────

def test_sensor_descriptions_count():
    assert len(_sensor.SENSOR_DESCRIPTIONS) == 23


def test_sensor_keys_present():
    keys = {d.key for d in _sensor.SENSOR_DESCRIPTIONS}
    assert keys == {
        "kwh_left",
        "kwh_left_per_day",
        "kwh_left_per_month",
        "days_left",
        "last_reading_date",
        "energia_pobrana",
        "energia_oddana",
        "energia_pobrana_start",
        "energia_oddana_start",
        "last_fetch_time",
        "energia_pobrana_dzien",
        "t1",
        "t2",
        "t3",
        "t1_dzisiaj",
        "t2_dzisiaj",
        "t3_dzisiaj",
        "energia_oddana_dzien",
        "srednia_pobrana_dzien",
        "srednia_oddana_dzien",
        "tariff",
        "pse_today",
        "pse_tomorrow",
    }


def test_sensor_energy_keys_have_kwh_unit():
    energy_keys = {
        "kwh_left", "kwh_left_per_day", "kwh_left_per_month",
        "energia_pobrana", "energia_oddana",
        "energia_pobrana_start", "energia_oddana_start",
    }
    for desc in _sensor.SENSOR_DESCRIPTIONS:
        if desc.key in energy_keys:
            assert desc.native_unit_of_measurement == "kWh", (
                f"{desc.key} should have kWh unit"
            )


def test_timestamp_sensors_have_device_class():
    ts_keys = {"last_reading_date", "last_fetch_time"}
    for desc in _sensor.SENSOR_DESCRIPTIONS:
        if desc.key in ts_keys:
            assert desc.device_class == "timestamp", (
                f"{desc.key} should have TIMESTAMP device class"
            )


def test_parse_chart_energy_values_and_average():
    """Chart API totals are the sum of the returned values[] array."""
    data = {
        "success": True,
        "data": {"values": [1.2, 2.3, 7.1], "average": 0.4},
    }
    total, average = _api.TauronApiClient._parse_chart_energy(data)
    assert total == 10.6
    assert average == 0.4


def test_parse_chart_energy_ignores_missing_values():
    """Null chart points do not contribute to the daily total."""
    data = {
        "success": True,
        "data": {"values": [None, 1.5, None, 2.0], "average": None},
    }
    total, average = _api.TauronApiClient._parse_chart_energy(data)
    assert total == 3.5
    assert average is None


def test_parse_chart_energy_rejects_empty_values():
    """An empty values array is treated as unavailable chart data."""
    try:
        _api.TauronApiClient._parse_chart_energy(
            {"success": True, "data": {"values": []}}
        )
    except _api.TauronApiError:
        return
    raise AssertionError("Expected TauronApiError")


# ── TauronCalculatedData computation ──────────────────────────────────────────

def _make_fake_coord(billing_end: date, prev_pobrana: float, prev_oddana: float):
    """Create a minimal fake coordinator for _calculate_data calls."""

    class _FakeCoord:
        _billing_period_end = billing_end
        _prev_energia_pobrana = prev_pobrana
        _prev_energia_oddana = prev_oddana

    return _FakeCoord()


def _energy_data(pobrana: float, oddana: float, reading_dt: datetime | None = None):
    """Build a TauronEnergyData stub."""
    return _api.TauronEnergyData(
        energia_pobrana=pobrana,
        energia_oddana=oddana,
        reading_date=reading_dt or datetime(2026, 1, 9, 23, 59, 59),
        energia_pobrana_dzisiaj=None,
        energia_oddana_dzisiaj=None,
        t1=None,
        t2=None,
        t3=None,
        t1_dzisiaj=None,
        t2_dzisiaj=None,
        t3_dzisiaj=None,
        success=True,
    )


def test_kwh_left_positive_balance():
    """Prosumer with more export than import — balance is positive."""
    # prev: 1000/500, now: 1100/700 => increment: +100 pobrana, +200 oddana
    # kwh_left = 0.8 * 200 - 100 = 60
    coord = _make_fake_coord(
        billing_end=date.today() + timedelta(days=100),
        prev_pobrana=1000.0,
        prev_oddana=500.0,
    )
    fetch_time = datetime(2026, 4, 12, 12, 0, 0)
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(1100.0, 700.0), fetch_time
    )
    assert result.kwh_left == 60.0
    assert result.energia_pobrana_increment == 100.0
    assert result.energia_oddana_increment == 200.0


def test_kwh_left_negative_balance():
    """More import than net-metered export — balance is negative."""
    # prev: 1000/500, now: 1300/700 => +300 pobrana, +200 oddana
    # kwh_left = 0.8 * 200 - 300 = -140
    coord = _make_fake_coord(
        billing_end=date.today() + timedelta(days=100),
        prev_pobrana=1000.0,
        prev_oddana=500.0,
    )
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(1300.0, 700.0), datetime(2026, 4, 12, 12, 0, 0)
    )
    assert result.kwh_left == -140.0


def test_kwh_left_zero_increment():
    """No change since billing start — everything is zero."""
    coord = _make_fake_coord(
        billing_end=date.today() + timedelta(days=30),
        prev_pobrana=1000.0,
        prev_oddana=500.0,
    )
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(1000.0, 500.0), datetime(2026, 4, 12, 12, 0, 0)
    )
    assert result.kwh_left == 0.0
    assert result.kwh_left_per_day == 0.0
    assert result.kwh_left_per_month == 0.0


def test_days_left_minimum_one():
    """days_left is clamped to at least 1 (no division by zero)."""
    coord = _make_fake_coord(
        billing_end=date.today() - timedelta(days=10),  # already past
        prev_pobrana=0.0,
        prev_oddana=0.0,
    )
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(100.0, 200.0), datetime(2026, 4, 12, 12, 0, 0)
    )
    assert result.days_left == 1


def test_kwh_left_per_month_is_30x_per_day():
    """kwh_left_per_month = round(30 * (kwh_left / days_left), 2).

    Both fields are rounded independently, so we can only verify the relationship
    when kwh_left divides evenly by days_left (no rounding artefact).
    Here: kwh_left=120.0, days_left=10 → per_day=12.0, per_month=360.0
    """
    coord = _make_fake_coord(
        billing_end=date.today() + timedelta(days=10),
        prev_pobrana=500.0,
        prev_oddana=200.0,
    )
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(700.0, 600.0), datetime(2026, 4, 12, 12, 0, 0)
    )
    # kwh_left = 0.8*400 - 200 = 120; days_left = 10
    assert result.kwh_left == 120.0
    assert result.kwh_left_per_day == 12.0
    assert result.kwh_left_per_month == 360.0


def test_net_metering_ratio_applied():
    """Only 80 % of exported energy counts against consumed."""
    # 500 kWh exported, 400 kWh consumed since start
    # kwh_left = 0.8 * 500 - 400 = 400 - 400 = 0
    coord = _make_fake_coord(
        billing_end=date.today() + timedelta(days=10),
        prev_pobrana=0.0,
        prev_oddana=0.0,
    )
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(400.0, 500.0), datetime(2026, 4, 12, 12, 0, 0)
    )
    assert result.kwh_left == 0.0


def test_start_reading_values_passed_through():
    """Billing-start reference readings are present in the result."""
    coord = _make_fake_coord(
        billing_end=date.today() + timedelta(days=30),
        prev_pobrana=12345.6,
        prev_oddana=9876.5,
    )
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(12400.0, 9900.0), datetime(2026, 4, 12, 12, 0, 0)
    )
    assert result.energia_pobrana_start == 12345.6
    assert result.energia_oddana_start == 9876.5


def test_raw_readings_passed_through():
    """Current meter readings are preserved unchanged in the result."""
    coord = _make_fake_coord(
        billing_end=date.today() + timedelta(days=30),
        prev_pobrana=0.0,
        prev_oddana=0.0,
    )
    result = _coord.TauronElicznikCoordinator._calculate_data(
        coord, _energy_data(28969.0, 15000.0), datetime(2026, 4, 12, 12, 0, 0)
    )
    assert result.energia_pobrana == 28969.0
    assert result.energia_oddana == 15000.0


# ── API response parsing ──────────────────────────────────────────────────────

def test_tauron_energy_data_dataclass():
    """TauronEnergyData can be constructed and accessed normally."""
    reading = datetime(2026, 1, 9, 23, 59, 59)
    data = _api.TauronEnergyData(
        energia_pobrana=28969.0,
        energia_oddana=15000.0,
        reading_date=reading,
        energia_pobrana_dzisiaj=None,
        energia_oddana_dzisiaj=None,
        t1=None,
        t2=None,
        t3=None,
        t1_dzisiaj=None,
        t2_dzisiaj=None,
        t3_dzisiaj=None,
        success=True,
    )
    assert data.energia_pobrana == 28969.0
    assert data.energia_oddana == 15000.0
    assert data.reading_date == reading
    assert data.success is True
