"""A database in an OLD (pre-tags) schema, for migration tests.

Two schemas, both generated from ``api/stowge/models.py`` at the given commit:

* ``LIVE_SCHEMA_SQL`` - 69d9ab6, the last release before the release 1 work (what a running install has).
  No ``last_seen_note`` / ``welcome_seen_version`` on users, so startup has to add those columns too.
* ``RELEASE1_SCHEMA_SQL`` - 1e2e394, release 1 (v0.11.0): the schema directly before tags.

Neither has ``tags``, ``item_tags``, ``ai_hints`` or the new ``users`` columns.
"""
import json
import sqlite3
import uuid

LIVE_SCHEMA_SQL = """
CREATE TABLE app_meta (
	"key" VARCHAR NOT NULL, 
	value TEXT NOT NULL, 
	PRIMARY KEY ("key")
);
CREATE TABLE collections (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	icon VARCHAR, 
	color VARCHAR, 
	description TEXT, 
	ai_hint TEXT, 
	item_count INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_collections_name ON collections (name);
CREATE TABLE image_settings (
	id VARCHAR NOT NULL, 
	store_original INTEGER NOT NULL, 
	output_format VARCHAR NOT NULL, 
	display_max_edge INTEGER NOT NULL, 
	display_quality INTEGER NOT NULL, 
	thumb_max_edge INTEGER NOT NULL, 
	thumb_quality INTEGER NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE TABLE llm_configs (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	provider VARCHAR NOT NULL, 
	model VARCHAR NOT NULL, 
	api_key VARCHAR NOT NULL, 
	api_base VARCHAR, 
	is_default INTEGER NOT NULL, 
	evidence_enabled INTEGER NOT NULL, 
	ai_max_edge INTEGER NOT NULL, 
	ai_quality INTEGER NOT NULL, 
	validated_at DATETIME, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE TABLE maintenance_schedules (
	task_key VARCHAR NOT NULL, 
	enabled INTEGER NOT NULL, 
	cron_expression VARCHAR NOT NULL, 
	next_run_at DATETIME, 
	last_run_at DATETIME, 
	last_duration_ms INTEGER, 
	last_status VARCHAR, 
	last_error TEXT, 
	backup_retention_enabled INTEGER NOT NULL, 
	backup_retention_days INTEGER NOT NULL, 
	backup_include_assets INTEGER NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (task_key)
);
CREATE TABLE sites (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_sites_name ON sites (name);
CREATE TABLE users (
	id VARCHAR NOT NULL, 
	username VARCHAR NOT NULL, 
	first_name VARCHAR NOT NULL, 
	last_name VARCHAR NOT NULL, 
	password_hash VARCHAR NOT NULL, 
	role VARCHAR NOT NULL, 
	theme VARCHAR NOT NULL, 
	preferred_add_collection_id VARCHAR, 
	preferred_add_location_id VARCHAR, 
	last_open_collection VARCHAR, 
	collection_nav_order TEXT, 
	shortcut_filters TEXT, 
	created_at DATETIME NOT NULL, 
	last_login_at DATETIME, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_users_username ON users (username);
CREATE TABLE api_keys (
	id VARCHAR NOT NULL, 
	user_id VARCHAR, 
	key_type VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	key_prefix VARCHAR NOT NULL, 
	key_hash VARCHAR NOT NULL, 
	scopes_json TEXT NOT NULL, 
	created_by_user_id VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_used_at DATETIME, 
	expires_at DATETIME, 
	revoked_at DATETIME, 
	revoked_by_user_id VARCHAR, 
	revoked_reason TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id), 
	FOREIGN KEY(revoked_by_user_id) REFERENCES users (id)
);
CREATE INDEX ix_api_keys_revoked_by_user_id ON api_keys (revoked_by_user_id);
CREATE UNIQUE INDEX ix_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX ix_api_keys_user_id ON api_keys (user_id);
CREATE INDEX ix_api_keys_created_by_user_id ON api_keys (created_by_user_id);
CREATE TABLE areas (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	site_id VARCHAR, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(site_id) REFERENCES sites (id)
);
CREATE UNIQUE INDEX ix_areas_name ON areas (name);
CREATE INDEX ix_areas_site_id ON areas (site_id);
CREATE TABLE external_identities (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	provider VARCHAR NOT NULL, 
	external_id VARCHAR NOT NULL, 
	email VARCHAR, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_ext_identity_provider_id UNIQUE (provider, external_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE INDEX ix_external_identities_user_id ON external_identities (user_id);
CREATE TABLE sessions (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	expires_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE INDEX ix_sessions_user_id ON sessions (user_id);
CREATE INDEX ix_sessions_expires_at ON sessions (expires_at);
CREATE TABLE locations (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	area_id VARCHAR, 
	icon VARCHAR, 
	color VARCHAR, 
	photo_path VARCHAR, 
	icon_path VARCHAR, 
	item_count INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(area_id) REFERENCES areas (id)
);
CREATE INDEX ix_locations_area_id ON locations (area_id);
CREATE UNIQUE INDEX ix_locations_name ON locations (name);
CREATE TABLE parts (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	collection VARCHAR, 
	status VARCHAR NOT NULL, 
	quantity INTEGER NOT NULL, 
	location_id VARCHAR, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	ai_primary JSON, 
	ai_alternatives JSON, 
	ai_chosen_index INTEGER, 
	is_deleted INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(location_id) REFERENCES locations (id)
);
CREATE INDEX ix_parts_collection ON parts (collection);
CREATE INDEX ix_parts_location_id ON parts (location_id);
CREATE TABLE images (
	id VARCHAR NOT NULL, 
	part_id VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	path_thumb VARCHAR NOT NULL, 
	path_display VARCHAR NOT NULL, 
	path_original VARCHAR, 
	mime VARCHAR NOT NULL, 
	width INTEGER, 
	height INTEGER, 
	is_primary INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(part_id) REFERENCES parts (id)
);
CREATE INDEX ix_images_part_id ON images (part_id);
CREATE TABLE item_contents (
	id VARCHAR NOT NULL, 
	item_id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	quantity INTEGER NOT NULL, 
	note TEXT, 
	sort_order INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(item_id) REFERENCES parts (id)
);
CREATE INDEX ix_item_contents_item_id ON item_contents (item_id);
"""

RELEASE1_SCHEMA_SQL = """
CREATE TABLE app_meta (
	"key" VARCHAR NOT NULL, 
	value TEXT NOT NULL, 
	PRIMARY KEY ("key")
);
CREATE TABLE collections (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	icon VARCHAR, 
	color VARCHAR, 
	description TEXT, 
	ai_hint TEXT, 
	item_count INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_collections_name ON collections (name);
CREATE TABLE image_settings (
	id VARCHAR NOT NULL, 
	store_original INTEGER NOT NULL, 
	output_format VARCHAR NOT NULL, 
	display_max_edge INTEGER NOT NULL, 
	display_quality INTEGER NOT NULL, 
	thumb_max_edge INTEGER NOT NULL, 
	thumb_quality INTEGER NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE TABLE llm_configs (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	provider VARCHAR NOT NULL, 
	model VARCHAR NOT NULL, 
	api_key VARCHAR NOT NULL, 
	api_base VARCHAR, 
	is_default INTEGER NOT NULL, 
	evidence_enabled INTEGER NOT NULL, 
	ai_max_edge INTEGER NOT NULL, 
	ai_quality INTEGER NOT NULL, 
	validated_at DATETIME, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE TABLE maintenance_schedules (
	task_key VARCHAR NOT NULL, 
	enabled INTEGER NOT NULL, 
	cron_expression VARCHAR NOT NULL, 
	next_run_at DATETIME, 
	last_run_at DATETIME, 
	last_duration_ms INTEGER, 
	last_status VARCHAR, 
	last_error TEXT, 
	backup_retention_enabled INTEGER NOT NULL, 
	backup_retention_days INTEGER NOT NULL, 
	backup_include_assets INTEGER NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (task_key)
);
CREATE TABLE sites (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_sites_name ON sites (name);
CREATE TABLE users (
	id VARCHAR NOT NULL, 
	username VARCHAR NOT NULL, 
	first_name VARCHAR NOT NULL, 
	last_name VARCHAR NOT NULL, 
	password_hash VARCHAR NOT NULL, 
	role VARCHAR NOT NULL, 
	theme VARCHAR NOT NULL, 
	preferred_add_collection_id VARCHAR, 
	preferred_add_location_id VARCHAR, 
	last_open_collection VARCHAR, 
	collection_nav_order TEXT, 
	shortcut_filters TEXT, 
	last_seen_note INTEGER NOT NULL, 
	welcome_seen_version INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_login_at DATETIME, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_users_username ON users (username);
CREATE TABLE api_keys (
	id VARCHAR NOT NULL, 
	user_id VARCHAR, 
	key_type VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	key_prefix VARCHAR NOT NULL, 
	key_hash VARCHAR NOT NULL, 
	scopes_json TEXT NOT NULL, 
	created_by_user_id VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_used_at DATETIME, 
	expires_at DATETIME, 
	revoked_at DATETIME, 
	revoked_by_user_id VARCHAR, 
	revoked_reason TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id), 
	FOREIGN KEY(revoked_by_user_id) REFERENCES users (id)
);
CREATE UNIQUE INDEX ix_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX ix_api_keys_user_id ON api_keys (user_id);
CREATE INDEX ix_api_keys_created_by_user_id ON api_keys (created_by_user_id);
CREATE INDEX ix_api_keys_revoked_by_user_id ON api_keys (revoked_by_user_id);
CREATE TABLE areas (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	site_id VARCHAR, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(site_id) REFERENCES sites (id)
);
CREATE UNIQUE INDEX ix_areas_name ON areas (name);
CREATE INDEX ix_areas_site_id ON areas (site_id);
CREATE TABLE external_identities (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	provider VARCHAR NOT NULL, 
	external_id VARCHAR NOT NULL, 
	email VARCHAR, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_ext_identity_provider_id UNIQUE (provider, external_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE INDEX ix_external_identities_user_id ON external_identities (user_id);
CREATE TABLE sessions (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	expires_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE INDEX ix_sessions_expires_at ON sessions (expires_at);
CREATE INDEX ix_sessions_user_id ON sessions (user_id);
CREATE TABLE locations (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	area_id VARCHAR, 
	icon VARCHAR, 
	color VARCHAR, 
	photo_path VARCHAR, 
	icon_path VARCHAR, 
	item_count INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(area_id) REFERENCES areas (id)
);
CREATE INDEX ix_locations_area_id ON locations (area_id);
CREATE UNIQUE INDEX ix_locations_name ON locations (name);
CREATE TABLE parts (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	collection VARCHAR, 
	status VARCHAR NOT NULL, 
	quantity INTEGER NOT NULL, 
	location_id VARCHAR, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	ai_primary JSON, 
	ai_alternatives JSON, 
	ai_chosen_index INTEGER, 
	is_deleted INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(location_id) REFERENCES locations (id)
);
CREATE INDEX ix_parts_collection ON parts (collection);
CREATE INDEX ix_parts_location_id ON parts (location_id);
CREATE TABLE images (
	id VARCHAR NOT NULL, 
	part_id VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	path_thumb VARCHAR NOT NULL, 
	path_display VARCHAR NOT NULL, 
	path_original VARCHAR, 
	mime VARCHAR NOT NULL, 
	width INTEGER, 
	height INTEGER, 
	is_primary INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(part_id) REFERENCES parts (id)
);
CREATE INDEX ix_images_part_id ON images (part_id);
CREATE TABLE item_contents (
	id VARCHAR NOT NULL, 
	item_id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	quantity INTEGER NOT NULL, 
	note TEXT, 
	sort_order INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(item_id) REFERENCES parts (id)
);
CREATE INDEX ix_item_contents_item_id ON item_contents (item_id);
"""

SCHEMAS = {"live": LIVE_SCHEMA_SQL, "release1": RELEASE1_SCHEMA_SQL}


def _ts(n: int) -> str:
    return f"2026-01-{n:02d} 10:00:00.000000"


class OldDb:
    """Tiny writer on top of an old-schema SQLite file."""

    def __init__(self, path, schema="live"):
        self.path = str(path)
        self.schema = schema
        self.con = sqlite3.connect(self.path)
        self.con.executescript(SCHEMAS[schema])
        self._n = 0

    def _next(self) -> int:
        self._n += 1
        return self._n

    def collection(self, name, *, ai_hint=None, icon=None, color=None, description=None, cid=None, created=None):
        cid = cid or str(uuid.uuid4())
        n = created if created is not None else self._next()
        self.con.execute(
            "INSERT INTO collections (id, name, icon, color, description, ai_hint, item_count, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
            (cid, name, icon, color, description, ai_hint, _ts(n), _ts(n)),
        )
        return cid

    def item(self, name, *, collection=None, deleted=0):
        iid = str(uuid.uuid4())
        self.con.execute(
            "INSERT INTO parts (id, name, collection, status, quantity, is_deleted, created_at, updated_at) "
            "VALUES (?, ?, ?, 'draft', 1, ?, ?, ?)",
            (iid, name, collection, deleted, _ts(5), _ts(5)),
        )
        return iid

    def user(self, username, *, nav_order=None, filters=None, preferred_collection=None, last_open=None):
        uid = str(uuid.uuid4())
        extra_cols, extra_vals = ("", "")
        if self.schema == "release1":
            extra_cols, extra_vals = ("last_seen_note, welcome_seen_version, ", "0, 0, ")
        self.con.execute(
            "INSERT INTO users (id, username, first_name, last_name, password_hash, role, theme, "
            "preferred_add_collection_id, last_open_collection, collection_nav_order, shortcut_filters, "
            f"{extra_cols}created_at) "
            f"VALUES (?, ?, '', '', 'x', 'user', 'dark', ?, ?, ?, ?, {extra_vals}?)",
            (uid, username, preferred_collection, last_open,
             json.dumps(nav_order) if nav_order is not None else None,
             json.dumps(filters) if filters is not None else None, _ts(1)),
        )
        return uid

    def api_key(self, uid, scopes, name="k"):
        kid = str(uuid.uuid4())
        self.con.execute(
            "INSERT INTO api_keys (id, user_id, key_type, name, key_prefix, key_hash, scopes_json, created_by_user_id, created_at) "
            "VALUES (?, ?, 'user', ?, 'stgk_abc', ?, ?, ?, ?)",
            (kid, uid, name, kid, json.dumps(scopes), uid, _ts(1)),
        )
        return kid

    def commit(self):
        self.con.commit()

    def close(self):
        self.con.commit()
        self.con.close()
