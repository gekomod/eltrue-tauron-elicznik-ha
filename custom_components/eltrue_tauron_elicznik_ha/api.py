"""API client for Tauron eLicznik."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import logging
import re
from typing import Any

from aiohttp import ClientSession

from .const import URL_API, URL_LOGIN, URL_LOGOUT, URL_SERVICE

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


class TauronApiClient:
    """Client for Tauron eLicznik API."""

    def __init__(self, session: ClientSession, username: str, password: str) -> None:
        """Initialize the API client."""
        self._session = session
        self._username = username
        self._password = password
        self._cookies: dict[str, str] = {}

    async def authenticate(self) -> bool:
        """Login to Tauron eLicznik via Keycloak CAS and obtain session cookies."""
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

        if not redirect_url or "login" in redirect_url and "ticket" not in redirect_url:
            raise TauronAuthError("Invalid username or password")

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

    async def fetch_energy_data(self, query_date: date | None = None) -> TauronEnergyData:
        """Fetch both energia-pobrana and energia-oddana."""
        if query_date is None:
            query_date = date.today()

        from_date = query_date - timedelta(days=7)
        from_str = from_date.strftime("%d.%m.%Y")
        to_str = query_date.strftime("%d.%m.%Y")

        energia_pobrana = await self._fetch_energy_type(from_str, to_str, "energia-pobrana")
        energia_oddana = await self._fetch_energy_type(from_str, to_str, "energia-oddana")
        reading_date = energia_pobrana.get("date", query_date)

        return TauronEnergyData(
            energia_pobrana=energia_pobrana["counter"],
            energia_oddana=energia_oddana["counter"],
            reading_date=reading_date,
            success=energia_pobrana["success"] and energia_oddana["success"],
        )

    async def _fetch_energy_type(
        self, from_str: str, to_str: str, energy_type: str
    ) -> dict[str, Any]:
        """Fetch a specific energy type from the API."""
        payload = {"from": from_str, "to": to_str, "type": energy_type}
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        data = await self._make_api_request(payload, headers, energy_type)

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
                    raise TauronApiError(
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
        except Exception:
            _LOGGER.debug("Logout request failed (non-critical)")

        self._cookies = {}
        _LOGGER.debug("Logged out from Tauron eLicznik")

    async def test_connection(self) -> bool:
        """Test the connection by authenticating and fetching data."""
        await self.authenticate()
        await self.fetch_energy_data()
        await self.logout()
        return True
