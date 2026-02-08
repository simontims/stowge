import os
import time
from datetime import datetime, timezone
from typing import Optional, Literal, List

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import engine, Base, get_db
from .models import User, Part, PartImage
from .auth import hash_password, verify_password, create_token, current_user, require_admin
from .images import process_and_store, resolve_path
from .openai_id import identify as openai_identify
from .image_signing import sign as sign_image, verify as verify_image, ttl_seconds

UI_DIR = os.getenv("UI_DIR", "/app/ui")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "").strip()

def init_db():
    Base.metadata.create_all(bind=engine)

init_db()

app = FastAPI(title="Kete", version="0.1.0")

if CORS_ORIGINS:
    origins = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ---------------- helpers ----------------

def _signed_image_url(image_id: str, variant: str) -> str:
    exp = int(time.time()) + ttl_seconds()
    sig = sign_image(image_id, variant, exp)
    return f"/api/images/{image_id}?variant={variant}&exp={exp}&sig={sig}"

def _variant_rel(img: PartImage, variant: str) -> str:
    if variant == "thumb":
        return img.path_thumb
    if variant == "display":
        return img.path_display
    if variant == "original":
        if not img.path_original:
            raise HTTPException(status_code=404, detail="Original not stored")
        return img.path_original
    raise HTTPException(status_code=400, detail="Invalid variant")

# ---------------- UI (PWA) ----------------
@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(os.path.join(UI_DIR, "index.html"), media_type="text/html")

@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(os.path.join(UI_DIR, "manifest.webmanifest"), media_type="application/manifest+json")

@app.get("/sw.js")
def sw():
    return FileResponse(os.path.join(UI_DIR, "sw.js"), media_type="application/javascript")

# ---------------- Status / Setup ----------------
@app.get("/api/status")
def status(db: Session = Depends(get_db)):
    return {"needs_setup": db.query(User).count() == 0}

@app.post("/api/setup/first-admin")
def setup_first_admin(payload: dict, db: Session = Depends(get_db)):
    if db.query(User).count() != 0:
        raise HTTPException(status_code=404, detail="Setup disabled")

    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    if len(username) < 3 or len(password) < 8:
        raise HTTPException(status_code=400, detail="Username >= 3 chars, password >= 8 chars")

    user = User(username=username, password_hash=hash_password(password), role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": create_token(user), "token_type": "bearer"}

@app.post("/api/login")
def login(payload: dict, db: Session = Depends(get_db)):
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return {"access_token": create_token(user), "token_type": "bearer"}

# ---------------- Users (admin) ----------------
@app.post("/api/users")
def create_user(payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    role = (payload.get("role") or "user").strip()

    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be admin|user")
    if len(username) < 3 or len(password) < 8:
        raise HTTPException(status_code=400, detail="Username >= 3 chars, password >= 8 chars")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    u = User(username=username, password_hash=hash_password(password), role=role)
    db.add(u)
    db.commit()
    return {"ok": True}

@app.delete("/api/users/{user_id}")
def delete_user(user_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if u.role == "admin":
        admins = db.query(User).filter(User.role == "admin").count()
        if admins <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")

    db.delete(u)
    db.commit()
    return {"ok": True}

# ---------------- Identify ----------------
@app.post("/api/identify")
def identify(
    mode: Literal["one", "five"] = "one",
    images: List[UploadFile] = File(...),
    me: User = Depends(current_user),
):
    if len(images) < 1 or len(images) > 5:
        raise HTTPException(status_code=400, detail="Provide 1 to 5 images")

    stored, b64s = process_and_store(images)
    # openai_id supports "many"/"five" - map your API param "five" accordingly
    ai_mode = "five" if mode == "five" else "one"
    ai = openai_identify(b64s, mode=ai_mode)

    return {
        "mode": mode,
        "ai": ai,
        "uploaded_images": [
            {"id": s["id"], "thumb_url": _signed_image_url(s["id"], "thumb")}
            for s in stored
        ],
        "stored_images": stored,
    }

# ---------------- Parts ----------------
@app.post("/api/parts")
def create_part(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = (payload.get("name") or "").strip()
    description = (payload.get("description") or "").strip()
    category = (payload.get("category") or "").strip() or None
    status = payload.get("status") or "draft"
    if status not in ("draft", "confirmed"):
        raise HTTPException(status_code=400, detail="status must be draft|confirmed")
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="name required")

    stored_images = payload.get("stored_images") or []
    if not stored_images:
        raise HTTPException(status_code=400, detail="stored_images required (from /identify)")

    p = Part(
        name=name,
        description=description or None,
        category=category,
        status=status,
        ai_primary=payload.get("ai_primary"),
        ai_alternatives=payload.get("ai_alternatives"),
        ai_chosen_index=payload.get("ai_chosen_index"),
    )
    db.add(p)
    db.flush()

    for s in stored_images:
        img = PartImage(
            id=s["id"],
            part_id=p.id,
            path_thumb=s["path_thumb"],
            path_display=s["path_display"],
            path_original=s.get("path_original"),
            mime=s.get("mime") or "image/webp",
            width=s.get("width"),
            height=s.get("height"),
        )
        db.add(img)

    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(p)
    return {"id": p.id}

@app.get("/api/parts")
def list_parts(q: Optional[str] = None, db: Session = Depends(get_db), me: User = Depends(current_user)):
    query = db.query(Part).order_by(Part.created_at.desc())
    if q:
        query = query.filter(Part.name.ilike(f"%{q.strip()}%"))
    parts = query.limit(200).all()
    return [{
        "id": p.id,
        "name": p.name,
        "category": p.category,
        "status": p.status,
        "created_at": p.created_at.isoformat(),
        "thumb": (_signed_image_url(p.images[0].id, "thumb") if p.images else None),
    } for p in parts]

@app.get("/api/parts/{part_id}")
def get_part(part_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "category": p.category,
        "status": p.status,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
        "images": [{
            "id": img.id,
            "thumb_url": _signed_image_url(img.id, "thumb"),
            "display_url": _signed_image_url(img.id, "display"),
            "original_url": (_signed_image_url(img.id, "original") if img.path_original else None),
        } for img in p.images],
        "ai_primary": p.ai_primary,
        "ai_alternatives": p.ai_alternatives,
        "ai_chosen_index": p.ai_chosen_index,
    }

@app.patch("/api/parts/{part_id}")
def update_part(part_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    for field in ("name", "description", "category", "status"):
        if field in payload:
            setattr(p, field, payload[field])

    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}

# ---------------- Images ----------------

@app.get("/api/images/{image_id}/signed")
def get_signed_image_url(
    image_id: str,
    variant: Literal["thumb", "display", "original"] = "display",
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    # Validate image exists and variant exists (esp original)
    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")
    _ = _variant_rel(img, variant)  # raises if original missing
    return {"url": _signed_image_url(image_id, variant)}

@app.get("/api/images/{image_id}")
def get_image(
    request: Request,
    image_id: str,
    variant: Literal["thumb", "display", "original"] = "display",
    exp: Optional[int] = Query(default=None),
    sig: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    # If Authorization header is present, enforce bearer auth
    auth = request.headers.get("authorization")
    if auth:
        _ = current_user(Authorization=auth, db=db)
    else:
        # No bearer header: require a valid signed URL
        if exp is None or sig is None or not verify_image(image_id, variant, exp, sig):
            raise HTTPException(status_code=401, detail="Missing bearer token")

    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")

    rel = _variant_rel(img, variant)
    abs_path = resolve_path(rel)
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    return FileResponse(abs_path, media_type=img.mime, headers=headers)