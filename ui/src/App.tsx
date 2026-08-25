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
  IconSun,
  IconMoon,
  IconSettings,
} from '@tabler/icons-react';
import {
  ActionIcon,
  Alert,
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
  Progress,
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
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { api, instrumentClient, type Account, type Diagnostic, type Instrument, type InstrumentAlternative, type InstrumentType, type Holding, type RankedInstrument, type ReferenceRate, type Snapshot, type Summary, type TaxRate } from './api';
import { Chip, chipColor } from './Chip';
import { DataTable, TableAction, TableActions, type DataColumn, type SortDirection } from './DataTable';
import { CompareModal } from './CompareModal';
import { InvestModal } from './InvestModal';
import { SettingsView } from './SettingsView';
import { UpdateSituationModal } from './UpdateSituationModal';
import { OverviewView } from './views/OverviewView';
import { AccountsView } from './views/AccountsView';
import { HoldingsView } from './views/HoldingsView';
import { InstrumentFinderView } from './views/InstrumentFinderView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { AIAdvisorView } from './views/AIAdvisorView';
import { DraftPortfoliosView } from './views/DraftPortfoliosView';
import { chartGeometry, matchesExactFilters, pageBounds, performanceMood } from './visual';

type Data = { summary: Summary; accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; instruments: Instrument[]; holdings: Holding[]; snapshots: Snapshot[] };
type Numeric = string | number;
import { money, investedMoney, setHideBalancesState } from './utils/format';
import { captureTokenFromURL, clearToken, fetchMe, isUnauthenticatedError, type AuthUser } from './auth';
import { LoginView } from './LoginView';
import { loadProfile, useProfile } from './hooks/useProfile';

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

  const VALID_TABS = ['overview', 'accounts', 'holdings', 'drafts', 'instruments', 'diagnostics', 'advisor', 'settings'];

  const [activeTab, setActiveTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get('tab');
    if (urlTab && VALID_TABS.includes(urlTab)) {
      return urlTab;
    }
    if (params.has('similarity')) {
      return 'instruments';
    }
    try {
      const saved = localStorage.getItem('loot.activeTab');
      if (saved && VALID_TABS.includes(saved)) {
        return saved;
      }
    } catch {
      /* optional */
    }
    return 'overview';
  });

  const handleTabChange = (val: string | null) => {
    const next = val || 'overview';
    setActiveTab(next);
    try {
      localStorage.setItem('loot.activeTab', next);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.pushState({}, '', url.toString());
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab') || 'overview';
      if (VALID_TABS.includes(tab)) {
        setActiveTab(tab);
      }
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

  if (needsLogin) return <LoginView />;
  if (!data) return <Group justify="center" h="100vh">{error ? <Alert color="red">{error}</Alert> : <Loader />}</Group>;
  setHideBalancesState(hideBalances);
  const diagnosticsCount = data.summary.diagnostics?.length ?? 0;
  return (
  <>
    <main className="shell">
      <Group justify="space-between" align="center" mb="md">
        <Title order={1} size="1.75rem" className="brand" c="teal">LOOT</Title>
        <Group gap={4}>
          <HeaderIconButton icon={<IconArrowsExchange size={16} />} label="Update" onClick={() => setUpdateModalOpened(true)} />
          <HeaderIconButton
            icon={hideBalances ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            label={hideBalances ? 'Show' : 'Hide'}
            onClick={() => setHideBalances(v => !v)}
          />
          <ThemeToggleIcon />
          {currentUser ? (
            <Menu shadow="md" width={240} position="bottom-end">
              <Menu.Target>
                <HeaderIconButton icon={<IconUser size={16} />} label="Account" />
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  <Stack gap={2}>
                    <Group gap="xs" align="center">
                      <Text size="sm" fw={600}>{currentUser.email}</Text>
                      {currentUser.is_admin && <Badge size="xs" color="teal">admin</Badge>}
                    </Group>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ fontFamily: 'monospace', cursor: 'pointer', wordBreak: 'break-all' }}
                      title="Click to copy"
                      onClick={() => navigator.clipboard.writeText(currentUser.google_id)}
                    >
                      {currentUser.google_id}
                    </Text>
                  </Stack>
                </Menu.Label>
                <Menu.Divider />
                <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => handleTabChange('settings')}>
                  Settings
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  onClick={() => { clearToken(); setNeedsLogin(true); setCurrentUser(null); setData(undefined); }}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </Group>
      </Group>
      {error && <Alert color="red" mb="md" withCloseButton onClose={() => setError('')}>{error}</Alert>}
      <Tabs value={activeTab} onChange={handleTabChange} keepMounted={false}>
        <Tabs.List mb="xl">
          <Tabs.Tab value="overview" leftSection={<IconChartPie size={16} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="accounts" leftSection={<IconBuildingBank size={16} />}>
            Accounts
          </Tabs.Tab>
          <Tabs.Tab value="holdings" leftSection={<IconBriefcase size={16} />}>
            Holdings
          </Tabs.Tab>
          <Tabs.Tab value="drafts" leftSection={<IconFlask size={16} />}>
            Portfolio Sandbox
          </Tabs.Tab>
          <Tabs.Tab value="instruments" leftSection={<IconSearch size={16} />}>
            Instruments
          </Tabs.Tab>
          <Tabs.Tab
            value="diagnostics"
            leftSection={<IconActivity size={16} />}
            rightSection={diagnosticsCount > 0 ? <Badge size="xs" color="orange" circle>{diagnosticsCount}</Badge> : undefined}
          >
            Diagnostics
          </Tabs.Tab>
          <Tabs.Tab value="advisor" leftSection={<IconRobot size={16} />}>
            AI Assistant
          </Tabs.Tab>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>
            Settings
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview"><Overview data={data} reload={load} onSwitchTab={handleTabChange} /></Tabs.Panel>
        <Tabs.Panel value="accounts"><Accounts accounts={data.accounts} rates={data.rates} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="holdings"><Holdings holdings={data.holdings} accounts={data.accounts} instruments={data.instruments} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="drafts">
          <DraftPortfoliosView
            holdings={data.holdings}
            instruments={data.instruments}
            accounts={data.accounts}
            reload={load}
          />
        </Tabs.Panel>
        <Tabs.Panel value="instruments"><InstrumentFinder instruments={data.instruments} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="diagnostics">
          <DiagnosticsTab
            diagnostics={data.summary.diagnostics ?? []}
            onOpenSettings={() => handleTabChange('settings')}
            onOpenInvest={() => handleTabChange('holdings')}
          />
        </Tabs.Panel>
        <Tabs.Panel value="advisor">
          <AIAdvisorView
            summary={data.summary}
            accounts={data.accounts}
            holdings={data.holdings}
            instruments={data.instruments}
          />
        </Tabs.Panel>
        <Tabs.Panel value="settings">
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
    </main>
    <footer className="app-footer">
      <Text size="xs" c="dimmed">LOOT · Know what you own</Text>
    </footer>
  </>
  );
}

function DiagnosticsTab({
  diagnostics,
  onOpenSettings,
  onOpenInvest,
}: {
  diagnostics: Diagnostic[];
  onOpenSettings: () => void;
  onOpenInvest: () => void;
}) {
  return (
    <DiagnosticsView
      diagnostics={diagnostics}
      onOpenSettings={onOpenSettings}
      onOpenInvest={onOpenInvest}
    />
  );
}

function Overview({ data, reload, onSwitchTab }: { data: Data; reload: () => Promise<void>; onSwitchTab: (tab: string) => void }) {
  return <OverviewView data={data} reload={reload} onSwitchTab={onSwitchTab} />;
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
  return <Group gap={6} wrap="nowrap" align="center">{mood && <Text title={state.label} size="lg" lh={1}>{state.emoji}</Text>}<Text size="sm" fw={700} c={change >= 0 ? 'teal' : 'red'}>{change >= 0 ? '+' : ''}{money(change, currency)} · {change >= 0 ? '+' : ''}{changePercent.toFixed(1)}%</Text></Group>;
}

function HeaderIconButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <Stack
      gap={2}
      align="center"
      className="header-icon-btn"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <Box className="header-icon-btn__icon">{icon}</Box>
      <Text size="10px" c="dimmed" lh={1}>{label}</Text>
    </Stack>
  );
}

function ThemeToggleIcon() {
  const scheme = useComputedColorScheme('light');
  const { setColorScheme } = useMantineColorScheme();
  const isDark = scheme === 'dark';
  const toggle = () => {
    const next = isDark ? 'light' : 'dark';
    if ('startViewTransition' in document) {
      (document as any).startViewTransition(() => setColorScheme(next));
    } else {
      setColorScheme(next);
    }
  };
  return (
    <HeaderIconButton
      icon={isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      label={isDark ? 'Light' : 'Dark'}
      onClick={toggle}
    />
  );
}

export function AllocationBar({ segments, total }: { segments: { label: string; value: number }[]; total: number }) {
  const visible = segments.filter(segment => segment.value > 0);
  return <><Box h={14} bg="gray.1" mt="sm" style={{ display: 'flex', overflow: 'hidden', borderRadius: 999 }}>{visible.map(segment => <Box key={segment.label} bg={`${chipColor(segment.label)}.5`} style={{ width: `${total > 0 ? segment.value / total * 100 : 0}%` }} />)}</Box><Group gap="xs" mt="sm">{visible.map(segment => <Chip key={segment.label} colorKey={segment.label}>{`${segment.label} ${total > 0 ? (segment.value / total * 100).toFixed(1) : '0.0'}%`}</Chip>)}</Group></>;
}

type TierDraft = { upTo: Numeric; kind: 'fixed' | 'reference'; rate: Numeric; reference: string; spread: Numeric };
type AccountDraft = { name: string; institution: string; type: Account['type']; preferred: boolean; archived: boolean; currency: string; balance: Numeric; tax: Numeric; fee: Numeric; tiers: TierDraft[] };
const blankTier = (): TierDraft => ({ upTo: '', kind: 'fixed', rate: 0, reference: '', spread: 0 });
const blankAccount = (tax = 26): AccountDraft => ({ name: '', institution: '', type: 'bank', preferred: false, archived: false, currency: 'EUR', balance: 0, tax, fee: 0, tiers: [blankTier()] });

function Accounts({ accounts, rates, taxRates, reload }: { accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  return <AccountsView accounts={accounts} rates={rates} taxRates={taxRates} reload={reload} />;
}

type HoldingDraft = { accountID: string; instrumentID: string; value: Numeric; sinceBuy: Numeric; planned: Numeric; tax: Numeric };

function Holdings({ holdings, accounts, instruments, taxRates, reload, onOpenDrafts }: { holdings: Holding[]; accounts: Account[]; instruments: Instrument[]; taxRates: TaxRate[]; reload: () => Promise<void>; onOpenDrafts?: () => void }) {
  return <HoldingsView holdings={holdings} accounts={accounts} instruments={instruments} taxRates={taxRates} reload={reload} onOpenDrafts={onOpenDrafts} />;
}

function InstrumentFinder({ instruments, reload }: { instruments: Instrument[]; reload: () => Promise<void> }) {
  return <InstrumentFinderView instruments={instruments} reload={reload} />;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <Card className="metric" p="xl" radius="lg"><Text fw={700}>{title}</Text><Text size="sm" c="dimmed" mt={4}>{text}</Text></Card>;
}
