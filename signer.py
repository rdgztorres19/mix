import time
import hmac
import hashlib
import base64
from urllib.parse import urlparse
import requests
from datetime import datetime, timezone


class HmacRequestSigner:
    def __init__(self, api_key: str, base_secret: str, period_seconds: int = 5):
        self.api_key = api_key
        self.base_secret = base_secret.encode()
        self.period = period_seconds  # cada cuánto cambia la clave derivada

    def _derive_secret(self, offset_seconds: int = 0) -> bytes:
        # slice = número que cambia cada periodo
        current_slice = int((time.time() + offset_seconds) // self.period)
        return hmac.new(self.base_secret, str(current_slice).encode(), hashlib.sha256).digest()

    def sign(self, method: str, url: str) -> dict:
        parsed = urlparse(url)
        path = parsed.path  # solo path, sin dominio

        timestamp = datetime.now(timezone.utc).isoformat()
        derived_secret = self._derive_secret()

        canonical = f"{method.upper()}\n{path}\n{self.api_key}\n{timestamp}"
        signature = base64.b64encode(
            hmac.new(derived_secret, canonical.encode(), hashlib.sha256).digest()
        ).decode()

        return {
            "X-Service": self.api_key,
            "X-Timestamp": timestamp,
            "X-Signature": signature,
        }

def consumer():
    signer = HmacRequestSigner(
        api_key="iot-connector",
        base_secret="super-secret-b",
        period_seconds=5
    )

    while True:
        try:
            url = f"http://localhost:3009/internal/status?timestamp={datetime.now(timezone.utc).isoformat()}"
            headers = signer.sign("GET", url)
            response = requests.get(url, headers=headers, timeout=5)
            print("✅", response.status_code)
        except requests.RequestException as e:
            if hasattr(e, "response") and e.response is not None:
                print("❌", e.response.status_code)
            else:
                print("⚠️", str(e))
        time.sleep(3)  # cada 3 segundos

if __name__ == "__main__":
    consumer()