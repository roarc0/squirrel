export type ThemeAccent = 'teal' | 'amber' | 'ocean' | 'violet' | 'rose';
export type ThemeScheme = 'light' | 'dark';

export const ACCENT_HEX: Record<ThemeAccent, string> = {
  teal: '#12b886',
  amber: '#f97316',
  ocean: '#228be6',
  violet: '#7950f2',
  rose: '#e64980',
};

export const ACCENT_LABELS: Record<ThemeAccent, string> = {
  teal: 'Teal',
  amber: 'Orange',
  ocean: 'Ocean',
  violet: 'Violet',
  rose: 'Rose',
};

export const ACCENTS = Object.keys(ACCENT_HEX) as ThemeAccent[];

/**
 * Deterministically generates a distinct accent color for a user if they have not chosen one.
 * Maps user IDs to different vivid accents: amber (orange), ocean (blue), violet (purple), rose (pink), teal (green).
 */
export function getDistinctAccentForUser(userKey?: string | null): ThemeAccent {
  if (!userKey || userKey === 'guest') return 'teal';
  let hash = 0;
  for (let i = 0; i < userKey.length; i++) {
    hash = (hash * 31 + userKey.charCodeAt(i)) >>> 0;
  }
  return ACCENTS[hash % ACCENTS.length];
}

/**
 * Resolves the theme scheme and accent for a given user.
 * Priority:
 * 1. Saved theme in profile string ("scheme:accent")
 * 2. User-scoped localStorage cache ("squirrel.scheme.<userId>", "squirrel.accent.<userId>")
 * 3. Default scheme ('dark') + distinct default accent based on the user's ID
 */
export function resolveUserTheme(
  savedTheme?: string | null,
  userKey?: string | null,
): { scheme: ThemeScheme; accent: ThemeAccent } {
  if (savedTheme) {
    const [s, a] = savedTheme.split(':');
    if ((s === 'light' || s === 'dark') && a in ACCENT_HEX) {
      return { scheme: s as ThemeScheme, accent: a as ThemeAccent };
    }
  }

  const key = userKey || 'guest';
  if (typeof localStorage !== 'undefined') {
    const scopedScheme = localStorage.getItem(`squirrel.scheme.${key}`);
    const scopedAccent = localStorage.getItem(`squirrel.accent.${key}`) as ThemeAccent | null;
    if ((scopedScheme === 'light' || scopedScheme === 'dark') && scopedAccent && scopedAccent in ACCENT_HEX) {
      return { scheme: scopedScheme as ThemeScheme, accent: scopedAccent };
    }
  }

  return {
    scheme: 'dark',
    accent: getDistinctAccentForUser(userKey),
  };
}

/**
 * Saves user theme preferences to user-scoped localStorage and global fallback keys.
 */
export function saveUserThemeLocally(userKey: string, scheme: ThemeScheme, accent: ThemeAccent): void {
  if (typeof localStorage === 'undefined') return;
  const key = userKey || 'guest';
  try {
    localStorage.setItem(`squirrel.scheme.${key}`, scheme);
    localStorage.setItem(`squirrel.accent.${key}`, accent);
    // Maintain global keys for splash screen / SSR bootstrap
    localStorage.setItem('squirrel.scheme', scheme);
    localStorage.setItem('squirrel.accent', accent);
  } catch {
    /* ignore storage quota/access errors */
  }
}
