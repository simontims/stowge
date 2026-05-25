export interface LocationOption {
  id: string;
  name: string;
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
}
