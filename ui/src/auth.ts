const TOKEN_KEY = 'squirrel.auth.token';
const SESSIONS_KEY = 'squirrel.auth.sessions';

export type AuthUser = {
  google_id: string;
  email: string;
  is_admin: boolean;
  picture?: string;
};

type AuthSession = AuthUser & { token: string };

function readSessions(): AuthSession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((session): session is AuthSession =>
      typeof session === 'object' && session !== null
      && typeof session.google_id === 'string'
      && typeof session.email === 'string'
      && typeof session.token === 'string',
    );
  } catch {
    return [];
  }
}

function writeSessions(sessions: AuthSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch { /* optional */ }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch { /* optional */ }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* optional */ }
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export function getActiveSession(): AuthSession | null {
  const token = getToken();
  if (!token) return null;
  return readSessions().find(item => item.token === token) || null;
}

export function getActiveUserKey(): string {
  const session = getActiveSession();
  return session ? session.google_id : 'guest';
}

export function listSignedInUsers(): AuthUser[] {
  return readSessions().map(({ token: _, ...user }) => user);
}

export function rememberSession(user: AuthUser): AuthUser[] {
  const token = getToken();
  if (!token) return listSignedInUsers();
  writeSessions([{ ...user, token }, ...readSessions().filter(session => session.google_id !== user.google_id)]);
  return listSignedInUsers();
}

export function activateSession(googleID: string): boolean {
  const session = readSessions().find(item => item.google_id === googleID);
  if (!session) return false;
  setToken(session.token);
  return true;
}

export function removeSession(googleID: string): AuthUser[] {
  const sessions = readSessions();
  const removed = sessions.find(session => session.google_id === googleID);
  const remaining = sessions.filter(session => session.google_id !== googleID);
  writeSessions(remaining);
  if (removed?.token === getToken()) {
    if (remaining[0]) setToken(remaining[0].token);
    else clearToken();
  }
  return remaining.map(({ token: _, ...user }) => user);
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const resp = await fetch('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

// captureTokenFromURL reads the OAuth token fragment, stores it, and removes it from the URL bar.
export function captureTokenFromURL(): boolean {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (!token) return false;
  setToken(token);
  params.delete('token');
  const newHash = params.toString();
  const newURL = `${window.location.pathname}${window.location.search}${newHash ? `#${newHash}` : ''}`;
  window.history.replaceState({}, '', newURL);
  return true;
}

export function isUnauthenticatedError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes('unauthenticated') || msg.includes('[unauthenticated]');
}
