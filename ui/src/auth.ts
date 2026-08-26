const TOKEN_KEY = 'squirrel.auth.token';

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

export type AuthUser = {
  google_id: string;
  email: string;
  is_admin: boolean;
  picture?: string;
};

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
