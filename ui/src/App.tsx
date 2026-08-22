import { useCallback, useEffect, useState } from 'react';
import { IconExternalLink, IconArrowsExchange, IconRefresh, IconPencil, IconTrash, IconStar, IconStarFilled } from '@tabler/icons-react';
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
import { SettingsModal } from './SettingsModal';
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
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
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
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [settingsModalOpened, setSettingsModalOpened] = useState(false);

  const VALID_TABS = ['overview', 'accounts', 'holdings', 'drafts', 'instruments', 'diagnostics', 'advisor'];

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

  const [hideBalances, setHideBalances] = useState(() => {
    try { return localStorage.getItem('loot.hideBalances') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    setHideBalancesState(hideBalances);
    try { localStorage.setItem('loot.hideBalances', String(hideBalances)); } catch { /* optional */ }
  }, [hideBalances]);

  if (!data) return <Group justify="center" h="100vh">{error ? <Alert color="red">{error}</Alert> : <Loader />}</Group>;
  setHideBalancesState(hideBalances);
  const diagnosticsCount = data.summary.diagnostics?.length ?? 0;
  return (
    <main className="shell">
      <Group justify="space-between" align="end" mb="xl">
        <Box>
          <Text size="xs" fw={700} c="teal" tt="uppercase" lts={2}>Know what you own</Text>
          <Title order={1} size="3rem" className="brand">LOOT</Title>
        </Box>
        <Group>
          <Button color="teal" variant="light" onClick={() => setUpdateModalOpened(true)}>Update situation</Button>
          <Button variant="default" onClick={() => setSettingsModalOpened(true)}>Settings</Button>
          <Button variant="default" title={hideBalances ? 'Show balances' : 'Hide balances'} onClick={() => setHideBalances(v => !v)}>
            {hideBalances ? '🙈 Hide' : '👁️ Show'}
          </Button>
          <ThemeToggle />
        </Group>
      </Group>
      {error && <Alert color="red" mb="md" withCloseButton onClose={() => setError('')}>{error}</Alert>}
      <Tabs value={activeTab} onChange={handleTabChange} keepMounted={false}>
        <Tabs.List mb="xl">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="accounts">Accounts</Tabs.Tab>
          <Tabs.Tab value="holdings">Holdings</Tabs.Tab>
          <Tabs.Tab value="drafts">📁 Draft Portfolios</Tabs.Tab>
          <Tabs.Tab value="instruments">Instruments</Tabs.Tab>
          <Tabs.Tab
            value="diagnostics"
            rightSection={diagnosticsCount > 0 ? <Badge size="xs" color="orange" circle>{diagnosticsCount}</Badge> : undefined}
          >
            Diagnostics
          </Tabs.Tab>
          <Tabs.Tab value="advisor">🤖 AI Advisor</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview"><Overview data={data} reload={load} onSwitchTab={handleTabChange} /></Tabs.Panel>
        <Tabs.Panel value="accounts"><Accounts accounts={data.accounts} rates={data.rates} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="holdings"><Holdings holdings={data.holdings} accounts={data.accounts} instruments={data.instruments} taxRates={data.taxRates} reload={load} onOpenDrafts={() => handleTabChange('drafts')} /></Tabs.Panel>
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
            onOpenSettings={() => setSettingsModalOpened(true)}
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
      </Tabs>
      <UpdateSituationModal
        opened={updateModalOpened}
        onClose={() => setUpdateModalOpened(false)}
        accounts={data.accounts}
        holdings={data.holdings}
        reload={load}
      />
      <SettingsModal
        opened={settingsModalOpened}
        onClose={() => setSettingsModalOpened(false)}
        reload={load}
      />
    </main>
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

function ThemeToggle() {
  const scheme = useComputedColorScheme('light'); const { setColorScheme } = useMantineColorScheme();
  return <Button variant="default" aria-label={`Use ${scheme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>{scheme === 'dark' ? '☀ Light' : '☾ Dark'}</Button>;
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
