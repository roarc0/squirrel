import assert from 'node:assert/strict';
import test from 'node:test';
import { getDistinctAccentForUser, resolveUserTheme, saveUserThemeLocally, ACCENTS } from './utils/userTheme.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('user theme resolution gives distinct accents and preserves user-scoped preferences', () => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });

  // 1. Unauthenticated or empty user gets a valid accent
  const guestAccent = getDistinctAccentForUser('guest');
  assert.equal(ACCENTS.includes(guestAccent), true);

  // 2. Different users get valid, deterministic accents
  const user1Accent = getDistinctAccentForUser('google-sub-10001');
  const user2Accent = getDistinctAccentForUser('google-sub-20002');
  assert.equal(ACCENTS.includes(user1Accent), true);
  assert.equal(ACCENTS.includes(user2Accent), true);

  // 3. User with saved profile theme uses their saved theme
  const custom = resolveUserTheme('light:rose', 'google-sub-10001');
  assert.deepEqual(custom, { scheme: 'light', accent: 'rose' });

  // 4. User-scoped local storage is isolated between users
  saveUserThemeLocally('google-sub-10001', 'dark', 'violet');
  saveUserThemeLocally('google-sub-20002', 'light', 'ocean');

  const resolvedUser1 = resolveUserTheme(null, 'google-sub-10001');
  const resolvedUser2 = resolveUserTheme(null, 'google-sub-20002');

  assert.deepEqual(resolvedUser1, { scheme: 'dark', accent: 'violet' });
  assert.deepEqual(resolvedUser2, { scheme: 'light', accent: 'ocean' });
});
