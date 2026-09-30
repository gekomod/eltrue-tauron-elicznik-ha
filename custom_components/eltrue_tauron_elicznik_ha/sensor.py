"""Sensor platform for Tauron eLicznik integration."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import UnitOfEnergy, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from . import TauronElicznikConfigEntry
from .const import DOMAIN
from .coordinator import TauronCalculatedData, TauronElicznikCoordinator

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class TauronSensorEntityDescription(SensorEntityDescription):
    """Describes Tauron sensor entity."""

    value_fn: Callable[[TauronCalculatedData], Any]


def _pse_current_state(values: list[dict[str, Any]]) -> str | None:
    """Return the PSE recommendation for the current local hour."""
    if not values:
        return None

    current_hour = dt_util.now().hour
    prefix = dt_util.now().date().isoformat() + " "
    current_prefix = f"{prefix}{current_hour:02d}:"

    for item in values:
        dtime = str(item.get("dtime", ""))
        if dtime.startswith(current_prefix):
            state = item.get("state")
            return str(state) if state is not None else None

    return None


SENSOR_DESCRIPTIONS: tuple[TauronSensorEntityDescription, ...] = (
    TauronSensorEntityDescription(
        key="kwh_left",
        translation_key="kwh_left",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.kwh_left,
    ),
    TauronSensorEntityDescription(
        key="kwh_left_per_day",
        translation_key="kwh_left_per_day",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.kwh_left_per_day,
    ),
    TauronSensorEntityDescription(
        key="kwh_left_per_month",
        translation_key="kwh_left_per_month",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.kwh_left_per_month,
    ),
    TauronSensorEntityDescription(
        key="days_left",
        translation_key="days_left",
        native_unit_of_measurement=UnitOfTime.DAYS,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.days_left,
    ),
    TauronSensorEntityDescription(
        key="last_reading_date",
        translation_key="last_reading_date",
        device_class=SensorDeviceClass.TIMESTAMP,
        value_fn=lambda data: data.reading_date,
    ),
    TauronSensorEntityDescription(
        key="energia_pobrana",
        translation_key="energia_pobrana",
        device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.TOTAL_INCREASING,
        value_fn=lambda data: data.energia_pobrana,
    ),
    TauronSensorEntityDescription(
        key="energia_oddana",
        translation_key="energia_oddana",
        device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.TOTAL_INCREASING,
        value_fn=lambda data: data.energia_oddana,
    ),
    TauronSensorEntityDescription(
        key="energia_pobrana_start",
        translation_key="energia_pobrana_start",
        device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.TOTAL_INCREASING,
        value_fn=lambda data: data.energia_pobrana_start,
    ),
    TauronSensorEntityDescription(
        key="energia_oddana_start",
        translation_key="energia_oddana_start",
        device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.TOTAL_INCREASING,
        value_fn=lambda data: data.energia_oddana_start,
    ),
    TauronSensorEntityDescription(
        key="last_fetch_time",
        translation_key="last_fetch_time",
        device_class=SensorDeviceClass.TIMESTAMP,
        value_fn=lambda data: data.last_fetch_time,
    ),
    TauronSensorEntityDescription(
        key="energia_pobrana_dzien",
        translation_key="energia_pobrana_dzien",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.energia_pobrana_dzien,
    ),
    TauronSensorEntityDescription(
        key="energia_oddana_dzien",
        translation_key="energia_oddana_dzien",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.energia_oddana_dzien,
    ),
    TauronSensorEntityDescription(
        key="srednia_pobrana_dzien",
        translation_key="srednia_pobrana_dzien",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.srednia_pobrana_dzien,
    ),
    TauronSensorEntityDescription(
        key="srednia_oddana_dzien",
        translation_key="srednia_oddana_dzien",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.srednia_oddana_dzien,
    ),
    TauronSensorEntityDescription(
        key="tariff",
        translation_key="tariff",
        value_fn=lambda data: data.tariff,
    ),
    TauronSensorEntityDescription(
        key="pse_today",
        translation_key="pse_today",
        value_fn=lambda data: _pse_current_state(data.pse_today),
    ),
    TauronSensorEntityDescription(
        key="pse_tomorrow",
        translation_key="pse_tomorrow",
        value_fn=lambda data: _pse_current_state(data.pse_tomorrow),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: TauronElicznikConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Tauron eLicznik sensors."""
    coordinator = entry.runtime_data

    async_add_entities(
        TauronSensor(coordinator, description, entry)
        for description in SENSOR_DESCRIPTIONS
    )


class TauronSensor(CoordinatorEntity[TauronElicznikCoordinator], SensorEntity):
    """Representation of a Tauron eLicznik sensor."""

    entity_description: TauronSensorEntityDescription
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: TauronElicznikCoordinator,
        description: TauronSensorEntityDescription,
        entry: TauronElicznikConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Tauron eLicznik",
            manufacturer="Tauron Dystrybucja",
            model="eLicznik",
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return additional chart, tariff and PSE details."""
        if self.coordinator.data is None:
            return None

        key = self.entity_description.key

        if key == "energia_pobrana_dzien":
            return {
                "chart_history": self.coordinator.data.chart_history,
                "chart_days": len(self.coordinator.data.chart_history),
                "chart_source": "TAURON /odczyty/api (today) + /energia/api (history)",
            }

        if key == "tariff":
            return {"source": "TAURON /energia/api"}

        if key in {"pse_today", "pse_tomorrow"}:
            values = (
                self.coordinator.data.pse_today
                if key == "pse_today"
                else self.coordinator.data.pse_tomorrow
            )
            return {
                "source": "PSE Energetyczny Kompas /api/pdgsz",
                "hours": values,
                "hours_count": len(values),
            }

        return None

    @property
    def native_value(self) -> Any:
        """Return the state of the sensor."""
        if self.coordinator.data is None:
            return None
        return self.entity_description.value_fn(self.coordinator.data)
