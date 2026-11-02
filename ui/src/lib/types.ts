export interface LocationOption {
  id: string;
  name: string;
  area_id?: string | null;
  area_name?: string | null;
  site_id?: string | null;
  site_name?: string | null;
  icon?: string | null;
  color?: string | null;
  photo_url?: string | null;
  icon_url?: string | null;
}

export interface SiteOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface AreaOption {
  id: string;
  name: string;
  site_id?: string | null;
  site_name?: string | null;
  description?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  item_count: number;
}

/** The slim tag shape carried on every item. */
export interface ItemTag {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface AiHint {
  id: string;
  name: string;
  text: string;
  is_default: boolean;
}

export interface TagsMigrationInfo {
  collections_converted: number;
  filters_skipped: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  role: string;
  theme: string;
  /** null = the Default hint. */
  preferred_add_hint_id: string | null;
  preferred_add_tag_ids: string[];
  preferred_add_location_id: string | null;
  /** Name of the tag last opened on the Items page. */
  last_open_tag: string | null;
  shortcut_filters: Array<{
    id: string;
    name: string;
    query: string;
    tag_id: string | null;
    statuses: string[];
    status: string | null;
    site_id: string | null;
    area_id: string | null;
    location_id: string | null;
    quantity_min: number | null;
    quantity_max: number | null;
    pinned: boolean;
    icon: string | null;
    color: string | null;
  }>;
  whats_new: WhatsNewState;
  created_at: string | null;
  last_login_at: string | null;
  show_hierarchy_intro?: boolean;
}

export type WhatsNewSeverity = "interrupt" | "dot";

export interface WhatsNewNote {
  id: string;
  /** Increasing order number; the user's cursor is the highest seq they have dealt with. */
  seq: number;
  /** interrupt = shown once as a card at login; dot = only lights the unread dot. */
  severity: WhatsNewSeverity;
  /** Release the change shipped in, e.g. "0.11.0". The What's New page groups by it. */
  version: string;
  title: string;
  summary: string;
  date: string | null;
  supersedes: string[];
}

export interface WhatsNewHistoryNote extends WhatsNewNote {
  unread: boolean;
}

export interface WhatsNewState {
  latest_seq: number;
  /** Unseen notes, oldest first, with anything a newer unseen note replaces already removed. */
  unseen: WhatsNewNote[];
  unseen_interrupt_count: number;
  /** True until the user has seen the current welcome flow. */
  welcome_pending: boolean;
  /** What the collections-to-tags migration did for this database. */
  tags_migration?: TagsMigrationInfo;
}
