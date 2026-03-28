import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey, JSON
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
