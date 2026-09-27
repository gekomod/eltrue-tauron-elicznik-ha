"""Constants for the Tauron eLicznik integration."""

from typing import Final

DOMAIN: Final = "eltrue_tauron_elicznik_ha"

# URLs
URL_LOGIN: Final = "https://logowanie.tauron-dystrybucja.pl/login"
URL_SERVICE: Final = "https://elicznik.tauron-dystrybucja.pl"
URL_API: Final = "https://elicznik.tauron-dystrybucja.pl/odczyty/api"
URL_ENERGIA_API: Final = "https://elicznik.tauron-dystrybucja.pl/energia/api"
URL_LOGOUT: Final = "https://elicznik.tauron-dystrybucja.pl/applogout"

# Config keys
CONF_BILLING_PERIOD_START: Final = "billing_period_start"
CONF_PREV_ENERGIA_POBRANA: Final = "prev_energia_pobrana"
CONF_PREV_ENERGIA_ODDANA: Final = "prev_energia_oddana"

# Net-metering ratio (80% in Poland)
NET_METERING_RATIO: Final = 0.8

# Update interval (once per day at noon is typical for meter readings)
DEFAULT_SCAN_INTERVAL_HOURS: Final = 12
