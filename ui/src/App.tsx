import React, { useCallback, useEffect, useState } from 'react';
import {
  IconChartPie,
  IconBuildingBank,
  IconBriefcase,
  IconFlask,
  IconSearch,
  IconActivity,
  IconRobot,
  IconExternalLink,
  IconArrowsExchange,
  IconRefresh,
  IconPencil,
  IconTrash,
  IconStar,
  IconStarFilled,
  IconUser,
  IconEye,
  IconEyeOff,
  IconPalette,
  IconSettings,
  IconTrendingUp,
  IconTrendingDown,
  IconFileCertificate,
  IconBell,
  IconBellRinging,
  IconCheck,
  IconSun,
  IconMoon,
  IconGlobe,
} from '@tabler/icons-react';
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Burger,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Drawer,
  Grid,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Pagination,
  Paper,
  Popover,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Menu,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { api, instrumentClient, type Account, type Diagnostic, type Instrument, type InstrumentAlternative, type InstrumentType, type Holding, type RankedInstrument, type ReferenceRate, type Snapshot, type Summary, type TaxRate } from './api';
import { Chip, chipColor } from './components/Chip';
import { DataTable, TableAction, TableActions, type DataColumn, type SortDirection } from './components/DataTable';
import { CompareModal } from './components/CompareModal';
import { AppSkeleton } from './components/AppSkeleton';
import { SettingsView } from './views/SettingsView';
import { UpdateSituationModal } from './components/UpdateSituationModal';
import { OverviewView } from './views/OverviewView';
import { AccountsView } from './views/AccountsView';
import { InvestmentsView } from './views/InvestmentsView';
import { InstrumentFinderView } from './views/InstrumentFinderView';
import { InstrumentDetailView } from './views/InstrumentDetailView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { AIConsultantView } from './views/AIConsultantView';
import { DraftPortfoliosView } from './views/DraftPortfoliosView';
import { BtpRankView } from './views/BtpRankView';
import { MarketContextView } from './views/MarketContextView';
import { QuickSearchModal } from './components/QuickSearchModal';
import { chartGeometry, matchesExactFilters, pageBounds, performanceMood } from './utils/visual';

type Data = { summary: Summary; accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; instruments: Instrument[]; holdings: Holding[]; snapshots: Snapshot[] };
type Numeric = string | number;
const normalizeTab = (tab: string | null) => tab === 'holdings' || tab === 'geo' ? 'investments' : tab === 'advisor' ? 'consultant' : tab === 'rates' ? 'market' : tab;
import { money, investedMoney, setHideBalancesState } from './utils/format';
import { activateSession, captureTokenFromURL, clearToken, fetchMe, isUnauthenticatedError, listSignedInUsers, rememberSession, removeSession, type AuthUser } from './auth';
import { LoginView } from './views/LoginView';
import { flushProfile, loadProfile, resetProfile, updateProfile, useProfile } from './hooks/useProfile';
import { useContinuousRefresh } from './hooks/useContinuousRefresh';
import { handleLinkClick } from './utils/navigation';
import { Sidebar, type ThemeAccent, type ThemeScheme, ACCENT_HEX } from './components/Sidebar';
import { resolveUserTheme, saveUserThemeLocally } from './utils/userTheme';

const TEAL_VAR_KEYS = [
  '--mantine-color-teal-0', '--mantine-color-teal-1', '--mantine-color-teal-2',
  '--mantine-color-teal-3', '--mantine-color-teal-4', '--mantine-color-teal-5',
  '--mantine-color-teal-6', '--mantine-color-teal-7', '--mantine-color-teal-8', '--mantine-color-teal-9',
  '--mantine-color-teal-filled', '--mantine-color-teal-filled-hover',
  '--mantine-color-teal-light', '--mantine-color-teal-light-hover', '--mantine-color-teal-light-color',
  '--mantine-color-teal-outline', '--mantine-color-teal-outline-hover',
];

const ACCENT_VARS: Record<ThemeAccent, Record<string, string>> = {
  teal: {},
  amber: {
    '--mantine-color-teal-0': '#fff7ed', '--mantine-color-teal-1': '#ffedd5', '--mantine-color-teal-2': '#fed7aa',
    '--mantine-color-teal-3': '#fdba74', '--mantine-color-teal-4': '#fb923c', '--mantine-color-teal-5': '#f97316',
    '--mantine-color-teal-6': '#ea580c', '--mantine-color-teal-7': '#c2410c', '--mantine-color-teal-8': '#9a3412', '--mantine-color-teal-9': '#7c2d12',
    '--mantine-color-teal-filled': '#f97316', '--mantine-color-teal-filled-hover': '#ea580c',
    '--mantine-color-teal-light': 'rgba(249,115,22,0.15)', '--mantine-color-teal-light-hover': 'rgba(249,115,22,0.20)',
    '--mantine-color-teal-light-color': '#ea580c', '--mantine-color-teal-outline': '#f97316', '--mantine-color-teal-outline-hover': 'rgba(249,115,22,0.08)',
  },
  ocean: {
    '--mantine-color-teal-0': '#e7f5ff', '--mantine-color-teal-1': '#d0ebff', '--mantine-color-teal-2': '#a5d8ff',
    '--mantine-color-teal-3': '#74c0fc', '--mantine-color-teal-4': '#4dabf7', '--mantine-color-teal-5': '#339af0',
    '--mantine-color-teal-6': '#228be6', '--mantine-color-teal-7': '#1c7ed6', '--mantine-color-teal-8': '#1971c2', '--mantine-color-teal-9': '#1864ab',
    '--mantine-color-teal-filled': '#228be6', '--mantine-color-teal-filled-hover': '#1c7ed6',
    '--mantine-color-teal-light': 'rgba(34,139,230,0.12)', '--mantine-color-teal-light-hover': 'rgba(34,139,230,0.15)',
    '--mantine-color-teal-light-color': '#1c7ed6', '--mantine-color-teal-outline': '#228be6', '--mantine-color-teal-outline-hover': 'rgba(34,139,230,0.05)',
  },
  violet: {
    '--mantine-color-teal-0': '#f3f0ff', '--mantine-color-teal-1': '#e5dbff', '--mantine-color-teal-2': '#d0bfff',
    '--mantine-color-teal-3': '#b197fc', '--mantine-color-teal-4': '#9775fa', '--mantine-color-teal-5': '#845ef7',
    '--mantine-color-teal-6': '#7950f2', '--mantine-color-teal-7': '#6741d9', '--mantine-color-teal-8': '#5f3dc4', '--mantine-color-teal-9': '#5c37b8',
    '--mantine-color-teal-filled': '#7950f2', '--mantine-color-teal-filled-hover': '#6741d9',
    '--mantine-color-teal-light': 'rgba(121,80,242,0.15)', '--mantine-color-teal-light-hover': 'rgba(121,80,242,0.18)',
    '--mantine-color-teal-light-color': '#9775fa', '--mantine-color-teal-outline': '#7950f2', '--mantine-color-teal-outline-hover': 'rgba(121,80,242,0.07)',
  },
  rose: {
    '--mantine-color-teal-0': '#fff0f6', '--mantine-color-teal-1': '#ffdeeb', '--mantine-color-teal-2': '#fcc2d7',
    '--mantine-color-teal-3': '#faa2c1', '--mantine-color-teal-4': '#f783ac', '--mantine-color-teal-5': '#f06595',
    '--mantine-color-teal-6': '#e64980', '--mantine-color-teal-7': '#d6336c', '--mantine-color-teal-8': '#c2255c', '--mantine-color-teal-9': '#a61e4d',
    '--mantine-color-teal-filled': '#e64980', '--mantine-color-teal-filled-hover': '#d6336c',
    '--mantine-color-teal-light': 'rgba(230,73,128,0.15)', '--mantine-color-teal-light-hover': 'rgba(230,73,128,0.18)',
    '--mantine-color-teal-light-color': '#f06595', '--mantine-color-teal-outline': '#e64980', '--mantine-color-teal-outline-hover': 'rgba(230,73,128,0.07)',
  },
};

function applyAccentVars(a: ThemeAccent) {
  TEAL_VAR_KEYS.forEach(k => document.documentElement.style.removeProperty(k));
  Object.entries(ACCENT_VARS[a]).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}

import { SquirrelIcon, SquirrelBrandLogo } from './components/SquirrelLogo';
import { useBackendRows } from './hooks/useBackendRows';
import { PerformanceResult } from './components/PerformanceResult';
import { AllocationBar } from './components/AllocationBar';

export { SquirrelIcon, SquirrelBrandLogo } from './components/SquirrelLogo';
export { useBackendRows } from './hooks/useBackendRows';
export { PerformanceResult } from './components/PerformanceResult';
export { AllocationBar } from './components/AllocationBar';

export default function App() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [signedInUsers, setSignedInUsers] = useState<AuthUser[]>(listSignedInUsers);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    captureTokenFromURL();
    try {
      const [summary, accounts, rates, taxRates, instruments, holdings, snapshots, user] = await Promise.all([
        api<Summary>('/api/summary'),
        api<Account[]>('/api/accounts'),
        api<ReferenceRate[]>('/api/reference-rates'),
        api<TaxRate[]>('/api/tax-rates'),
        api<Instrument[]>('/api/instruments'),
        api<Holding[]>('/api/holdings'),
        api<Snapshot[]>('/api/snapshots'),
        fetchMe(),
        loadProfile(),
      ]);
      setData({ summary, accounts: accounts ?? [], rates: rates ?? [], taxRates: taxRates ?? [], instruments: instruments ?? [], holdings: holdings ?? [], snapshots: snapshots ?? [] });
      setNeedsLogin(false);
      setError('');
      setCurrentUser(user);
      if (user) setSignedInUsers(rememberSession(user));
    } catch (cause) {
      if (isUnauthenticatedError(cause)) {
        setNeedsLogin(true);
        return;
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      notifications.show({
        color: 'red',
        title: 'Connection Error',
        message,
      });
    }
  }, []);
  useEffect(() => void load(), [load]);

  const switchAccount = async (googleID: string) => {
    if (googleID === currentUser?.google_id) return;
    await flushProfile();
    if (!activateSession(googleID)) return;
    resetProfile();
    setCurrentUser(null);
    setData(undefined);
    setMobileNavOpened(false);
    await load();
  };

  const addAccount = async () => {
    await flushProfile();
    window.location.assign('/auth/login/google?select=1');
  };

  const signOut = async () => {
    await flushProfile();
    const remaining = currentUser ? removeSession(currentUser.google_id) : [];
    if (!currentUser) clearToken();
    resetProfile();
    setSignedInUsers(remaining);
    setCurrentUser(null);
    setData(undefined);
    setMobileNavOpened(false);
    if (remaining.length > 0) await load();
    else setNeedsLogin(true);
  };

  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [quickSearchOpened, setQuickSearchOpened] = useState(false);
  const [mobileNavOpened, setMobileNavOpened] = useState(false);
  const { tick: refreshTick, toggle: handleToggleRefresh } = useContinuousRefresh();
  useEffect(() => {
    if (refreshTick?.phase !== 'waiting' || refreshTick.hasError) return;
    let active = true;
    api<Instrument[]>('/api/instruments').then(instruments => {
      if (active) setData(current => current ? { ...current, instruments: instruments ?? [] } : current);
    }).catch(() => {});
    return () => { active = false; };
  }, [refreshTick]);
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('squirrel.sidebarCollapsed') === 'true';
  });

  const handleToggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('squirrel.sidebarCollapsed', String(next));
      return next;
    });
  };

  const VALID_TABS = ['overview', 'accounts', 'investments', 'drafts', 'instruments', 'market', 'diagnostics', 'consultant', 'btp', 'settings'];

  type RouteState = {
    section: string;
    subtab?: string;
  };

  const parseRoute = (path = window.location.pathname, search = window.location.search): RouteState => {
    const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
    const rawSection = segments[0] || '';
    const rawSubsection = segments[1] || '';

    // Backward compatibility alias redirects:
    if (rawSection === 'diagnostics') {
      return { section: 'overview', subtab: 'diagnostics' };
    }
    if (rawSection === 'drafts') {
      return { section: 'investments', subtab: 'sandbox' };
    }
    if (rawSection === 'holdings') {
      return { section: 'investments', subtab: 'holdings' };
    }

    const normSection = normalizeTab(rawSection);
    if (normSection && VALID_TABS.includes(normSection)) {
      return { section: normSection, subtab: rawSubsection || undefined };
    }

    const params = new URLSearchParams(search);
    const rawTab = params.get('tab');
    const urlTab = normalizeTab(rawTab);
    if (urlTab && VALID_TABS.includes(urlTab)) {
      return { section: urlTab, subtab: params.get('subtab') || undefined };
    }
    if (params.has('similarity')) {
      return { section: 'instruments' };
    }

    try {
      const saved = localStorage.getItem('squirrel.activeTab');
      const normSaved = normalizeTab(saved);
      if (normSaved && VALID_TABS.includes(normSaved)) {
        return { section: normSaved };
      }
    } catch {}

    return { section: 'overview' };
  };

  const [route, setRoute] = useState<RouteState>(parseRoute);
  const activeTab = route.section;

  const handleSidebarNavigate = (val: string | null) => {
    const nextSection = val || 'overview';
    setRoute({ section: nextSection, subtab: undefined });
    updateProfile({ active_tab: nextSection });
    try {
      localStorage.setItem('squirrel.activeTab', nextSection);
      const url = new URL(window.location.href);
      url.pathname = `/${nextSection}`;
      url.searchParams.delete('tab');
      url.searchParams.delete('subtab');
      window.history.pushState({}, '', url.toString());
    } catch {}
  };

  const handleSubtabChange = (section: string, subtab: string) => {
    setRoute({ section, subtab });
    try {
      const url = new URL(window.location.href);
      const isDefault = (section === 'overview' && subtab === 'overview') || (section === 'investments' && subtab === 'holdings');
      url.pathname = isDefault ? `/${section}` : `/${section}/${subtab}`;
      url.searchParams.delete('tab');
      url.searchParams.delete('subtab');
      window.history.pushState({}, '', url.toString());
    } catch {}
  };

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseRoute());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [profile, setProfileField] = useProfile();
  const hideBalances = profile.hide_balances;

  useEffect(() => {
    const hasExplicitRoute = window.location.pathname.replace(/^\/+/, '') !== '' || new URLSearchParams(window.location.search).has('tab');
    const restoredTab = normalizeTab(profile.active_tab);
    if (!hasExplicitRoute && restoredTab && VALID_TABS.includes(restoredTab)) {
      setRoute({ section: restoredTab });
    }
  }, [profile.active_tab]);

  const setHideBalances = (fn: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof fn === 'function' ? fn(profile.hide_balances) : fn;
    setProfileField({ hide_balances: next });
  };

  useEffect(() => {
    setHideBalancesState(hideBalances);
  }, [hideBalances]);

  const { setColorScheme } = useMantineColorScheme();
  const [scheme, setScheme] = useState<ThemeScheme>(() => {
    return resolveUserTheme(profile.theme, currentUser?.google_id).scheme;
  });
  const [accent, setAccent] = useState<ThemeAccent>(() => {
    return resolveUserTheme(profile.theme, currentUser?.google_id).accent;
  });

  useEffect(() => {
    const resolved = resolveUserTheme(profile.theme, currentUser?.google_id);
    setScheme(resolved.scheme);
    setAccent(resolved.accent);
    saveUserThemeLocally(currentUser?.google_id || 'guest', resolved.scheme, resolved.accent);
    applyAccentVars(resolved.accent);
    document.documentElement.setAttribute('data-accent', resolved.accent);
    setColorScheme(resolved.scheme);
  }, [profile.theme, currentUser?.google_id, setColorScheme]);

  const applyTheme = (s: ThemeScheme, a: ThemeAccent) => {
    const userKey = currentUser?.google_id || 'guest';
    setScheme(s);
    setAccent(a);
    saveUserThemeLocally(userKey, s, a);
    applyAccentVars(a);
    document.documentElement.setAttribute('data-accent', a);
    setProfileField({ theme: `${s}:${a}` });
    if ('startViewTransition' in document) {
      (document as any).startViewTransition(() => setColorScheme(s));
    } else {
      setColorScheme(s);
    }
  };

  // Global Keyboard Shortcuts (⌘H for balances, ⌘B for sidebar, ⌘K / / for search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isEditable = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (isCmdOrCtrl && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setHideBalances(v => !v);
        notifications.show({
          color: 'teal',
          title: 'Shortcut: Balances Toggled',
          message: profile.hide_balances ? 'Showing balances' : 'Hiding balances',
          autoClose: 1800,
        });
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (isMobile) setMobileNavOpened(opened => !opened);
        else handleToggleSidebar();
      } else if (!isEditable && (e.key === '/' || (isCmdOrCtrl && e.key.toLowerCase() === 'k'))) {
        e.preventDefault();
        setQuickSearchOpened(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [profile.hide_balances, isMobile]);

  if (needsLogin) return <LoginView />;
  if (!data) {
    return (
      <main className="shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        {error ? (
          <Paper withBorder p="xl" radius="lg" style={{ maxWidth: 460, textAlign: 'center', margin: '0 auto' }}>
            <Stack align="center" gap="md">
              <SquirrelIcon size={48} />
              <Text fw={750} size="lg">Could Not Connect to Squirrel</Text>
              <Text size="sm" c="dimmed">{error}</Text>
              <Button leftSection={<IconRefresh size={16} />} color="teal" onClick={() => void load()}>
                Retry Connection
              </Button>
            </Stack>
          </Paper>
        ) : (
          <AppSkeleton />
        )}
      </main>
    );
  }

  const diagnosticsCount = data.summary.diagnostics?.length ?? 0;
  const sortedSnapshots = [...(data.snapshots ?? [])].sort((a, b) => a.observed_on.localeCompare(b.observed_on));
  const latestSnapshotDate = sortedSnapshots[sortedSnapshots.length - 1]?.observed_on;

  const navigation = (
    <Sidebar
      collapsed={!isMobile && sidebarCollapsed}
      mobile={isMobile}
      onToggleCollapse={handleToggleSidebar}
      activeTab={activeTab}
      onNavigate={tab => { handleSidebarNavigate(tab); setMobileNavOpened(false); }}
      diagnosticsCount={diagnosticsCount}
      diagnostics={data.summary.diagnostics ?? []}
      accountsCount={data.accounts.length}
      currentUser={currentUser}
      signedInUsers={signedInUsers}
      hideBalances={hideBalances}
      onToggleHideBalances={() => setHideBalances(v => !v)}
      onOpenUpdate={() => { setMobileNavOpened(false); setUpdateModalOpened(true); }}
      onOpenSearch={() => { setMobileNavOpened(false); setQuickSearchOpened(true); }}
      onAddAccount={() => void addAccount()}
      onSwitchAccount={googleID => void switchAccount(googleID)}
      onSignOut={() => void signOut()}
      scheme={scheme}
      accent={accent}
      onApplyTheme={applyTheme}
      enableBtp={Boolean(profile.enable_btp_ranks)}
      squirrelIcon={<SquirrelIcon size={26} />}
      squirrelBrandLogo={<SquirrelBrandLogo size={24} />}
      latestSnapshotDate={latestSnapshotDate}
      refreshTick={refreshTick}
      onToggleRefresh={() => void handleToggleRefresh()}
    />
  );

  return (
    <div className="app-layout">
      {isMobile ? (
        <>
          {!mobileNavOpened && (
            <Burger
              className="mobile-nav-trigger"
              opened={false}
              onClick={() => setMobileNavOpened(true)}
              aria-label="Open navigation"
              size="sm"
            />
          )}
          <Drawer
            className="mobile-nav-drawer"
            opened={mobileNavOpened}
            onClose={() => setMobileNavOpened(false)}
            title={<SquirrelBrandLogo size={22} />}
            size={280}
            padding={0}
          >
            {navigation}
          </Drawer>
        </>
      ) : navigation}

      <div className="app-main-content">
        <main className="app-content-container">
          <Tabs value={activeTab} onChange={handleSidebarNavigate} keepMounted={false}>
            <Tabs.Panel value="overview" className="tab-content">
              <Overview
                data={data}
                reload={load}
                onSwitchTab={handleSidebarNavigate}
                activeSubtab={(route.subtab as 'overview' | 'diagnostics') || 'overview'}
                onSubtabChange={(subtab) => handleSubtabChange('overview', subtab)}
              />
            </Tabs.Panel>
            <Tabs.Panel value="accounts" className="tab-content">
              <Accounts accounts={data.accounts} rates={data.rates} taxRates={data.taxRates} reload={load} />
            </Tabs.Panel>
            <Tabs.Panel value="investments" className="tab-content">
              <Investments
                holdings={data.holdings}
                accounts={data.accounts}
                instruments={data.instruments}
                taxRates={data.taxRates}
                reload={load}
                activeSubtab={(route.subtab as any) || 'holdings'}
                onSubtabChange={(subtab) => handleSubtabChange('investments', subtab)}
                onOpenDetail={isin => handleSubtabChange('instruments', isin)}
              />
            </Tabs.Panel>
            <Tabs.Panel value="holdings" className="tab-content">
              <Investments
                holdings={data.holdings}
                accounts={data.accounts}
                instruments={data.instruments}
                taxRates={data.taxRates}
                reload={load}
                activeSubtab="holdings"
                onSubtabChange={(subtab) => handleSubtabChange('investments', subtab)}
                onOpenDetail={isin => handleSubtabChange('instruments', isin)}
              />
            </Tabs.Panel>
            <Tabs.Panel value="drafts" className="tab-content">
              <Investments
                holdings={data.holdings}
                instruments={data.instruments}
                accounts={data.accounts}
                taxRates={data.taxRates}
                reload={load}
                activeSubtab="sandbox"
                onSubtabChange={(subtab) => handleSubtabChange('investments', subtab)}
                onOpenDetail={isin => handleSubtabChange('instruments', isin)}
              />
            </Tabs.Panel>
            <Tabs.Panel value="instruments" className="tab-content">
              {route.subtab && /^[A-Z]{2}[A-Z0-9]{10}$/.test(route.subtab)
                ? <InstrumentDetailView
                    key={route.subtab}
                    isin={route.subtab}
                    instrument={data.instruments.find(i => i.isin === route.subtab)}
                    instruments={data.instruments}
                    onBack={() => handleSubtabChange('instruments', '')}
                    onOpenDetail={isin => handleSubtabChange('instruments', isin)}
                    reload={load}
                  />
                : <InstrumentFinderView
                    key={currentUser?.google_id || 'guest'}
                    instruments={data.instruments}
                    reload={load}
                    onOpenDetail={isin => handleSubtabChange('instruments', isin)}
                  />
              }
            </Tabs.Panel>
            <Tabs.Panel value="market" className="tab-content"><MarketContextView rates={data.rates} reload={load} /></Tabs.Panel>
            <Tabs.Panel value="diagnostics" className="tab-content">
              <Overview
                data={data}
                reload={load}
                onSwitchTab={handleSidebarNavigate}
                activeSubtab="diagnostics"
                onSubtabChange={(subtab) => handleSubtabChange('overview', subtab)}
              />
            </Tabs.Panel>
            <Tabs.Panel value="consultant" className="tab-content">
              <AIConsultantView
                key={currentUser?.google_id || 'guest'}
                summary={data.summary}
                accounts={data.accounts}
                holdings={data.holdings}
                instruments={data.instruments}
              />
            </Tabs.Panel>
            <Tabs.Panel value="advisor" className="tab-content">
              <AIConsultantView
                key={currentUser?.google_id || 'guest'}
                summary={data.summary}
                accounts={data.accounts}
                holdings={data.holdings}
                instruments={data.instruments}
              />
            </Tabs.Panel>
            <Tabs.Panel value="btp" className="tab-content">
              <BtpRankView key={currentUser?.google_id || 'guest'} />
            </Tabs.Panel>
            <Tabs.Panel value="settings" className="tab-content">
              <SettingsView
                key={currentUser?.google_id || 'guest'}
                reload={load}
                scheme={scheme}
                accent={accent}
                onApplyTheme={applyTheme}
              />
            </Tabs.Panel>
          </Tabs>

          <UpdateSituationModal
            opened={updateModalOpened}
            onClose={() => setUpdateModalOpened(false)}
            accounts={data.accounts}
            holdings={data.holdings}
            reload={load}
          />
          <QuickSearchModal
            opened={quickSearchOpened}
            onClose={() => setQuickSearchOpened(false)}
            onSwitchTab={handleSidebarNavigate}
            onToggleHideBalances={() => setHideBalances(v => !v)}
            onOpenUpdateModal={() => setUpdateModalOpened(true)}
            hideBalances={hideBalances}
            instruments={data.instruments}
            accounts={data.accounts}
            scheme={scheme}
            accent={accent}
            onApplyTheme={applyTheme}
            onOpenDetail={isin => handleSubtabChange('instruments', isin)}
          />
        </main>
        <footer className="app-footer">
          <Text size="xs" c="dimmed">Squirrel · Stash, track & grow your wealth</Text>
        </footer>
      </div>
    </div>
  );
}

function Overview({
  data,
  reload,
  onSwitchTab,
  activeSubtab,
  onSubtabChange,
}: {
  data: Data;
  reload: () => Promise<void>;
  onSwitchTab: (tab: string) => void;
  activeSubtab?: 'overview' | 'diagnostics';
  onSubtabChange?: (subtab: 'overview' | 'diagnostics') => void;
}) {
  return (
    <OverviewView
      data={data}
      reload={reload}
      onSwitchTab={onSwitchTab}
      activeSubtab={activeSubtab}
      onSubtabChange={onSubtabChange}
    />
  );
}

function Accounts({ accounts, rates, taxRates, reload }: { accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  return <AccountsView accounts={accounts} rates={rates} taxRates={taxRates} reload={reload} />;
}

function Investments({
  holdings,
  accounts,
  instruments,
  taxRates,
  reload,
  activeSubtab,
  onSubtabChange,
  onOpenDrafts,
  onOpenDetail,
}: {
  holdings: Holding[];
  accounts: Account[];
  instruments: Instrument[];
  taxRates: TaxRate[];
  reload: () => Promise<void>;
  activeSubtab?: 'holdings' | 'pac' | 'radar' | 'sandbox';
  onSubtabChange?: (subtab: 'holdings' | 'pac' | 'radar' | 'sandbox') => void;
  onOpenDrafts?: () => void;
  onOpenDetail?: (isin: string) => void;
}) {
  return (
    <InvestmentsView
      holdings={holdings}
      accounts={accounts}
      instruments={instruments}
      taxRates={taxRates}
      reload={reload}
      activeSubtab={activeSubtab}
      onSubtabChange={onSubtabChange}
      onOpenDrafts={onOpenDrafts}
      onOpenDetail={onOpenDetail}
    />
  );
}

