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

export interface CollectionOption {
  id: string;
  name: string;
  ai_hint?: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  role: string;
  theme: string;
  preferred_add_collection_id: string | null;
  preferred_add_location_id: string | null;
  last_open_collection: string | null;
  collection_nav_order: string[];
  created_at: string | null;
  last_login_at: string | null;
  show_hierarchy_intro?: boolean;
}
