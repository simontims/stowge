import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from .db import Base

def now_utc():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, nullable=False, index=True)
    first_name = Column(String, nullable=False, default="")
    last_name = Column(String, nullable=False, default="")
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="admin")  # admin|user
    theme = Column(String, nullable=False, default="dark")  # dark|light
    preferred_add_collection_id = Column(String, nullable=True)
    last_open_collection = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

class Part(Base):
    __tablename__ = "parts"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    collection = Column(String, nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft|confirmed
    quantity = Column(Integer, nullable=False, default=1)
    location_id = Column(String, ForeignKey("locations.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)

    ai_primary = Column(JSON, nullable=True)
    ai_alternatives = Column(JSON, nullable=True)
    ai_chosen_index = Column(Integer, nullable=True)

    images = relationship("PartImage", back_populates="part", cascade="all, delete-orphan")

class PartImage(Base):
    __tablename__ = "images"
    id = Column(String, primary_key=True)  # set by /identify
    part_id = Column(String, ForeignKey("parts.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)

    path_thumb = Column(String, nullable=False)
    path_display = Column(String, nullable=False)
    path_original = Column(String, nullable=True)

    mime = Column(String, nullable=False, default="image/webp")
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)

    part = relationship("Part", back_populates="images")


class LLMConfig(Base):
    __tablename__ = "llm_configs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    provider = Column(String, nullable=False)
    model = Column(String, nullable=False)
    api_key = Column(String, nullable=False)
    api_base = Column(String, nullable=True)
    is_default = Column(Integer, nullable=False, default=0)  # 0|1 for sqlite compatibility
    evidence_enabled = Column(Integer, nullable=False, default=0)  # 0|1, off by default
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)


class Location(Base):
    __tablename__ = "locations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    photo_path = Column(String, nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)


class Collection(Base):
    __tablename__ = "collections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, unique=True, index=True)
    icon = Column(String, nullable=True)  # lucide icon name, e.g. 'cpu'
    description = Column(Text, nullable=True)
    ai_hint = Column(Text, nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)


class ImageSettings(Base):
    """Single-row singleton (id='singleton') for image processing configuration."""
    __tablename__ = "image_settings"

    id = Column(String, primary_key=True, default="singleton")
    store_original = Column(Integer, nullable=False, default=0)       # 0|1
    output_format = Column(String, nullable=False, default="webp")    # webp|jpg
    display_max_edge = Column(Integer, nullable=False, default=2048)
    display_quality = Column(Integer, nullable=False, default=82)
    thumb_max_edge = Column(Integer, nullable=False, default=360)
    thumb_quality = Column(Integer, nullable=False, default=70)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)


class UserSession(Base):
    """Server-side browser session. Created on login, deleted on logout."""
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)           # secrets.token_hex(32)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    expires_at = Column(DateTime(timezone=True), nullable=False)


class ExternalIdentity(Base):
    """Stub model for future OAuth/OIDC provider links (Google, Microsoft, etc.).

    Not yet wired to any routes.  When OIDC support is added, each provider
    login will upsert a row here and resolve to a local User record so that
    Stowge authorization remains entirely database-driven.
    """
    __tablename__ = "external_identities"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String, nullable=False)       # e.g. 'google' | 'microsoft'
    external_id = Column(String, nullable=False)    # subject identifier from provider
    email = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)

    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_ext_identity_provider_id"),
    )


class ApiKey(Base):
    """Stub model for future user-managed API keys for scripts and automation.

    Not yet wired to any routes.  When API key support is added:
    - The full key is shown once on creation and never stored in plaintext.
    - key_hash stores a SHA-256 hash of the full key for constant-time lookup.
    - key_prefix (first 8 chars) is stored for display-only identification.
    """
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    key_prefix = Column(String, nullable=False)     # first 8 chars, shown for identification
    key_hash = Column(String, nullable=False)       # SHA-256 hash of the full key
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
