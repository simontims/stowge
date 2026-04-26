from fastapi import HTTPException


MIN_NAME_LENGTH = 2


def normalize_name(value: object) -> str:
    return str(value or "").strip()


def require_name(value: object, *, min_length: int = MIN_NAME_LENGTH) -> str:
    name = normalize_name(value)
    if len(name) < min_length:
        raise HTTPException(status_code=400, detail=f"name required (>= {min_length} chars)")
    return name