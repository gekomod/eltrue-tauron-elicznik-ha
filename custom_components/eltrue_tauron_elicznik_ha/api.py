"""API client for Tauron eLicznik."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import logging
import re
from typing import Any

from aiohttp import ClientSession

from .const import (
    URL_API,
    URL_ENERGY_API,
    URL_LOGIN,
    URL_LOGOUT,
    URL_SELECT_METER,
    URL_SERVICE,
)

_LOGGER = logging.getLogger(__name__)


class TauronApiError(Exception):
    """Exception for Tauron API errors."""


class TauronAuthError(TauronApiError):
    """Exception for authentication errors."""


@dataclass
class TauronEnergyData:
    """Lifetime meter counter data."""

    energia_pobrana: float
    energia_oddana: float
    reading_date: datetime
    success: bool


@dataclass
class TauronPeriodEnergyData:
    """Energy values returned by the eLicznik chart API for a period."""

    energia_pobrana: float
    energia_oddana: float
    srednia_pobrana: float | None
    srednia_oddana: float | None
    reading_date: datetime
    success: bool


class TauronApiClient:
    """Client for Tauron eLicznik API."""

    def __init__(self, session: ClientSession, username: str, password: str) -> None:
        """Initialize the API client."""
        self._session = session
        self._username = username
        self._password = password
        self._cookies: dict[str, str] = {}
        self._selected_meter_id: str | None = None

    async def authenticate(self) -> bool:
        """Login and prepare the same selected-PPE session used by the website."""
        _LOGGER.debug("Authenticating with Tauron eLicznik (Keycloak)")
        login_url = f"{URL_LOGIN}?service={URL_SERVICE}"

        try:
            async with self._session.get(login_url, allow_redirects=True) as resp:
                html = await resp.text()
        except Exception as err:
            raise TauronApiError(f"Failed to reach login page: {err}") from err

        match = re.search(r'action="([^"]+)"', html)
        if not match:
            raise TauronAuthError("Could not find login form action URL")
        action_url = match.group(1).replace("&amp;", "&")

        login_data = {
            "username": self._username,
            "password": self._password,
            "credentialId": "",
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        try:
            async with self._session.post(
                action_url,
                data=login_data,
                headers=headers,
                allow_redirects=False,
            ) as resp:
                if resp.status not in (302, 303):
                    raise TauronAuthError(
                        f"Login failed - unexpected status {resp.status}"
                    )
                redirect_url = resp.headers.get("Location", "")
        except TauronAuthError:
            raise
        except Exception as err:
            raise TauronApiError(f"Authentication POST failed: {err}") from err

        if not redirect_url or ("login" in redirect_url and "ticket" not in redirect_url):
            raise TauronAuthError("Invalid username or password")

        if redirect_url.startswith("/"):
            redirect_url = f"https://logowanie.tauron-dystrybucja.pl{redirect_url}"

        try:
            async with self._session.get(redirect_url, allow_redirects=True) as resp:
                landing_html = await resp.text()

            self._cookies = {
                cookie.key: cookie.value for cookie in self._session.cookie_jar
            }
        except Exception as err:
            raise TauronApiError(f"Failed to follow post-login redirect: {err}") from err

        if not self._cookies:
            raise TauronAuthError("No session cookies received after login")

        selected_match = re.search(
            r'id=["\']selectedPoint["\'][^>]*value=["\']([^"\']+)["\']',
            landing_html,
            re.IGNORECASE,
        )
        if selected_match:
            self._selected_meter_id = selected_match.group(1)
            await self._select_meter(self._selected_meter_id)
        else:
            _LOGGER.debug(
                "Tauron page did not expose selectedPoint; keeping server-selected PPE"
            )

        _LOGGER.debug(
            "Successfully authenticated with Tauron eLicznik; selected PPE=%s",
            self._selected_meter_id or "server-default",
        )
        return True

    async def _select_meter(self, meter_id: str) -> None:
        """Select the same PPE as the web frontend before API requests."""
        payload = {"site[client]": meter_id}
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        try:
            async with self._session.post(
                URL_SELECT_METER,
                data=payload,
                headers=headers,
                allow_redirects=True,
            ) as response:
                if response.status != 200:
                    raise TauronApiError(
                        f"PPE selection failed with status {response.status}"
                    )
                await response.text()
        except TauronApiError:
            raise
        except Exception as err:
            raise TauronApiError(f"Failed to select PPE {meter_id}: {err}") from err

        _LOGGER.debug("Selected Tauron PPE %s", meter_id)

    async def fetch_energy_data(self, query_date: date | None = None) -> TauronEnergyData:
        """Fetch lifetime consumption and generation counters."""
        if query_date is None:
            query_date = date.today()

        from_date = query_date - timedelta(days=7)
        from_str = from_date.strftime("%d.%m.%Y")
        to_str = query_date.strftime("%d.%m.%Y")

        energia_pobrana = await self._fetch_energy_type(
            from_str, to_str, "energia-pobrana"
        )
        energia_oddana = await self._fetch_energy_type(
            from_str, to_str, "energia-oddana"
        )
        reading_date = energia_pobrana.get("date", query_date)

        return TauronEnergyData(
            energia_pobrana=energia_pobrana["counter"],
            energia_oddana=energia_oddana["counter"],
            reading_date=reading_date,
            success=energia_pobrana["success"] and energia_oddana["success"],
        )

    async def fetch_period_energy_data(
        self, query_date: date | None = None
    ) -> TauronPeriodEnergyData:
        """Fetch daily energy using the chart API used by the official website."""
        if query_date is None:
            query_date = date.today()

        date_str = query_date.strftime("%d.%m.%Y")
        payload = {
            "from": date_str,
            "to": date_str,
            "type": "consum",
            "profile": "full time",
        }

        consumption = await self._make_api_request(
            URL_ENERGY_API,
            payload,
            "energia consum",
        )
        consumed_total, consumed_average = self._parse_chart_energy(consumption)

        exported_total = 0.0
        exported_average: float | None = None

        try:
            exported_payload = {
                "from": date_str,
                "to": date_str,
                "type": "oze",
                "profile": "full time",
            }
            exported = await self._make_api_request(
                URL_ENERGY_API,
                exported_payload,
                "energia oddana",
            )
            exported_total, exported_average = self._parse_chart_energy(exported)
        except TauronApiError as err:
            _LOGGER.debug("No optional OZE data for %s: %s", date_str, err)

        return TauronPeriodEnergyData(
            energia_pobrana=consumed_total,
            energia_oddana=exported_total,
            srednia_pobrana=consumed_average,
            srednia_oddana=exported_average,
            reading_date=datetime.combine(query_date, datetime.min.time()),
            success=True,
        )

    @staticmethod
    def _parse_chart_energy(data: dict[str, Any]) -> tuple[float, float | None]:
        """Parse the /energia/api response around its values[] contract."""
        if not data.get("success"):
            raise TauronApiError("Tauron chart API returned success=false")

        payload = data.get("data")
        if not isinstance(payload, dict):
            raise TauronApiError("Tauron chart API returned invalid data object")

        values = payload.get("values")
        if not isinstance(values, list):
            raise TauronApiError("Tauron chart API returned no values[]")

        numeric_values = [
            float(value)
            for value in values
            if value is not None and str(value).strip() != ""
        ]
        if not numeric_values:
            raise TauronApiError("Tauron chart API returned an empty values[] array")

        average_raw = payload.get("average")
        try:
            average = float(average_raw) if average_raw is not None else None
        except (TypeError, ValueError):
            average = None

        return round(sum(numeric_values), 3), average

    async def _fetch_energy_type(
        self, from_str: str, to_str: str, energy_type: str
    ) -> dict[str, Any]:
        """Fetch a specific lifetime counter from the readings API."""
        payload = {"from": from_str, "to": to_str, "type": energy_type}

        data = await self._make_api_request(URL_API, payload, energy_type)

        if not data.get("success") or not data.get("data"):
            _LOGGER.warning("API returned no data for %s", energy_type)
            return {"success": False, "counter": 0.0}

        try:
            latest_record = data["data"][-1]
            counter_value = float(latest_record["C"])
            reading_date = datetime.strptime(
                latest_record["Date"], "%d.%m.%Y %H:%M:%S"
            )
        except (KeyError, IndexError, TypeError, ValueError) as err:
            raise TauronApiError(f"Invalid API response format: {err}") from err

        return {"success": True, "counter": counter_value, "date": reading_date}

    async def _make_api_request(
        self,
        url: str,
        payload: dict[str, str],
        operation: str,
    ) -> dict[str, Any]:
        """Make a form-encoded POST request and decode JSON safely."""
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
        }

        try:
            async with self._session.post(
                url,
                data=payload,
                headers=headers,
            ) as response:
                content_type = response.headers.get("Content-Type", "")
                if response.status != 200:
                    raise TauronApiError(
                        f"{operation} request failed with status {response.status}"
                    )

                if "text/html" in content_type.lower():
                    body = await response.text()
                    if "/blokada" in str(response.url) or "blokada" in body.lower():
                        raise TauronApiError(
                            f"{operation} request redirected to Tauron /blokada"
                        )
                    raise TauronApiError(
                        f"{operation} returned HTML instead of JSON"
                    )

                try:
                    return await response.json(content_type=None)
                except Exception as err:
                    raise TauronApiError(
                        f"{operation} returned invalid JSON: {err}"
                    ) from err
        except TauronApiError:
            raise
        except Exception as err:
            raise TauronApiError(f"Failed to fetch {operation}: {err}") from err

    async def logout(self) -> None:
        """Logout from Tauron eLicznik."""
        try:
            async with self._session.get(URL_LOGOUT, allow_redirects=True):
                pass
        except Exception:
            _LOGGER.debug("Logout request failed (non-critical)")

        self._cookies = {}
        self._selected_meter_id = None
        _LOGGER.debug("Logged out from Tauron eLicznik")

    async def test_connection(self) -> bool:
        """Test the connection by authenticating and fetching lifetime data."""
        await self.authenticate()
        try:
            await self.fetch_energy_data()
        finally:
            await self.logout()
        return True
