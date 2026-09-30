import { useState, useEffect } from 'react';
import { notifications } from '@mantine/notifications';
import { profileClient } from '../api';
import { setHideBalancesState } from '../utils/format';
import { getActiveUserKey } from '../auth';
import { resolveUserTheme, saveUserThemeLocally } from '../utils/userTheme';

export type UserProfile = {
  theme: string;
  preferred_currency: string;
  monthly_expenses_minor: number;
  reserve_months: number;
  hide_balances: boolean;
  emergency_goal_minor: number;
  fire_expenses_minor: number;
  instrument_columns_json: string;
  show_fire_calculator: boolean;
  enable_btp_ranks: boolean;
  active_tab: string;
  ai_settings_json: string;
  draft_portfolios_json: string;
  user_description: string;
  starred_instruments: string[];
  starred_btps: string[];
};

const DEFAULTS: UserProfile = {
  theme: '',
  preferred_currency: '',
  monthly_expenses_minor: 0,
  reserve_months: 6,
  hide_balances: false,
  emergency_goal_minor: 1_000_000,  // €10,000
  fire_expenses_minor: 2_400_000,   // €24,000/yr
  instrument_columns_json: '',
  show_fire_calculator: false,
  enable_btp_ranks: false,
  active_tab: 'overview',
  ai_settings_json: '',
  draft_portfolios_json: '',
  user_description: '',
  starred_instruments: [],
  starred_btps: [],
};

export type ProfileSyncStatus = 'idle' | 'saving' | 'saved' | 'error';

let _profile: UserProfile = { ...DEFAULTS };
let _loaded = false;
let _syncStatus: ProfileSyncStatus = 'idle';
let _syncError = '';
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach(fn => fn());
}

export async function loadProfile(): Promise<void> {
  const userKey = getActiveUserKey();
  try {
    const res = await profileClient.getProfile({});
    const p = res.profile ?? {};
    const resolvedTheme = resolveUserTheme(p.theme, userKey);
    const themeStr = `${resolvedTheme.scheme}:${resolvedTheme.accent}`;
    _profile = {
      theme: p.theme || themeStr,
      preferred_currency: p.preferredCurrency ?? '',
      monthly_expenses_minor: Number(p.monthlyExpensesMinor ?? 0),
      reserve_months: Number(p.reserveMonths ?? 6) || 6,
      hide_balances: Boolean(p.hideBalances),
      emergency_goal_minor: Number(p.emergencyGoalMinor ?? 0) || 1_000_000,
      fire_expenses_minor: Number(p.fireExpensesMinor ?? 0) || 2_400_000,
      instrument_columns_json: p.instrumentColumnsJson ?? '',
      show_fire_calculator: Boolean(p.showFireCalculator),
      enable_btp_ranks: Boolean(p.enableBtpRanks),
      active_tab: p.activeTab ?? 'overview',
      ai_settings_json: p.aiSettingsJson || (typeof localStorage !== 'undefined' ? localStorage.getItem(`squirrel.aiSettings.${userKey}`) || localStorage.getItem('squirrel.aiSettings') || '' : ''),
      draft_portfolios_json: p.draftPortfoliosJson || (typeof localStorage !== 'undefined' ? localStorage.getItem(`squirrel.draftPortfolios.${userKey}`) || localStorage.getItem('squirrel.draftPortfolios') || '' : ''),
      user_description: p.userDescription ?? '',
      starred_instruments: p.starredInstruments ?? [],
      starred_btps: p.starredBtps ?? [],
    };
    saveUserThemeLocally(userKey, resolvedTheme.scheme, resolvedTheme.accent);
  } catch {
    const fallbackTheme = resolveUserTheme(null, userKey);
    // Fall back to localStorage values already set before auth
    _profile = {
      ..._profile,
      theme: `${fallbackTheme.scheme}:${fallbackTheme.accent}`,
      hide_balances: localStorage.getItem('squirrel.hideBalances') === 'true',
      emergency_goal_minor: Number(localStorage.getItem('squirrel.emergencyGoal.EUR') || 0) * 100 || 1_000_000,
      fire_expenses_minor: Number(localStorage.getItem('squirrel.fireExpenses.EUR') || 0) * 100 || 2_400_000,
      show_fire_calculator: localStorage.getItem('squirrel.showFireCalculator') === 'true',
      enable_btp_ranks: localStorage.getItem('squirrel.enableBtpRanks') === 'true',
      active_tab: localStorage.getItem('squirrel.activeTab') || 'overview',
      ai_settings_json: (typeof localStorage !== 'undefined' ? localStorage.getItem(`squirrel.aiSettings.${userKey}`) || localStorage.getItem('squirrel.aiSettings') || '' : ''),
      draft_portfolios_json: (typeof localStorage !== 'undefined' ? localStorage.getItem(`squirrel.draftPortfolios.${userKey}`) || localStorage.getItem('squirrel.draftPortfolios') || '' : ''),
    };
  }
  _loaded = true;
  _syncStatus = 'saved';
  localStorage.setItem('squirrel.hideBalances', String(_profile.hide_balances));
  localStorage.setItem('squirrel.activeTab', _profile.active_tab);
  if (_profile.ai_settings_json) localStorage.setItem(`squirrel.aiSettings.${userKey}`, _profile.ai_settings_json);
  if (_profile.draft_portfolios_json) localStorage.setItem(`squirrel.draftPortfolios.${userKey}`, _profile.draft_portfolios_json);
  setHideBalancesState(_profile.hide_balances);
  notify();
}

let _saveTimer: ReturnType<typeof setTimeout> | undefined;

export async function persistProfile(): Promise<void> {
  _syncStatus = 'saving';
  _syncError = '';
  notify();
  try {
    await profileClient.updateProfile({
      profile: {
        theme: _profile.theme,
        preferredCurrency: _profile.preferred_currency,
        monthlyExpensesMinor: BigInt(Math.round(_profile.monthly_expenses_minor)),
        reserveMonths: _profile.reserve_months,
        hideBalances: _profile.hide_balances,
        emergencyGoalMinor: BigInt(Math.round(_profile.emergency_goal_minor)),
        fireExpensesMinor: BigInt(Math.round(_profile.fire_expenses_minor)),
        instrumentColumnsJson: _profile.instrument_columns_json,
        showFireCalculator: _profile.show_fire_calculator,
        enableBtpRanks: _profile.enable_btp_ranks,
        activeTab: _profile.active_tab,
        aiSettingsJson: _profile.ai_settings_json,
        draftPortfoliosJson: _profile.draft_portfolios_json,
        userDescription: _profile.user_description,
        starredInstruments: _profile.starred_instruments,
        starredBtps: _profile.starred_btps,
      },
    });
    _syncStatus = 'saved';
    notify();
  } catch (cause) {
    _syncStatus = 'error';
    _syncError = cause instanceof Error ? cause.message : String(cause);
    notify();
    notifications.show({
      color: 'red',
      title: 'Profile was not saved',
      message: _syncError,
    });
  }
}

export async function flushProfile(): Promise<void> {
  if (!_saveTimer) return;
  clearTimeout(_saveTimer);
  _saveTimer = undefined;
  await persistProfile();
}

export function resetProfile(): void {
  clearTimeout(_saveTimer);
  _saveTimer = undefined;
  _profile = { ...DEFAULTS };
  _loaded = false;
  _syncStatus = 'idle';
  _syncError = '';
  localStorage.removeItem('squirrel.aiSettings');
  localStorage.removeItem('squirrel.draftPortfolios');
  setHideBalancesState(false);
  notify();
}

export function updateProfile(patch: Partial<UserProfile>): void {
  _profile = { ..._profile, ...patch };
  _syncStatus = 'saving';
  if (patch.show_fire_calculator !== undefined) {
    localStorage.setItem('squirrel.showFireCalculator', String(_profile.show_fire_calculator));
  }
  if (patch.enable_btp_ranks !== undefined) {
    localStorage.setItem('squirrel.enableBtpRanks', String(_profile.enable_btp_ranks));
  }
  if (patch.hide_balances !== undefined) {
    localStorage.setItem('squirrel.hideBalances', String(_profile.hide_balances));
    setHideBalancesState(_profile.hide_balances);
  }
  if (patch.active_tab !== undefined) localStorage.setItem('squirrel.activeTab', _profile.active_tab);
  if (patch.ai_settings_json !== undefined) localStorage.setItem('squirrel.aiSettings', _profile.ai_settings_json);
  if (patch.draft_portfolios_json !== undefined) localStorage.setItem('squirrel.draftPortfolios', _profile.draft_portfolios_json);
  notify();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = undefined;
    void persistProfile();
  }, 600);
}

export function getProfile(): UserProfile {
  return _profile;
}

export function isProfileLoaded(): boolean {
  return _loaded;
}

export function useProfile(): [UserProfile, (patch: Partial<UserProfile>) => void] {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender(n => n + 1);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);
  return [_profile, updateProfile];
}

export function useProfileSyncStatus(): { status: ProfileSyncStatus; error: string; retry: () => void } {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender(n => n + 1);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);
  return {
    status: _syncStatus,
    error: _syncError,
    retry: () => void persistProfile(),
  };
}

export function isInstrumentStarred(isin: string): boolean {
  return _profile.starred_instruments.includes(isin.toUpperCase());
}

export function isBtpStarred(isin: string): boolean {
  return _profile.starred_btps.includes(isin.toUpperCase());
}

export function setInstrumentStarredInProfile(isin: string, starred: boolean): void {
  const norm = isin.toUpperCase();
  const next = starred
    ? Array.from(new Set([..._profile.starred_instruments, norm]))
    : _profile.starred_instruments.filter(x => x !== norm);
  _profile = { ..._profile, starred_instruments: next };
  notify();
}

export function setBtpStarredInProfile(isin: string, starred: boolean): void {
  const norm = isin.toUpperCase();
  const next = starred
    ? Array.from(new Set([..._profile.starred_btps, norm]))
    : _profile.starred_btps.filter(x => x !== norm);
  _profile = { ..._profile, starred_btps: next };
  notify();
}
