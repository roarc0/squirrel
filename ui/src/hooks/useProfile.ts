import { useState, useEffect } from 'react';
import { profileClient } from '../api';
import { setHideBalancesState } from '../utils/format';

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
};

let _profile: UserProfile = { ...DEFAULTS };
let _loaded = false;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach(fn => fn());
}

export async function loadProfile(): Promise<void> {
  try {
    const res = await profileClient.getProfile({});
    const p = res.profile ?? {};
    _profile = {
      theme: p.theme ?? '',
      preferred_currency: p.preferredCurrency ?? '',
      monthly_expenses_minor: Number(p.monthlyExpensesMinor ?? 0),
      reserve_months: Number(p.reserveMonths ?? 6) || 6,
      hide_balances: Boolean(p.hideBalances),
      emergency_goal_minor: Number(p.emergencyGoalMinor ?? 0) || 1_000_000,
      fire_expenses_minor: Number(p.fireExpensesMinor ?? 0) || 2_400_000,
      instrument_columns_json: p.instrumentColumnsJson ?? '',
      show_fire_calculator: Boolean(p.showFireCalculator),
      enable_btp_ranks: Boolean(p.enableBtpRanks),
    };
  } catch {
    // Fall back to localStorage values already set before auth
    _profile = {
      ..._profile,
      hide_balances: localStorage.getItem('squirrel.hideBalances') === 'true',
      emergency_goal_minor: Number(localStorage.getItem('squirrel.emergencyGoal.EUR') || 0) * 100 || 1_000_000,
      fire_expenses_minor: Number(localStorage.getItem('squirrel.fireExpenses.EUR') || 0) * 100 || 2_400_000,
      show_fire_calculator: localStorage.getItem('squirrel.showFireCalculator') === 'true',
      enable_btp_ranks: localStorage.getItem('squirrel.enableBtpRanks') === 'true',
    };
  }
  _loaded = true;
  localStorage.setItem('squirrel.hideBalances', String(_profile.hide_balances));
  setHideBalancesState(_profile.hide_balances);
  notify();
}

let _saveTimer: ReturnType<typeof setTimeout> | undefined;

export function updateProfile(patch: Partial<UserProfile>): void {
  _profile = { ..._profile, ...patch };
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
  notify();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    profileClient.updateProfile({
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
      },
    }).catch(() => { /* best-effort */ });
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
