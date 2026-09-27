"""API client for Tauron eLicznik."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import logging
import re
from typing import Any

from aiohttp import ClientSession

from .const import URL_API, URL_ENERGIA_API, URL_LOGIN, URL_LOGOUT, URL_SERVICE

_LOGGER = logging.getLogger(__name__)


class TauronApiError(Exception):
    """Exception for Tauron API errors."""


class TauronAuthError(TauronApiError):
    """Exception for authentication errors."""


@dataclass
class TauronEnergyData:
    """Data class for energy readings."""

    energia_pobrana: float
    energia_oddana: float
    reading_date: datetime
    success: bool
    energia_pobrana_okres: float
    energia_oddana_okres: float


class TauronApiClient:
    """Client for Tauron eLicznik API."""

    def __init__(
        self,
        session: ClientSession,
        username: str,
        password: str,
    ) -> None:
        """Initialize the API client."""
        self._session = session
        self._username = username
        self._password = password
        self._cookies: dict[str, str] = {}

    async def authenticate(self) -> bool:
        """Login to Tauron eLicznik via Keycloak CAS and obtain session cookies."""
        _LOGGER.debug("Authenticating with Tauron eLicznik (Keycloak)")

        # Step 1: GET login page with service param, follow redirects to Keycloak form
        login_url = f"{URL_LOGIN}?service={URL_SERVICE}"
        try:
            async with self._session.get(login_url, allow_redirects=True) as resp:
                html = await resp.text()
        except Exception as err:
            raise TauronApiError(f"Failed to reach login page: {err}") from err

        # Step 2: Extract Keycloak form action URL
        match = re.search(r'action="([^"]+)"', html)
        if not match:
            raise TauronAuthError("Could not find login form action URL")
        action_url = match.group(1).replace("&amp;", "&")
        _LOGGER.debug("Keycloak action URL: %s", action_url)

        # Step 3: POST credentials to Keycloak action URL
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
                    raise TauronAuthError(  # noqa: TRY301
                        f"Login failed - unexpected status {resp.status}"
                    )
                redirect_url = resp.headers.get("Location", "")
        except TauronAuthError:
            raise
        except Exception as err:
            raise TauronApiError(f"Authentication POST failed: {err}") from err

        # Keycloak redirects back to /login?ticket=... if credentials are wrong
        if not redirect_url or "login" in redirect_url and "ticket" not in redirect_url:
            raise TauronAuthError("Invalid username or password")

        # Step 4: Follow redirect(s) to elicznik service to get session cookies
        if redirect_url.startswith("/"):
            redirect_url = f"https://logowanie.tauron-dystrybucja.pl{redirect_url}"

        try:
            async with self._session.get(redirect_url, allow_redirects=True):
                self._cookies = {
                    cookie.key: cookie.value for cookie in self._session.cookie_jar
                }
        except Exception as err:
            raise TauronApiError(f"Failed to follow post-login redirect: {err}") from err

        if not self._cookies:
            raise TauronAuthError("No session cookies received after login")

        _LOGGER.debug("Successfully authenticated with Tauron eLicznik")
        return True

    async def fetch_energy_data(
        self, query_date: date | None = None
    ) -> TauronEnergyData:
        """Fetch both energia-pobrana and energia-oddana.

        Queries the last 7 days and returns the most recent reading.
        Today's data is usually not available until after midnight.
        """
        if query_date is None:
            query_date = date.today()

        # Query last 7 days to ensure we get data (today might not be available)
        from_date = query_date - timedelta(days=7)
        from_str = from_date.strftime("%d.%m.%Y")
        to_str = query_date.strftime("%d.%m.%Y")

        _LOGGER.debug("Fetching energy data for %s to %s", from_str, to_str)

        energia_pobrana = await self._fetch_energy_type(from_str, to_str, "energia-pobrana")
        energia_oddana = await self._fetch_energy_type(from_str, to_str, "energia-oddana")

        # Use the reading date from the response (most recent available data)
        reading_date = energia_pobrana.get("date", query_date)


        return TauronEnergyData(
            energia_pobrana=energia_pobrana["counter"],
            energia_oddana=energia_oddana["counter"],
            reading_date=reading_date,
            success=energia_pobrana["success"] and energia_oddana["success"],
        )

    async def _fetch_period_energy(
        self, from_str: str, to_str: str, energy_type: str
    ) -> float:
        """Fetch the eLicznik chart sum for a selected period.

        The official web application sends from, to, type and profile=full time
        to /energia/api and sums the returned EC values.
        """
        payload = {
            "from": from_str,
            "to": to_str,
            "type": energy_type,
            "profile": "full time",
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        data = await self._make_energy_api_request(payload, energy_type)
        if not data.get("success"):
            _LOGGER.warning("Energy API returned no data for %s", energy_type)
            return 0.0

        try:
            body = data.get("data", {})
            records = body.get("allData", []) if isinstance(body, dict) else body
            if not isinstance(records, list):
                return 0.0

            total = 0.0
            for record in records:
                if not isinstance(record, dict):
                    continue
                value = record.get("EC")
                if value is None:
                    continue
                total += float(value)

            _LOGGER.debug(
                "TAURON /energia/api %s %s-%s: %.3f kWh from %d records",
                energy_type,
                from_str,
                to_str,
                total,
                len(records),
            )
            return round(total, 3)
        except (TypeError, ValueError, AttributeError) as err:
            raise TauronApiError(
                f"Invalid /energia/api response for {energy_type}: {err}"
            ) from err

    async def _make_energy_api_request(
        self, payload: dict[str, str], energy_type: str
    ) -> dict[str, Any]:
        """POST to the official eLicznik energy/chart endpoint."""
        try:
            async with self._session.post(
                URL_ENERGIA_API,
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            ) as response:
                if response.status != 200:
                    raise TauronApiError(
                        f"Energy API request failed with status {response.status}"
                    )
                return await response.json()
        except TauronApiError:
            raise
        except Exception as err:
            raise TauronApiError(
                f"Failed to fetch period energy {energy_type}: {err}"
            ) from err

    async def _fetch_energy_type(
        self, from_str: str, to_str: str, energy_type: str
    ) -> dict[str, Any]:
        """Fetch a specific energy type from the API."""
        payload = {
            "from": from_str,
            "to": to_str,
            "type": energy_type,
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        data = await self._make_api_request(payload, headers, energy_type)

        if not data.get("success") or not data.get("data"):
            _LOGGER.warning("API returned no data for %s", energy_type)
            return {"success": False, "counter": 0.0}

        # Extract counter value from the LAST record (most recent data)
        # Response format: {"success": true, "data": [{"Date": "09.01.2026 23:59:59", "C": 28969}]}
        try:
            latest_record = data["data"][-1]  # Take last record (most recent)
            counter_value = float(latest_record["C"])

            # Parse the full datetime from the response (e.g. "09.01.2026 23:59:59")
            reading_date = datetime.strptime(latest_record["Date"], "%d.%m.%Y %H:%M:%S")
        except (KeyError, IndexError, TypeError, ValueError) as err:
            raise TauronApiError(f"Invalid API response format: {err}") from err

        return {"success": True, "counter": counter_value, "date": reading_date}

    async def _make_api_request(
        self, payload: dict[str, str], headers: dict[str, str], energy_type: str
    ) -> dict[str, Any]:
        """Make API request and return JSON data."""
        try:
            async with self._session.post(
                URL_API,
                data=payload,
                headers=headers,
            ) as response:
                if response.status != 200:
                    raise TauronApiError(  # noqa: TRY301
                        f"API request failed with status {response.status}"
                    )
                return await response.json()
        except TauronApiError:
            raise
        except Exception as err:
            raise TauronApiError(f"Failed to fetch {energy_type}: {err}") from err

    async def logout(self) -> None:
        """Logout from Tauron eLicznik."""
        try:
            async with self._session.get(URL_LOGOUT, allow_redirects=True):
                pass
        except Exception:  # noqa: BLE001
            _LOGGER.debug("Logout request failed (non-critical)")

        self._cookies = {}
        _LOGGER.debug("Logged out from Tauron eLicznik")

    async def test_connection(self) -> bool:
        """Test the connection by authenticating and fetching data."""
        await self.authenticate()
        await self.fetch_energy_data()
        await self.logout()
        return True
