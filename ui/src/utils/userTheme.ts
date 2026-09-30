import { createTheme, type MantineColorsTuple, type CSSVariablesResolver } from '@mantine/core';

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

export const ACCENT_PALETTES: Record<ThemeAccent, MantineColorsTuple> = {
  teal: [
    '#e6fcf5', '#c3fae8', '#96f2d7', '#63e6be', '#38d9a9',
    '#20c997', '#12b886', '#0ca678', '#099268', '#087f5b',
  ],
  amber: [
    '#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c',
    '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12',
  ],
  ocean: [
    '#e7f5ff', '#d0ebff', '#a5d8ff', '#74c0fc', '#4dabf7',
    '#339af0', '#228be6', '#1c7ed6', '#1971c2', '#1864ab',
  ],
  violet: [
    '#f3f0ff', '#e5dbff', '#d0bfff', '#b197fc', '#9775fa',
    '#845ef7', '#7950f2', '#6741d9', '#5f3dc4', '#5c37b8',
  ],
  rose: [
    '#fff0f6', '#ffdeeb', '#fcc2d7', '#faa2c1', '#f783ac',
    '#f06595', '#e64980', '#d6336c', '#c2255c', '#a61e4d',
  ],
};

export function buildMantineTheme(accent: ThemeAccent) {
  return createTheme({
    primaryColor: accent,
    colors: ACCENT_PALETTES,
    defaultRadius: 'md',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    headings: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  });
}

export const themeCssResolver: CSSVariablesResolver = (theme) => {
  const p = (theme.colors[theme.primaryColor] || ACCENT_PALETTES.teal) as unknown as string[];
  return {
    variables: {
      '--mantine-color-teal-0': p[0],
      '--mantine-color-teal-1': p[1],
      '--mantine-color-teal-2': p[2],
      '--mantine-color-teal-3': p[3],
      '--mantine-color-teal-4': p[4],
      '--mantine-color-teal-5': p[5],
      '--mantine-color-teal-6': p[6],
      '--mantine-color-teal-7': p[7],
      '--mantine-color-teal-8': p[8],
      '--mantine-color-teal-9': p[9],
      '--mantine-color-teal-filled': p[6],
      '--mantine-color-teal-filled-hover': p[7],
      '--mantine-color-teal-light': `color-mix(in srgb, ${p[5]} 15%, transparent)`,
      '--mantine-color-teal-light-hover': `color-mix(in srgb, ${p[5]} 20%, transparent)`,
      '--mantine-color-teal-light-color': p[6],
      '--mantine-color-teal-outline': p[6],
      '--mantine-color-teal-outline-hover': `color-mix(in srgb, ${p[5]} 8%, transparent)`,
    },
    light: {},
    dark: {},
  };
};

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
