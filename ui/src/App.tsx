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
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
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
import { notifications } from '@mantine/notifications';
import { api, instrumentClient, type Account, type Diagnostic, type Instrument, type InstrumentAlternative, type InstrumentType, type Holding, type RankedInstrument, type ReferenceRate, type Snapshot, type Summary, type TaxRate } from './api';
import { Chip, chipColor } from './Chip';
import { DataTable, TableAction, TableActions, type DataColumn, type SortDirection } from './DataTable';
import { CompareModal } from './CompareModal';
import { AppSkeleton } from './components/AppSkeleton';
import { SettingsView } from './SettingsView';
import { UpdateSituationModal } from './UpdateSituationModal';
import { OverviewView } from './views/OverviewView';
import { AccountsView } from './views/AccountsView';
import { InvestmentsView } from './views/InvestmentsView';
import { InstrumentFinderView } from './views/InstrumentFinderView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { AIConsultantView } from './views/AIConsultantView';
import { DraftPortfoliosView } from './views/DraftPortfoliosView';
import { BtpRankView } from './views/BtpRankView';
import { MarketContextView } from './views/MarketContextView';
import { QuickSearchModal } from './components/QuickSearchModal';
import { chartGeometry, matchesExactFilters, pageBounds, performanceMood } from './visual';

type Data = { summary: Summary; accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; instruments: Instrument[]; holdings: Holding[]; snapshots: Snapshot[] };
type Numeric = string | number;
const normalizeTab = (tab: string | null) => tab === 'holdings' || tab === 'geo' ? 'investments' : tab === 'advisor' ? 'consultant' : tab === 'rates' ? 'market' : tab;
import { money, investedMoney, setHideBalancesState } from './utils/format';
import { captureTokenFromURL, clearToken, fetchMe, isUnauthenticatedError, type AuthUser } from './auth';
import { LoginView } from './LoginView';
import { loadProfile, useProfile } from './hooks/useProfile';
import { handleLinkClick } from './utils/navigation';
import { Sidebar, type ThemeAccent, type ThemeScheme, ACCENT_HEX } from './components/Sidebar';

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

export function useBackendRows<T>(endpoint: string, source: T[], initialSort = '', initialDirection: SortDirection = 'asc') {
  const [rows, setRows] = useState(source);
  const [sort, setSort] = useState(initialSort);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const [sortError, setSortError] = useState('');
  useEffect(() => { setRows(source); setSort(initialSort); setDirection(initialDirection); }, [source, initialSort, initialDirection]);
  const sortRows = async (key: string, next: SortDirection) => {
    try {
      setRows(await api<T[]>(`${endpoint}?sort=${encodeURIComponent(key)}&direction=${next}`) ?? []);
      setSort(key); setDirection(next); setSortError('');
    } catch (cause) { setSortError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return { rows, sort, direction, sortError, sortRows };
}

export function SquirrelIcon({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="sqFur" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id="sqTail" x1="14" y1="2" x2="32" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
      </defs>

      {/* Bushy Fluffy Tail (sweeping upward on right) */}
      <path
        d="M 16.5 25 C 22 25 28.5 21.5 29.5 15.5 C 30.5 10 28.5 5.5 25 2.5 C 22 0 18.5 0 16 0 C 17.5 2.5 19 5 19.5 8.5 C 20.2 12.5 19 16 16 19 C 14 21 12.5 21.5 11 22 C 12.5 24 14.5 25 16.5 25 Z"
        fill="url(#sqTail)"
      />

      {/* Back Ear (tufted, standing tall) */}
      <path d="M 14.5 7.5 L 14.2 0.8 C 13.6 -0.2 12.4 0.6 12 2 L 12 7 Z" fill="#9a3412" />

      {/* Front Ear (tufted, standing tall) */}
      <path d="M 11.5 8 L 10.5 0.5 C 9.8 -0.5 8.8 0.5 8.8 2 L 9.2 8.5 Z" fill="url(#sqFur)" />

      {/* Big Round Head (Snout pointing left) */}
      <circle cx="10" cy="10" r="5.5" fill="url(#sqFur)" />
      <path d="M 10 4.5 C 7 4.5 4.5 7 4 9.5 C 3.5 11.2 4.2 12.8 5.5 13.8 L 10 15.5 Z" fill="url(#sqFur)" />

      {/* Cream Chest / Belly Bib */}
      <path
        d="M 5.8 12.5 C 6.2 15 7.2 18.5 8.8 22 C 9.8 24.2 11.2 26 12.5 26 C 10.8 25 9.5 22.8 8.2 20 C 7.2 17.2 6.5 14.5 5.8 12.5 Z"
        fill="#fef3c7"
      />

      {/* Torso & Back */}
      <path
        d="M 6.8 13.5 C 6 15.5 5.5 18 5.5 21 C 5.5 24.5 7 27 9 28 C 11 29 13.5 28 15 27 C 18 26 20 22.5 20 18 C 20 14.5 17.5 12 14.5 11.5 C 11 11 8.5 11.8 6.8 13.5 Z"
        fill="url(#sqFur)"
      />

      {/* Round Sitting Hind Thigh */}
      <circle cx="13.5" cy="20.5" r="4.8" fill="url(#sqFur)" stroke="#ea580c" strokeWidth="0.8" />

      {/* Sitting Feet */}
      <path d="M 8 27 C 6.8 27 5.8 27.5 5.2 28 C 6.8 28.8 9 28.8 10.5 28 Z" fill="#c2410c" />
      <path d="M 12 26.8 C 10.8 27.5 10.2 28.2 10.8 28.8 C 12.5 29.2 14.8 28.8 15.8 27.8 Z" fill="#c2410c" />

      {/* Cute Front Paws */}
      <path d="M 7.2 15 C 6.2 16.2 6 17.8 6.5 18.5 C 7 18.8 8 17.8 8.4 16.5 Z" fill="#c2410c" />
      <path d="M 9.5 15.2 C 8.5 16.5 8.2 18.1 8.7 18.8 C 9.2 19 10.2 18 10.6 16.8 Z" fill="#c2410c" />

      {/* Large Expressive Eye & Nose */}
      <circle cx="8" cy="9.2" r="1.5" fill="#0f172a" />
      <circle cx="7.5" cy="8.6" r="0.55" fill="#ffffff" />
      <ellipse cx="4.2" cy="10" rx="0.85" ry="0.65" fill="#0f172a" />
    </svg>
  );
}

export function SquirrelBrandLogo({ size = 26 }: { size?: number }) {
  return (
    <Group gap={8} align="center" style={{ userSelect: 'none' }}>
      <SquirrelIcon size={size} />
      <Text
        component="span"
        style={{
          fontSize: '1.65rem',
          fontWeight: 850,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
          letterSpacing: '-0.045em',
          background: 'linear-gradient(135deg, var(--mantine-color-teal-4, #fb923c) 0%, var(--mantine-color-teal-6, #ea580c) 65%, var(--mantine-color-teal-8, #c2410c) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          filter: 'drop-shadow(0 2px 10px rgba(249, 115, 22, 0.2))',
        }}
      >
        squirrel
      </Text>
    </Group>
  );
}

export function formatUserName(user?: AuthUser | null): string {
  if (!user || !user.email) return 'Account';
  const namePart = user.email.split('@')[0];
  return namePart
    .split(/[._-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}



export default function App() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    captureTokenFromURL();
    try {
      const [summary, accounts, rates, taxRates, instruments, holdings, snapshots] = await Promise.all([
        api<Summary>('/api/summary'),
        api<Account[]>('/api/accounts'),
        api<ReferenceRate[]>('/api/reference-rates'),
        api<TaxRate[]>('/api/tax-rates'),
        api<Instrument[]>('/api/instruments'),
        api<Holding[]>('/api/holdings'),
        api<Snapshot[]>('/api/snapshots'),
      ]);
      setData({ summary, accounts: accounts ?? [], rates: rates ?? [], taxRates: taxRates ?? [], instruments: instruments ?? [], holdings: holdings ?? [], snapshots: snapshots ?? [] });
      setNeedsLogin(false);
      setError('');
      fetchMe().then(u => setCurrentUser(u));
      void loadProfile();
    } catch (cause) {
      if (isUnauthenticatedError(cause)) {
        setNeedsLogin(true);
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [quickSearchOpened, setQuickSearchOpened] = useState(false);
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
  const setHideBalances = (fn: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof fn === 'function' ? fn(profile.hide_balances) : fn;
    setProfileField({ hide_balances: next });
  };

  useEffect(() => {
    setHideBalancesState(hideBalances);
  }, [hideBalances]);

  const { setColorScheme } = useMantineColorScheme();
  const [scheme, setScheme] = useState<ThemeScheme>(() => {
    const s = localStorage.getItem('squirrel.scheme');
    return s === 'light' ? 'light' : 'dark';
  });
  const [accent, setAccent] = useState<ThemeAccent>(() => {
    const a = localStorage.getItem('squirrel.accent') as ThemeAccent | null;
    return a && a in ACCENT_HEX ? a : 'amber';
  });

  useEffect(() => {
    applyAccentVars(accent);
    document.documentElement.setAttribute('data-accent', accent);
    setColorScheme(scheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTheme = (s: ThemeScheme, a: ThemeAccent) => {
    setScheme(s);
    setAccent(a);
    localStorage.setItem('squirrel.scheme', s);
    localStorage.setItem('squirrel.accent', a);
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
        handleToggleSidebar();
      } else if (!isEditable && (e.key === '/' || (isCmdOrCtrl && e.key.toLowerCase() === 'k'))) {
        e.preventDefault();
        setQuickSearchOpened(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [profile.hide_balances]);

  if (needsLogin) return <LoginView />;
  if (!data) {
    return (
      <main className="shell">
        {error ? <Alert color="red">{error}</Alert> : <AppSkeleton />}
      </main>
    );
  }

  const diagnosticsCount = data.summary.diagnostics?.length ?? 0;
  return (
    <div className="app-layout">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        activeTab={activeTab}
        onNavigate={handleSidebarNavigate}
        diagnosticsCount={diagnosticsCount}
        diagnostics={data.summary.diagnostics ?? []}
        accountsCount={data.accounts.length}
        currentUser={currentUser}
        hideBalances={hideBalances}
        onToggleHideBalances={() => setHideBalances(v => !v)}
        onOpenUpdate={() => setUpdateModalOpened(true)}
        onOpenSearch={() => setQuickSearchOpened(true)}
        onSignOut={() => { clearToken(); setNeedsLogin(true); setCurrentUser(null); setData(undefined); }}
        scheme={scheme}
        accent={accent}
        onApplyTheme={applyTheme}
        enableBtp={Boolean(profile.enable_btp_ranks)}
        squirrelIcon={<SquirrelIcon size={26} />}
        squirrelBrandLogo={<SquirrelBrandLogo size={24} />}
      />

      <div className="app-main-content">
        <main className="app-content-container">
          {error && <Alert color="red" mb="md" withCloseButton onClose={() => setError('')}>{error}</Alert>}
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
              />
            </Tabs.Panel>
            <Tabs.Panel value="instruments" className="tab-content"><InstrumentFinder instruments={data.instruments} reload={load} /></Tabs.Panel>
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
                summary={data.summary}
                accounts={data.accounts}
                holdings={data.holdings}
                instruments={data.instruments}
              />
            </Tabs.Panel>
            <Tabs.Panel value="advisor" className="tab-content">
              <AIConsultantView
                summary={data.summary}
                accounts={data.accounts}
                holdings={data.holdings}
                instruments={data.instruments}
              />
            </Tabs.Panel>
            <Tabs.Panel value="btp" className="tab-content">
              <BtpRankView />
            </Tabs.Panel>
            <Tabs.Panel value="settings" className="tab-content">
              <SettingsView reload={load} />
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

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">{label}</Text><Text size="xl" fw={750} mt={4} className={positive ? 'positive' : ''}>{value}</Text></Card>;
}

function InvestmentMetric({ value, invested, currency }: { value: number; invested: number; currency: string }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">Investments</Text><Text size="xl" fw={750} mt={4}>{money(value, currency)}</Text><Text size="xs" c="dimmed" mt={5}>Invested {investedMoney(invested, value, currency)}</Text></Card>;
}

function PerformanceMetric({ value, invested, currency }: { value: number; invested: number; currency: string }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">Investment trend</Text><Group mt={10} align="center"><PerformanceResult value={value} invested={invested} currency={currency} mood /></Group></Card>;
}

export function PerformanceResult({ value, invested, currency, mood = false }: { value: number; invested: number; currency: string; mood?: boolean }) {
  if (invested <= 0) return <Text size="sm" c="dimmed">—</Text>;
  const change = value - invested; const changePercent = change / invested * 100; const state = performanceMood(changePercent);
  return (
    <Group gap={4} wrap="nowrap" align="center">
      {mood && <Text title={state.label} size="lg" lh={1}>{state.emoji}</Text>}
      {change >= 0 ? <IconTrendingUp size={14} color="var(--mantine-color-teal-6)" /> : <IconTrendingDown size={14} color="var(--mantine-color-red-6)" />}
      <Text size="sm" fw={700} c={change >= 0 ? 'teal' : 'red'}>
        {change >= 0 ? '+' : ''}{money(change, currency)} · {change >= 0 ? '+' : ''}{changePercent.toFixed(1)}%
      </Text>
    </Group>
  );
}



export function AllocationBar({
  segments,
  total,
  selectedKey,
  onSelectKey,
}: {
  segments: { label: string; value: number; key?: string }[];
  total: number;
  selectedKey?: string | null;
  onSelectKey?: (key: string | null) => void;
}) {
  const visible = segments.filter(segment => segment.value > 0);

  return (
    <Stack gap="xs" mt="sm">
      <Box
        h={14}
        bg="light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))"
        style={{ display: 'flex', overflow: 'hidden', borderRadius: 999 }}
      >
        {visible.map(segment => {
          const itemKey = segment.key ?? segment.label.toLowerCase();
          const isSelected = selectedKey === itemKey;
          const isDimmed = Boolean(selectedKey && !isSelected);
          const pct = total > 0 ? (segment.value / total) * 100 : 0;

          return (
            <Tooltip
              key={segment.label}
              label={`${segment.label}: ${pct.toFixed(1)}% (${money(segment.value, 'EUR')})${onSelectKey ? ' · Click to filter' : ''}`}
              withArrow
            >
              <Box
                bg={`${chipColor(segment.label)}.5`}
                onClick={() => onSelectKey?.(isSelected ? null : itemKey)}
                style={{
                  width: `${pct}%`,
                  cursor: onSelectKey ? 'pointer' : 'default',
                  opacity: isDimmed ? 0.35 : 1,
                  transition: 'opacity 0.2s ease, transform 0.15s ease',
                  transform: isSelected ? 'scaleY(1.2)' : 'scaleY(1)',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Group gap="xs">
        {visible.map(segment => {
          const itemKey = segment.key ?? segment.label.toLowerCase();
          const isSelected = selectedKey === itemKey;
          const pct = total > 0 ? (segment.value / total) * 100 : 0;
          return (
            <UnstyledButton
              key={segment.label}
              disabled={!onSelectKey}
              onClick={() => onSelectKey?.(isSelected ? null : itemKey)}
            >
              <Chip
                colorKey={segment.label}
                variant={isSelected ? 'filled' : 'light'}
                style={{
                  cursor: onSelectKey ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                  boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
                }}
              >
                {`${segment.label} ${pct.toFixed(1)}%`}
              </Chip>
            </UnstyledButton>
          );
        })}
      </Group>
    </Stack>
  );
}

type TierDraft = { upTo: Numeric; kind: 'fixed' | 'reference'; rate: Numeric; reference: string; spread: Numeric };
type AccountDraft = { name: string; institution: string; type: Account['type']; preferred: boolean; archived: boolean; currency: string; balance: Numeric; tax: Numeric; fee: Numeric; tiers: TierDraft[] };
const blankTier = (): TierDraft => ({ upTo: '', kind: 'fixed', rate: 0, reference: '', spread: 0 });
const blankAccount = (tax = 26): AccountDraft => ({ name: '', institution: '', type: 'bank', preferred: false, archived: false, currency: 'EUR', balance: 0, tax, fee: 0, tiers: [blankTier()] });

function Accounts({ accounts, rates, taxRates, reload }: { accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  return <AccountsView accounts={accounts} rates={rates} taxRates={taxRates} reload={reload} />;
}

type HoldingDraft = { accountID: string; instrumentID: string; value: Numeric; sinceBuy: Numeric; planned: Numeric; tax: Numeric };

function Investments({
  holdings,
  accounts,
  instruments,
  taxRates,
  reload,
  activeSubtab,
  onSubtabChange,
  onOpenDrafts,
}: {
  holdings: Holding[];
  accounts: Account[];
  instruments: Instrument[];
  taxRates: TaxRate[];
  reload: () => Promise<void>;
  activeSubtab?: 'holdings' | 'pac' | 'radar' | 'sandbox';
  onSubtabChange?: (subtab: 'holdings' | 'pac' | 'radar' | 'sandbox') => void;
  onOpenDrafts?: () => void;
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
    />
  );
}

function InstrumentFinder({ instruments, reload }: { instruments: Instrument[]; reload: () => Promise<void> }) {
  return <InstrumentFinderView instruments={instruments} reload={reload} />;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <Card className="metric" p="xl" radius="lg"><Text fw={700}>{title}</Text><Text size="sm" c="dimmed" mt={4}>{text}</Text></Card>;
}
