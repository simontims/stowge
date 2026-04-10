import hmac
import hashlib
import os
import time

def _secret() -> bytes:
    s = os.getenv("IMAGE_URL_SECRET", "")
    return s.encode("utf-8")

def ttl_seconds() -> int:
    return int(os.getenv("IMAGE_URL_TTL_SECONDS", "600"))

def sign(image_id: str, variant: str, exp: int) -> str:
    msg = f"{image_id}:{variant}:{exp}".encode("utf-8")
    return hmac.new(_secret(), msg, hashlib.sha256).hexdigest()

def verify(image_id: str, variant: str, exp: int, sig: str) -> bool:
    try:
        exp_i = int(exp)
    except Exception:
        return False
    if exp_i < int(time.time()):
        return False
    expected = sign(image_id, variant, exp_i)
    return hmac.compare_digest(expected, sig)