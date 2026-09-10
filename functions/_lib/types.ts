export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  APP_ORIGIN?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  google_sub: string | null;
  facebook_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export const SESSION_COOKIE = "umrt_session";
export const OAUTH_STATE_COOKIE = "umrt_oauth_state";
export const SESSION_DAYS = 30;
