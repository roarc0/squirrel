import { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
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
import { chartGeometry, matchesExactFilters, pageBounds, performanceMood } from './visual';

type Data = { summary: Summary; accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; instruments: Instrument[]; holdings: Holding[]; snapshots: Snapshot[] };
type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);
const percent = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? '—' : `${(value / 100).toFixed(2)}%`;
let hideBalancesGlobal = false;
const money = (value: number | undefined, currency: string) =>
  hideBalancesGlobal ? '••••••' : (value === undefined || !Number.isFinite(value) ? '—' :
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value / 100));
const investedMoney = (invested: number, current: number, currency: string) => invested > 0 || current === 0 ? money(invested, currency) : '—';
const instrumentLabels: Record<InstrumentType, string> = { etf: 'ETF', etc: 'ETC', etn: 'ETN', fund: 'Fund', stock: 'Stock', bond: 'Bond', crypto: 'Crypto', commodity: 'Commodity', real_estate: 'Real estate', other: 'Other' };
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());
const confirmDelete = (kind: string, name: string, consequence = '') => window.confirm(`Delete ${kind} “${name}”?${consequence ? `\n\n${consequence}` : ''}\n\nThis cannot be undone.`);

function useBackendRows<T>(endpoint: string, source: T[], initialSort = '', initialDirection: SortDirection = 'asc') {
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
  const [activeTab, setActiveTab] = useState<string>(() =>
    new URLSearchParams(window.location.search).has('similarity') ? 'instruments' : 'overview'
  );
  const [hideBalances, setHideBalances] = useState(() => {
    try { return localStorage.getItem('loot.hideBalances') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    hideBalancesGlobal = hideBalances;
    try { localStorage.setItem('loot.hideBalances', String(hideBalances)); } catch { /* optional */ }
  }, [hideBalances]);

  if (!data) return <Group justify="center" h="100vh">{error ? <Alert color="red">{error}</Alert> : <Loader />}</Group>;
  hideBalancesGlobal = hideBalances;
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
      <Tabs value={activeTab} onChange={val => setActiveTab(val || 'overview')} keepMounted={false}>
        <Tabs.List mb="xl">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="accounts">Accounts</Tabs.Tab>
          <Tabs.Tab value="holdings">Holdings</Tabs.Tab>
          <Tabs.Tab value="instruments">Instruments</Tabs.Tab>
          <Tabs.Tab
            value="diagnostics"
            rightSection={diagnosticsCount > 0 ? <Badge size="xs" color="orange" circle>{diagnosticsCount}</Badge> : undefined}
          >
            Diagnostics
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview"><Overview data={data} reload={load} onSwitchTab={setActiveTab} /></Tabs.Panel>
        <Tabs.Panel value="accounts"><Accounts accounts={data.accounts} rates={data.rates} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="holdings"><Holdings holdings={data.holdings} accounts={data.accounts} instruments={data.instruments} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="instruments"><InstrumentFinder instruments={data.instruments} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="diagnostics">
          <DiagnosticsTab
            diagnostics={data.summary.diagnostics ?? []}
            onOpenSettings={() => setSettingsModalOpened(true)}
            onOpenInvest={() => setActiveTab('holdings')}
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
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const categories = ['all', 'cash', 'drift', 'cost', 'overlap', 'stale'];
  const filtered = selectedCategory === 'all'
    ? diagnostics
    : diagnostics.filter(d => d.category === selectedCategory);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="start">
        <Box>
          <Title order={2}>Portfolio Diagnostics</Title>
          <Text c="dimmed">Deterministic rule-based observations to keep your portfolio optimized.</Text>
        </Box>
        <Group gap="xs">
          {categories.map(cat => {
            const count = cat === 'all' ? diagnostics.length : diagnostics.filter(d => d.category === cat).length;
            if (cat !== 'all' && count === 0) return null;
            return (
              <Button
                key={cat}
                size="xs"
                variant={selectedCategory === cat ? 'filled' : 'light'}
                color={selectedCategory === cat ? 'teal' : 'gray'}
                onClick={() => setSelectedCategory(cat)}
              >
                {label(cat)} ({count})
              </Button>
            );
          })}
        </Group>
      </Group>

      {diagnostics.length === 0 ? (
        <Empty
          title="All systems optimal"
          text="No diagnostic warnings or allocation issues detected across your portfolio."
        />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {filtered.map(diag => (
            <Card key={diag.id} withBorder radius="lg" p="lg" shadow="xs">
              <Group justify="space-between" align="start" mb="xs">
                <Badge
                  color={diag.severity === 'warning' ? 'orange' : diag.severity === 'alert' ? 'red' : 'blue'}
                  variant="light"
                  size="sm"
                >
                  {diag.category.toUpperCase()} · {diag.severity}
                </Badge>
              </Group>
              <Text fw={700} size="md" mb={4}>{diag.title}</Text>
              <Text size="sm" c="dimmed" mb="md">{diag.message}</Text>
              <Group justify="end">
                {diag.category === 'cash' && (
                  <Button size="xs" variant="light" color="teal" onClick={onOpenSettings}>
                    Configure Emergency Reserve
                  </Button>
                )}
                {diag.category === 'drift' && (
                  <Button size="xs" variant="light" color="teal" onClick={onOpenInvest}>
                    Rebalance Portfolio
                  </Button>
                )}
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

function Overview({ data, reload, onSwitchTab }: { data: Data; reload: () => Promise<void>; onSwitchTab: (tab: string) => void }) {
  const currencies = data.summary.currencies ?? [];
  const diagnostics = data.summary.diagnostics ?? [];
  return <Stack gap="xl">
    {diagnostics.length > 0 && (
      <Paper withBorder p="md" radius="lg">
        <Group justify="space-between" align="center">
          <Group gap="sm">
            <Badge color="orange" size="lg" variant="light">{diagnostics.length}</Badge>
            <Box>
              <Text fw={700} size="sm">Portfolio Diagnostics Detected</Text>
              <Text size="xs" c="dimmed">{diagnostics[0].title}: {diagnostics[0].message.slice(0, 110)}...</Text>
            </Box>
          </Group>
          <Button size="xs" variant="light" color="orange" onClick={() => onSwitchTab('diagnostics')}>
            View Diagnostics tab →
          </Button>
        </Group>
      </Paper>
    )}
    {currencies.length === 0 ? <Empty title="No accounts yet" text="Add a bank or brokerage account to see your allocation." /> : currencies.map(item => {
      const allocations = (item.allocations ?? []).filter(allocation => allocation.value_minor > 0);
      return (
      <Box key={item.currency}>
        <Group justify="space-between" mb="sm"><Title order={3}>{item.currency} assets</Title><Text c="dimmed">Current rough situation</Text></Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Metric label="Cash balance" value={money(item.balance_minor, item.currency)} />
          <InvestmentMetric value={item.portfolio_minor} invested={item.invested_minor} currency={item.currency} />
          <PerformanceMetric value={item.portfolio_minor} invested={item.invested_minor} currency={item.currency} />
          <Metric label="Total wealth" value={money(item.total_minor, item.currency)} positive />
        </SimpleGrid>
        <Paper className="metric" p="lg" radius="lg" mt="md">
          <Group justify="space-between" mb="sm"><Text fw={700}>Asset allocation</Text><Text size="sm" c="dimmed">Cash interest/year: Gross {money(item.gross_revenue_minor, item.currency)} · Net {money(item.net_revenue_minor, item.currency)}</Text></Group>
          <AllocationBar total={item.total_minor} segments={[{ label: 'Cash', value: item.balance_minor }, ...allocations.map(allocation => ({ label: label(allocation.asset_class), value: allocation.value_minor }))]} />
        </Paper>
      </Box>
    )})}
    <SnapshotHistory snapshots={data.snapshots} currency={data.summary.base_currency} reload={reload} />
  </Stack>;
}

function SnapshotHistory({ snapshots, currency, reload }: { snapshots: Snapshot[]; currency: string; reload: () => Promise<void> }) {
  const [observedOn, setObservedOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false); const [editing, setEditing] = useState<Snapshot>(); const [error, setError] = useState('');
  const table = useBackendRows('/api/snapshots', snapshots);
  const current = snapshots.filter(item => item.currency === currency).sort((a, b) => a.observed_on.localeCompare(b.observed_on));
  const remove = async (snapshot: Snapshot) => { if (confirmDelete('snapshot', snapshot.observed_on, 'Every currency stored for this date will be removed.')) { try { await api(`/api/snapshots/${snapshot.id}`, { method: 'DELETE' }); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } } };
  const columns: DataColumn<Snapshot>[] = [
    { key: 'date', label: 'Date', sortable: true, render: item => new Date(`${item.observed_on}T00:00:00`).toLocaleDateString() },
    { key: 'currency', label: 'Currency', sortable: true, render: item => item.currency },
    { key: 'cash', label: 'Cash', sortable: true, render: item => money(item.cash_minor, item.currency) },
    { key: 'invested', label: 'Amount invested', sortable: true, render: item => investedMoney(item.invested_minor, item.portfolio_minor, item.currency) },
    { key: 'portfolio', label: 'Investments', sortable: true, render: item => money(item.portfolio_minor, item.currency) },
    { key: 'total', label: 'Total', sortable: true, render: item => <Text fw={700}>{money(item.total_minor, item.currency)}</Text> },
    { key: 'actions', render: item => <TableActions><TableAction label={`Edit ${item.observed_on} ${item.currency}`} onClick={() => setEditing(item)}>✎</TableAction><TableAction label={`Delete ${item.observed_on}`} color="red" onClick={() => void remove(item)}>×</TableAction></TableActions> },
  ];
  const save = async () => { setSaving(true); try { await api('/api/snapshots', { method: 'POST', body: JSON.stringify({ observed_on: observedOn }) }); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); } };
  return <Stack gap="md"><Group justify="space-between" align="end"><Box><Title order={3}>Wealth history</Title><Text c="dimmed">A snapshot copies every account's cash and investment holdings for that date.</Text></Box><Group align="end"><TextInput type="date" label="Snapshot date" value={observedOn} onChange={event => setObservedOn(event.currentTarget.value)} /><Button loading={saving} onClick={() => void save()}>Save snapshot</Button></Group></Group>
    {(error || table.sortError) && <Alert color="red">{error || table.sortError}</Alert>}
    {current.length > 1 ? <WealthChart snapshots={current} currency={currency} /> : current.length === 1 && <Alert color="gray">Save one more snapshot to see the wealth trend.</Alert>}
    {snapshots.length === 0 ? <Empty title="No snapshots yet" text="Update your balances and holdings, then save the current situation." /> : <DataTable rows={table.sort ? table.rows : [...table.rows].reverse()} columns={columns} rowKey={item => `${item.id}-${item.currency}`} minWidth={820} sort={table.sort} direction={table.direction} onSort={(key, direction) => void table.sortRows(key, direction)} />}
    <SnapshotModal key={editing ? `${editing.id}-${editing.currency}` : 'closed'} snapshot={editing} close={() => setEditing(undefined)} saved={async () => { setEditing(undefined); await reload(); }} />
  </Stack>;
}

function SnapshotModal({ snapshot, close, saved }: { snapshot?: Snapshot; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState<{ date: string; cash: Numeric; invested: Numeric; portfolio: Numeric }>(() => snapshot ? { date: snapshot.observed_on, cash: snapshot.cash_minor / 100, invested: snapshot.invested_minor / 100, portfolio: snapshot.portfolio_minor / 100 } : { date: '', cash: 0, invested: 0, portfolio: 0 }); const [error, setError] = useState('');
  const save = async () => { if (!snapshot) return; try { await api(`/api/snapshots/${snapshot.id}`, { method: 'PUT', body: JSON.stringify({ observed_on: form.date, currency: snapshot.currency, cash_minor: minor(form.cash), invested_minor: minor(form.invested), portfolio_minor: minor(form.portfolio) }) }); await saved(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  return <Modal opened={Boolean(snapshot)} onClose={close} title="Correct snapshot"><Stack>{error && <Alert color="red">{error}</Alert>}<SimpleGrid cols={2}><TextInput type="date" label="Date" value={form.date} onChange={event => setForm({ ...form, date: event.currentTarget.value })} /><TextInput readOnly label="Currency" value={snapshot?.currency ?? ''} /><NumberInput min={0} decimalScale={2} label="Cash" value={form.cash} onChange={value => setForm({ ...form, cash: value })} /><NumberInput min={0} decimalScale={2} label="Amount invested" value={form.invested} onChange={value => setForm({ ...form, invested: value })} /><NumberInput min={0} decimalScale={2} label="Investments" value={form.portfolio} onChange={value => setForm({ ...form, portfolio: value })} /></SimpleGrid><Group justify="space-between"><Text size="sm" c="dimmed">Corrected total</Text><Text fw={700}>{money(minor(form.cash) + minor(form.portfolio), snapshot?.currency ?? 'EUR')}</Text></Group><Text size="xs" c="dimmed">This replaces the stored per-account breakdown for this currency with the corrected totals.</Text><Group justify="end"><Button onClick={() => void save()}>Save correction</Button></Group></Stack></Modal>;
}

function WealthChart({ snapshots, currency }: { snapshots: Snapshot[]; currency: string }) {
  type MetricKey = 'total' | 'cash' | 'portfolio';
  const [metric, setMetric] = useState<MetricKey>('total');
  const metrics: Record<MetricKey, { label: string; value: (snapshot: Snapshot) => number }> = { total: { label: 'Total wealth', value: snapshot => snapshot.total_minor }, cash: { label: 'Cash', value: snapshot => snapshot.cash_minor }, portfolio: { label: 'Investments', value: snapshot => snapshot.portfolio_minor } };
  const selected = metrics[metric]; const values = snapshots.map(selected.value); const geometry = chartGeometry(values); const points = geometry.points.map(point => `${point.x},${point.y}`).join(' '); const first = values[0]; const latest = values.at(-1) ?? 0; const change = latest - first; const changePercent = first > 0 ? change / first * 100 : undefined;
  const dates = [0, Math.floor((snapshots.length - 1) / 2), snapshots.length - 1].filter((index, position, all) => all.indexOf(index) === position);
  return <Card className="metric" p="lg" radius="lg"><Group justify="space-between" align="start" mb="sm"><Box><Text fw={700}>{selected.label} over time</Text><Group gap="xs"><Text size="xl" fw={750}>{money(latest, currency)}</Text><Text size="sm" fw={700} c={change >= 0 ? 'teal' : 'red'}>{change >= 0 ? '+' : ''}{money(change, currency)}{changePercent === undefined ? '' : ` · ${change >= 0 ? '+' : ''}${changePercent.toFixed(1)}%`}</Text></Group></Box><SegmentedControl size="xs" value={metric} onChange={value => setMetric(value as MetricKey)} data={[{ value: 'total', label: 'Total' }, { value: 'cash', label: 'Cash' }, { value: 'portfolio', label: 'Investments' }]} /></Group><svg className="wealth-chart" viewBox="0 0 760 260" role="img" aria-label={`${selected.label} history`}>{[0, 1, 2, 3].map(index => { const ratio = index / 3; const y = 24 + ratio * 196; const value = geometry.high - ratio * (geometry.high - geometry.low); return <g key={index}><line x1="74" x2="740" y1={y} y2={y} stroke="currentColor" opacity="0.12" /><text x="66" y={y + 4} textAnchor="end">{new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100)}</text></g>; })}<defs><linearGradient id="wealth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--mantine-color-teal-5)" stopOpacity="0.34" /><stop offset="100%" stopColor="var(--mantine-color-teal-5)" stopOpacity="0.02" /></linearGradient></defs><path d={`M ${geometry.points[0].x} 220 L ${points.replaceAll(',', ' ')} L ${geometry.points.at(-1)?.x ?? 740} 220 Z`} fill="url(#wealth-fill)" /><polyline points={points} fill="none" stroke="var(--mantine-color-teal-5)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{geometry.points.map((point, index) => <circle key={snapshots[index].observed_on} cx={point.x} cy={point.y} r="4" fill="var(--mantine-color-body)" stroke="var(--mantine-color-teal-5)" strokeWidth="3"><title>{`${snapshots[index].observed_on}: ${money(values[index], currency)}`}</title></circle>)}{dates.map(index => <text key={index} x={geometry.points[index].x} y="248" textAnchor={index === 0 ? 'start' : index === snapshots.length - 1 ? 'end' : 'middle'}>{new Date(`${snapshots[index].observed_on}T00:00:00`).toLocaleDateString()}</text>)}</svg></Card>;
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

function PerformanceResult({ value, invested, currency, mood = false }: { value: number; invested: number; currency: string; mood?: boolean }) {
  if (invested <= 0) return <Text size="sm" c="dimmed">—</Text>;
  const change = value - invested; const changePercent = change / invested * 100; const state = performanceMood(changePercent);
  return <Group gap={6} wrap="nowrap" align="center">{mood && <Text title={state.label} size="lg" lh={1}>{state.emoji}</Text>}<Text size="sm" fw={700} c={change >= 0 ? 'teal' : 'red'}>{change >= 0 ? '+' : ''}{money(change, currency)} · {change >= 0 ? '+' : ''}{changePercent.toFixed(1)}%</Text></Group>;
}

function ThemeToggle() {
  const scheme = useComputedColorScheme('light'); const { setColorScheme } = useMantineColorScheme();
  return <Button variant="default" aria-label={`Use ${scheme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>{scheme === 'dark' ? '☀ Light' : '☾ Dark'}</Button>;
}

function AllocationBar({ segments, total }: { segments: { label: string; value: number }[]; total: number }) {
  const visible = segments.filter(segment => segment.value > 0);
  return <><Box h={14} bg="gray.1" mt="sm" style={{ display: 'flex', overflow: 'hidden', borderRadius: 999 }}>{visible.map(segment => <Box key={segment.label} bg={`${chipColor(segment.label)}.5`} style={{ width: `${total > 0 ? segment.value / total * 100 : 0}%` }} />)}</Box><Group gap="xs" mt="sm">{visible.map(segment => <Chip key={segment.label} colorKey={segment.label}>{`${segment.label} ${total > 0 ? (segment.value / total * 100).toFixed(1) : '0.0'}%`}</Chip>)}</Group></>;
}

type TierDraft = { upTo: Numeric; kind: 'fixed' | 'reference'; rate: Numeric; reference: string; spread: Numeric };
type AccountDraft = { name: string; institution: string; type: Account['type']; preferred: boolean; archived: boolean; currency: string; balance: Numeric; tax: Numeric; fee: Numeric; tiers: TierDraft[] };
const blankTier = (): TierDraft => ({ upTo: '', kind: 'fixed', rate: 0, reference: '', spread: 0 });
const blankAccount = (tax = 26): AccountDraft => ({ name: '', institution: '', type: 'bank', preferred: false, archived: false, currency: 'EUR', balance: 0, tax, fee: 0, tiers: [blankTier()] });

function Accounts({ accounts, rates, taxRates, reload }: { accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Account>();
  const [error, setError] = useState('');
  const table = useBackendRows('/api/accounts', accounts, 'total', 'desc');
  const open = (account?: Account) => { setEditing(account); setOpened(true); };
  const remove = async (account: Account) => { if (confirmDelete('account', account.name, 'Its current holdings will also be removed. Saved snapshots stay intact.')) { await api(`/api/accounts/${account.id}`, { method: 'DELETE' }); await reload(); } };
  const toggleArchived = async (account: Account) => { try { await api(`/api/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ ...account, archived: !account.archived }) }); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const columns: DataColumn<Account>[] = [
    { key: 'name', label: 'Account', sortable: true, render: account => <Stack gap={4}><Group gap={6} wrap="nowrap"><Text fw={650}>{account.name}</Text>{account.preferred && <Chip size="xs">Default</Chip>}{account.archived && <Chip size="xs" colorKey="Archived">Archived</Chip>}</Group><Group gap={5}><Chip size="xs">{account.type}</Chip>{account.institution && <Text size="xs" c="dimmed">{account.institution}</Text>}</Group></Stack> },
    { key: 'total', label: 'Assets', sortable: true, render: account => <AccountAssets account={account} /> },
    { key: 'per_year', label: 'Projected interest', sortable: true, render: account => <Group gap="lg" wrap="nowrap">{[['Day', 365], ['Month', 12], ['Year', 1]].map(([label, divisor]) => <Box key={label} miw={94}><Text size="xs" c="dimmed" fw={650} mb={3}>{label}</Text><RevenuePeriod account={account} divisor={Number(divisor)} /></Box>)}</Group> },
    { key: 'rates', label: 'Rates', render: account => <Stack gap={5}><Group gap={5}>{(account.tiers ?? []).map((tier, index) => <Chip key={index} colorKey="Rate">{percent(tier.resolved_rate_bps ?? 0)}</Chip>)}</Group><Group><Chip colorKey="Tax">{`Tax ${percent(account.tax_bps)}`}</Chip></Group></Stack> },
    { key: 'actions', render: account => <TableActions><TableAction label={account.archived ? `Restore ${account.name}` : `Archive ${account.name}`} onClick={() => void toggleArchived(account)}>{account.archived ? '↺' : '⏸'}</TableAction><TableAction label={`Edit ${account.name}`} onClick={() => open(account)}>✎</TableAction><TableAction label={`Delete ${account.name}`} color="red" onClick={() => void remove(account)}>×</TableAction></TableActions> },
  ];
  return <Stack gap="lg">
    <Group justify="space-between"><Box><Title order={2}>Accounts</Title><Text c="dimmed">Marginal rate tiers, taxes, and recurring annual fees.</Text></Box><Button onClick={() => open()}>Add account</Button></Group>
    {(error || table.sortError) && <Alert color="red">{error || table.sortError}</Alert>}
    {accounts.length === 0 ? <Empty title="No accounts" text="Add the places where you hold cash." /> : <DataTable rows={table.rows} columns={columns} rowKey={account => account.id} minWidth={960} sort={table.sort} direction={table.direction} onSort={(key, direction) => void table.sortRows(key, direction)} rowStyle={account => account.archived ? { opacity: 0.48 } : undefined} />}
    <AccountModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} account={editing} rates={rates} taxRates={taxRates} saved={async () => { setOpened(false); await reload(); }} />
  </Stack>;
}

function AccountAssets({ account }: { account: Account }) {
  return <Stack gap={3} miw={165}>
    <Group justify="space-between" gap="md" wrap="nowrap"><Text size="xs" c="dimmed">Cash</Text><Text size="sm">{money(account.balance_minor, account.currency)}</Text></Group>
    <Group justify="space-between" gap="md" wrap="nowrap"><Text size="xs" c="dimmed">Investments{account.holding_count ? ` (${account.holding_count})` : ''}</Text><Text size="sm" c={account.holding_count ? undefined : 'dimmed'}>{account.holding_count ? money(account.holdings_value_minor, account.currency) : '—'}</Text></Group>
    <Group justify="space-between" gap="md" wrap="nowrap"><Text size="xs" fw={700}>Total</Text><Text size="sm" fw={700}>{money(account.total_assets_minor, account.currency)}</Text></Group>
  </Stack>;
}

function RevenuePeriod({ account, divisor }: { account: Account; divisor: number }) {
  const gross = account.gross_revenue_minor / divisor;
  const net = account.net_revenue_minor / divisor;
  if (Math.abs(gross) < 0.5 && Math.abs(net) < 0.5) return <Text c="dimmed" opacity={0.55}>—</Text>;
  return <Stack gap={1}><Text size="xs" c="dimmed">Gross {money(gross, account.currency)}</Text><Text size="sm" fw={650} className="positive">Net {money(net, account.currency)}</Text></Stack>;
}

function AccountModal({ opened, close, account, rates, taxRates, saved }: { opened: boolean; close: () => void; account?: Account; rates: ReferenceRate[]; taxRates: TaxRate[]; saved: () => Promise<void> }) {
  const [form, setForm] = useState<AccountDraft>(() => account ? {
    name: account.name, institution: account.institution, type: account.type ?? 'other', preferred: account.preferred, archived: account.archived, currency: account.currency, balance: account.balance_minor / 100,
    tax: account.tax_bps / 100, fee: account.annual_fee_minor / 100,
    tiers: (account.tiers ?? []).map(tier => ({ upTo: tier.up_to_minor === null ? '' : tier.up_to_minor / 100, kind: tier.fixed_rate_bps === null ? 'reference' : 'fixed', rate: (tier.fixed_rate_bps ?? 0) / 100, reference: tier.reference_code ?? '', spread: tier.spread_bps / 100 })),
  } : blankAccount((taxRates[0]?.rate_bps ?? 2600) / 100));
  const [error, setError] = useState('');
  const tier = (index: number, patch: Partial<TierDraft>) => setForm(current => ({ ...current, tiers: current.tiers.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const save = async () => {
    try {
      const body = {
        name: form.name, institution: form.institution, type: form.type, preferred: form.preferred, archived: form.archived, currency: form.currency.toUpperCase(), balance_minor: minor(form.balance), tax_bps: bps(form.tax), annual_fee_minor: minor(form.fee),
        tiers: form.tiers.map(item => ({ up_to_minor: item.upTo === '' ? null : minor(item.upTo), fixed_rate_bps: item.kind === 'fixed' ? bps(item.rate) : null, reference_code: item.kind === 'reference' ? item.reference : '', spread_bps: item.kind === 'reference' ? bps(item.spread) : 0 })),
      };
      await api(account ? `/api/accounts/${account.id}` : '/api/accounts', { method: account ? 'PUT' : 'POST', body: JSON.stringify(body) });
      await saved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <Modal opened={opened} onClose={close} title={account ? 'Edit account' : 'Add account'} size="lg">
    <Stack>{error && <Alert color="red">{error}</Alert>}<SimpleGrid cols={{ base: 1, sm: 2 }}>
      <TextInput required label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.currentTarget.value })} />
      <TextInput label="Institution" value={form.institution} onChange={e => setForm({ ...form, institution: e.currentTarget.value })} />
      <Select label="Account type" value={form.type} data={[{ value: 'bank', label: 'Bank' }, { value: 'broker', label: 'Broker' }, { value: 'other', label: 'Other' }]} onChange={value => setForm({ ...form, type: (value ?? 'other') as Account['type'] })} />
      <TextInput required maxLength={3} label="Currency" value={form.currency} onChange={e => setForm({ ...form, currency: e.currentTarget.value })} />
      <NumberInput label="Current cash balance" min={0} decimalScale={2} value={form.balance} onChange={value => setForm({ ...form, balance: value })} />
      <Select label="Tax preset" placeholder="Choose a configured rate" data={taxRates.map(item => ({ value: String(item.rate_bps), label: `${item.label} (${percent(item.rate_bps)})` }))} onChange={value => value && setForm({ ...form, tax: Number(value) / 100 })} />
      <NumberInput label="Tax on interest (%)" min={0} max={100} decimalScale={2} value={form.tax} onChange={value => setForm({ ...form, tax: value })} />
      <NumberInput label="Annual account fee" min={0} decimalScale={2} value={form.fee} onChange={value => setForm({ ...form, fee: value })} />
      <Checkbox label="Preferred account for new holdings" checked={form.preferred} disabled={form.archived} onChange={event => setForm({ ...form, preferred: event.currentTarget.checked })} />
      <Checkbox label="Archived account" checked={form.archived} onChange={event => setForm({ ...form, archived: event.currentTarget.checked, preferred: event.currentTarget.checked ? false : form.preferred })} />
    </SimpleGrid><Divider label="Interest tiers" />
      {form.tiers.map((item, index) => <Card key={index} withBorder padding="sm"><Grid align="end">
        <Grid.Col span={{ base: 12, sm: 3 }}><NumberInput label="Up to" placeholder="No limit" min={0} value={item.upTo} onChange={value => tier(index, { upTo: value })} /></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 3 }}><Select label="Rate type" value={item.kind} data={[{ value: 'fixed', label: 'Fixed' }, { value: 'reference', label: 'Reference' }]} onChange={value => tier(index, { kind: (value ?? 'fixed') as TierDraft['kind'] })} /></Grid.Col>
        <Grid.Col span={{ base: 10, sm: 5 }}>{item.kind === 'fixed' ? <NumberInput label="Annual rate (%)" decimalScale={2} value={item.rate} onChange={value => tier(index, { rate: value })} /> : <Group grow align="end"><Select label="Reference" value={item.reference} data={rates.map(rate => ({ value: rate.code, label: `${rate.label} (${percent(rate.rate_bps)})` }))} onChange={value => tier(index, { reference: value ?? '' })} /><NumberInput label="Spread (%)" decimalScale={2} value={item.spread} onChange={value => tier(index, { spread: value })} /></Group>}</Grid.Col>
        <Grid.Col span={{ base: 2, sm: 1 }}><Tooltip label="Remove tier"><ActionIcon color="red" variant="subtle" aria-label="Remove tier" onClick={() => setForm(current => ({ ...current, tiers: current.tiers.filter((_, i) => i !== index) }))}>×</ActionIcon></Tooltip></Grid.Col>
      </Grid></Card>)}
      <Group justify="space-between"><Button variant="light" onClick={() => setForm(current => ({ ...current, tiers: [...current.tiers, blankTier()] }))}>Add tier</Button><Button onClick={() => void save()}>Save account</Button></Group>
    </Stack>
  </Modal>;
}

type HoldingDraft = { accountID: string; instrumentID: string; value: Numeric; sinceBuy: Numeric; planned: Numeric; tax: Numeric };

function Holdings({ holdings, accounts, instruments, taxRates, reload }: { holdings: Holding[]; accounts: Account[]; instruments: Instrument[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  const [opened, setOpened] = useState(false); const [editing, setEditing] = useState<Holding>(); const [error, setError] = useState('');
  const [accountIDs, setAccountIDs] = useState<string[]>([]);
  const table = useBackendRows('/api/holdings', holdings, 'value', 'desc');
  const activeAccounts = accounts.filter(account => !account.archived); const activeAccountIDs = new Set(activeAccounts.map(account => account.id));
  const open = (holding?: Holding) => { setEditing(holding); setOpened(true); };
  const remove = async (holding: Holding) => { if (confirmDelete('holding', `${holding.instrument_name} · ${holding.account_name}`)) { try { await api(`/api/holdings/${holding.id}`, { method: 'DELETE' }); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } } };
  const ready = activeAccounts.length > 0 && instruments.length > 0;
  const activeHoldings = table.rows.filter(holding => activeAccountIDs.has(holding.account_id));
  const visibleHoldings = activeHoldings.filter(holding => accountIDs.length === 0 || accountIDs.includes(String(holding.account_id)));
  const totals = new Map<string, { value: number; invested: number; count: number; classes: Map<string, number> }>();
  for (const holding of visibleHoldings) {
    const currency = holding.currency ?? 'EUR'; const summary = totals.get(currency) ?? { value: 0, invested: 0, count: 0, classes: new Map<string, number>() }; const assetClass = holding.asset_class || 'other';
    summary.value += holding.value_minor; summary.invested += holding.invested_minor; summary.count++; summary.classes.set(assetClass, (summary.classes.get(assetClass) ?? 0) + holding.value_minor); totals.set(currency, summary);
  }
  const actualBPS = (holding: Holding) => { const total = totals.get(holding.currency ?? 'EUR')?.value ?? 0; return total > 0 ? Math.round(holding.value_minor * 10_000 / total) : 0; };
  const columns: DataColumn<Holding>[] = [
    { key: 'account', label: 'Account', sortable: true, render: holding => <><Text fw={650}>{holding.account_name}</Text><Text size="xs" c="dimmed">{holding.currency}</Text></> },
    { key: 'instrument', label: 'Instrument', sortable: true, render: holding => <><Text fw={650}>{holding.instrument_name}</Text><Text size="xs" c="dimmed">{[holding.instrument_ticker, holding.instrument_isin].filter(Boolean).join(' · ')}</Text></> },
    { key: 'type', label: 'Type', sortable: true, render: holding => <Chip>{instrumentLabels[holding.instrument_type ?? 'other']}</Chip> },
    { key: 'asset_class', label: 'Asset class', sortable: true, render: holding => <Chip>{label(holding.asset_class || 'other')}</Chip> },
    { key: 'value', label: 'Current value', sortable: true, render: holding => <Text fw={650}>{money(holding.value_minor, holding.currency ?? 'EUR')}</Text> },
    { key: 'actual', label: 'Actual', sortable: true, render: holding => percent(actualBPS(holding)) },
    { key: 'planned', label: 'Planned', sortable: true, render: holding => holding.planned_bps > 0 ? percent(holding.planned_bps) : '—' },
    { key: 'invested', label: 'Amount invested', sortable: true, render: holding => investedMoney(holding.invested_minor, holding.value_minor, holding.currency ?? 'EUR') },
    { key: 'change', label: 'Gain / loss', sortable: true, render: holding => { if (holding.invested_minor === 0) return <Text c="dimmed">—</Text>; const change = holding.value_minor - holding.invested_minor; return <Stack gap={1}><Text fw={650} c={change >= 0 ? 'teal' : 'red'}>{money(change, holding.currency ?? 'EUR')}</Text><Text size="xs" c="dimmed">{change >= 0 ? '+' : ''}{(change / holding.invested_minor * 100).toFixed(1)}%</Text></Stack>; } },
    { key: 'tax', label: 'Tax', sortable: true, render: holding => percent(holding.tax_bps) },
    { key: 'actions', render: holding => <TableActions><TableAction label={`Edit ${holding.instrument_name}`} onClick={() => open(holding)}>✎</TableAction><TableAction label={`Delete ${holding.instrument_name}`} color="red" onClick={() => void remove(holding)}>×</TableAction></TableActions> },
  ];
  const [investOpened, setInvestOpened] = useState(false);
  return <Stack gap="lg"><Group justify="space-between"><Box><Title order={2}>Holdings</Title><Text c="dimmed">Actual allocation uses current holding values within each currency; planned allocation is your target.</Text></Box><Group gap="sm"><Button variant="light" color="teal" disabled={!ready} onClick={() => setInvestOpened(true)}>Invest & Rebalance</Button><Button disabled={!ready} onClick={() => open()}>Add holding</Button></Group></Group>
    {(error || table.sortError) && <Alert color="red">{error || table.sortError}</Alert>}
    {activeHoldings.length > 0 && <><MultiSelect w="100%" maw={360} searchable clearable label="Accounts" placeholder="All accounts" value={accountIDs} data={activeAccounts.map(account => ({ value: String(account.id), label: account.name }))} onChange={setAccountIDs} />{visibleHoldings.length > 0 && <SimpleGrid cols={{ base: 1, md: Math.min(2, Math.max(1, totals.size)) }}>{[...totals].map(([currency, summary]) => <Card key={currency} className="metric" p="lg" radius="lg"><Group justify="space-between" align="start"><Box><Text size="xs" c="dimmed">Visible holdings · {currency}</Text><Text size="xl" fw={750}>{money(summary.value, currency)}</Text></Box><Text size="sm" c="dimmed">{summary.count} {summary.count === 1 ? 'holding' : 'holdings'}</Text></Group><Group justify="space-between" align="center" mt={5}><Text size="xs" c="dimmed">Invested {investedMoney(summary.invested, summary.value, currency)}</Text><PerformanceResult value={summary.value} invested={summary.invested} currency={currency} /></Group><AllocationBar total={summary.value} segments={[...summary.classes].map(([assetClass, value]) => ({ label: label(assetClass), value }))} /></Card>)}</SimpleGrid>}</>}
    {!ready ? <Empty title="Accounts and instruments required" text="Add an active account and an instrument before recording a holding." /> : activeHoldings.length === 0 ? <Empty title="No active holdings" text="Add an investment or restore an archived account." /> : visibleHoldings.length === 0 ? <Empty title="No matching holdings" text="Choose another account or clear the filter." /> : <DataTable rows={visibleHoldings} columns={columns} rowKey={holding => holding.id} minWidth={1080} sort={table.sort} direction={table.direction} onSort={(key, direction) => void table.sortRows(key, direction)} />}
    <HoldingModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} holding={editing} accounts={activeAccounts} instruments={instruments} taxRates={taxRates} saved={async () => { setOpened(false); await reload(); }} />
    <InvestModal opened={investOpened} onClose={() => setInvestOpened(false)} holdings={holdings} reload={reload} />
  </Stack>;
}

function HoldingModal({ opened, close, holding, accounts, instruments, taxRates, saved }: { opened: boolean; close: () => void; holding?: Holding; accounts: Account[]; instruments: Instrument[]; taxRates: TaxRate[]; saved: () => Promise<void> }) {
  const [form, setForm] = useState<HoldingDraft>(() => holding ? { accountID: String(holding.account_id), instrumentID: String(holding.instrument_id), value: holding.value_minor / 100, sinceBuy: holding.invested_minor ? (holding.value_minor - holding.invested_minor) / 100 : '', planned: holding.planned_bps / 100, tax: holding.tax_bps / 100 } : { accountID: String(accounts.find(item => item.preferred)?.id ?? accounts[0]?.id ?? ''), instrumentID: String(instruments[0]?.id ?? ''), value: 0, sinceBuy: '', planned: 0, tax: (taxRates[0]?.rate_bps ?? 2600) / 100 });
  const [error, setError] = useState('');
  const save = async () => { try { const value = minor(form.value); const invested = form.sinceBuy === '' ? 0 : value - minor(form.sinceBuy); if (invested < 0) throw new Error('Since-buy gain/loss cannot be greater than the current value'); const body = { account_id: Number(form.accountID), instrument_id: Number(form.instrumentID), invested_minor: invested, value_minor: value, planned_bps: bps(form.planned), tax_bps: bps(form.tax) }; await api(holding ? `/api/holdings/${holding.id}` : '/api/holdings', { method: holding ? 'PUT' : 'POST', body: JSON.stringify(body) }); await saved(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  return <Modal opened={opened} onClose={close} title={holding ? 'Edit holding' : 'Add holding'}><Stack>{error && <Alert color="red">{error}</Alert>}<Select searchable required label="Account" value={form.accountID} data={accounts.map(item => ({ value: String(item.id), label: `${item.name} · ${item.type}${item.preferred ? ' · default' : ''} · ${item.currency}` }))} onChange={value => setForm({ ...form, accountID: value ?? '' })} /><Select searchable required label="Instrument" nothingFoundMessage="No ticker, name, or ISIN match" value={form.instrumentID} data={instruments.map(item => ({ value: String(item.id), label: [item.ticker, item.name, instrumentLabels[item.instrument_type], item.isin].filter(Boolean).join(' · ') }))} onChange={value => setForm({ ...form, instrumentID: value ?? '' })} /><SimpleGrid cols={2}><NumberInput label="Current value" min={0} decimalScale={2} value={form.value} onChange={value => setForm({ ...form, value })} /><NumberInput label="Planned allocation (%)" min={0} max={100} decimalScale={2} value={form.planned} onChange={value => setForm({ ...form, planned: value })} /><NumberInput label="Since buy gain / loss (optional)" placeholder="Example: -0.85" decimalScale={2} value={form.sinceBuy} onChange={value => setForm({ ...form, sinceBuy: value })} /><NumberInput label="Applicable tax (%)" min={0} max={100} decimalScale={2} value={form.tax} onChange={value => setForm({ ...form, tax: value })} /></SimpleGrid><Text size="xs" c="dimmed">Enter the absolute money result, not the percentage. Amount invested is calculated automatically; individual PAC purchases are not needed.</Text><Select label="Tax preset" data={taxRates.map(item => ({ value: String(item.rate_bps), label: `${item.label} (${percent(item.rate_bps)})` }))} onChange={value => value && setForm({ ...form, tax: Number(value) / 100 })} /><Group justify="end"><Button onClick={() => void save()}>Save holding</Button></Group></Stack></Modal>;
}

type InstrumentDraft = Omit<Instrument, 'id' | 'ter_bps' | 'fund_size_million' | 'tracking_difference_bps' | 'tracking_error_bps'> & { ter: Numeric; size: Numeric; trackingDifference: Numeric; trackingError: Numeric };
const blankInstrument = (): InstrumentDraft => ({ isin: '', name: '', ticker: '', instrument_type: 'etf', provider: '', index_name: '', investment_focus: '', asset_class: '', strategy: 'broad', currency_hedged: false, starred: false, data_status: 'enriched', distribution: 'accumulating', replication: 'physical_full', domicile: 'IE', fund_currency: 'EUR', ter: 0.2, size: 0, inception_date: '', trackingDifference: '', trackingError: '', ucits: false, source_url: '' });

type InstrumentColumn = 'ticker' | 'isin' | 'type' | 'issuer' | 'assetClass' | 'exposure' | 'policy' | 'replication' | 'ter' | 'size' | 'domicile' | 'currency' | 'inception' | 'tracking' | 'enriched';
type InstrumentFilters = { issuer: string; type: string; assetClass: string; policy: string; replication: string; domicile: string; currency: string; ucits: string };
type EnrichmentMode = 'missing' | 'discover' | 'oldest';
type EnrichmentProgress = { mode: EnrichmentMode; phase: string; current?: string; processed: number; total: number; available?: number; enriched: number; skipped: number; failed: number; done: boolean; error?: string };
const instrumentColumns: { value: InstrumentColumn; label: string }[] = [
  { value: 'ticker', label: 'Ticker' }, { value: 'isin', label: 'ISIN' }, { value: 'type', label: 'Type' }, { value: 'issuer', label: 'Issuer' },
  { value: 'assetClass', label: 'Asset class' }, { value: 'exposure', label: 'Exposure' }, { value: 'policy', label: 'Policy' },
  { value: 'replication', label: 'Replication' }, { value: 'ter', label: 'TER' }, { value: 'size', label: 'Size' }, { value: 'domicile', label: 'Domicile' },
  { value: 'currency', label: 'Currency' }, { value: 'inception', label: 'Inception' }, { value: 'tracking', label: 'Tracking' }, { value: 'enriched', label: 'Last refreshed' },
];
const defaultInstrumentColumns: InstrumentColumn[] = ['ticker', 'isin', 'type', 'issuer', 'exposure', 'policy', 'replication', 'ter', 'size'];

function savedInstrumentColumns(): InstrumentColumn[] {
  try {
    const raw = localStorage.getItem('loot.instrumentColumns.v2') ?? localStorage.getItem('port.instrumentColumns.v2');
    if (raw === null) return defaultInstrumentColumns;
    const saved = JSON.parse(raw) as string[];
    const valid = saved.filter((value): value is InstrumentColumn => instrumentColumns.some(column => column.value === value));
    return valid;
  } catch { return defaultInstrumentColumns; }
}

const replicationLabel = (value: Instrument['replication']) => ({ physical_full: 'Physical full', physical_sampling: 'Physical sampling', synthetic: 'Synthetic' })[value];
const productLabel = (instrument: Instrument) => instrument.instrument_type === 'etf' ? `${instrument.ucits ? 'UCITS' : 'Non-UCITS'} ETF` : instrument.instrument_type === 'etc' || instrument.instrument_type === 'etn' ? `Non-UCITS ${instrumentLabels[instrument.instrument_type]}` : instrumentLabels[instrument.instrument_type];
const policyChip = (instrument: Instrument) => <Tooltip label={instrument.distribution === 'accumulating' ? 'Accumulating' : 'Distributing'}><Chip>{instrument.distribution === 'accumulating' ? 'Acc' : 'Dist'}</Chip></Tooltip>;
type CatalogRow = RankedInstrument & { similarity?: InstrumentAlternative };

function InstrumentFinder({ instruments, reload }: { instruments: Instrument[]; reload: () => Promise<void> }) {
  const [opened, setOpened] = useState(false); const [editing, setEditing] = useState<Instrument>(); const [ranked, setRanked] = useState<RankedInstrument[]>([]); const [error, setError] = useState('');
  const [lookupQuery, setLookupQuery] = useState(''); const [lookingUp, setLookingUp] = useState(false);
  const [searchResults, setSearchResults] = useState<Instrument[]>([]); const [selected, setSelected] = useState<string[]>([]); const [searching, setSearching] = useState(false); const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false); const [enriching, setEnriching] = useState(false); const [notice, setNotice] = useState(''); const [localQuery, setLocalQuery] = useState('');
  const [streamController, setStreamController] = useState<AbortController>(); const [streamProgress, setStreamProgress] = useState<EnrichmentProgress>();
  const [visibleColumns, setVisibleColumns] = useState<InstrumentColumn[]>(savedInstrumentColumns); const [columnsOpen, setColumnsOpen] = useState(false); const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<InstrumentFilters>({ issuer: '', type: '', assetClass: '', policy: '', replication: '', domicile: '', currency: '', ucits: '' });
  const [similarity, setSimilarity] = useState(() => (new URLSearchParams(window.location.search).get('similarity') ?? '').toUpperCase()); const [alternatives, setAlternatives] = useState<InstrumentAlternative[]>([]); const [loadingAlternatives, setLoadingAlternatives] = useState(false); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(50);
  const [indexQuery, setIndexQuery] = useState('');
  const [distribution, setDistribution] = useState(''); const [replication, setReplication] = useState(''); const [domicile, setDomicile] = useState('');
  const [maxTER, setMaxTER] = useState<Numeric>(''); const [minSize, setMinSize] = useState<Numeric>(100); const [minAge, setMinAge] = useState<Numeric>(3);
  const catalog = useBackendRows('/api/instruments', instruments);
  const setSimilarityFilter = (isin = '') => {
    const params = new URLSearchParams(window.location.search);
    if (isin) params.set('similarity', isin); else params.delete('similarity');
    window.history.pushState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
    setSimilarity(isin); setRanked([]); setPage(1);
  };
  const rank = async () => { try { const result = await api<RankedInstrument[]>('/api/instruments/rank', { method: 'POST', body: JSON.stringify({ index_query: indexQuery, distribution, replications: replication ? [replication] : [], domiciles: domicile ? domicile.split(',').map(value => value.trim().toUpperCase()).filter(Boolean) : [], max_ter_bps: maxTER === '' ? null : bps(maxTER), min_fund_size_million: n(minSize), min_age_years: n(minAge), weights: { cost: 35, tracking_difference: 30, tracking_error: 15, size: 15, age: 5 } }) }); setSimilarityFilter(); setRanked(result ?? []); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const lookup = async (query = lookupQuery) => { if (!query.trim()) return; setLookingUp(true); try { await api<Instrument>('/api/instruments/lookup', { method: 'POST', body: JSON.stringify({ query }) }); setLookupQuery(''); setRanked([]); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setLookingUp(false); } };
  const search = async () => { if (!lookupQuery.trim()) return; setSearching(true); try { const result = await api<Instrument[]>(`/api/instruments/search?q=${encodeURIComponent(lookupQuery)}`); setSearchResults(result ?? []); setSelected((result ?? []).map(item => item.isin)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSearching(false); } };
  const importSelected = async () => { if (selected.length === 0) return; setImporting(true); try { await api<Instrument[]>('/api/instruments/import', { method: 'POST', body: JSON.stringify({ isins: selected }) }); setSearchResults([]); setSelected([]); setLookupQuery(''); setRanked([]); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setImporting(false); } };
  const syncCatalog = async () => { setSyncing(true); try { const result = await api<{ saved: number; available: number }>('/api/instruments/catalog/sync', { method: 'POST', body: JSON.stringify({ limit: 4000 }) }); setNotice(`Saved ${result.saved.toLocaleString()} UCITS ETFs from ${result.available.toLocaleString()} screener results.`); setError(''); setRanked([]); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSyncing(false); } };
  const enrichCatalog = async () => { setEnriching(true); try { const result = await api<{ enriched: number; failed: number }>('/api/instruments/catalog/enrich', { method: 'POST', body: JSON.stringify({ limit: 20 }) }); setNotice(`Refreshed ${result.enriched} product profiles${result.failed ? `; ${result.failed} failed and can be retried` : ''}.`); setError(''); setRanked([]); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setEnriching(false); } };
  const streamEnrichment = async (mode: EnrichmentMode) => {
    const controller = new AbortController(); setStreamController(controller); setStreamProgress({ mode, phase: 'loading', processed: 0, total: 0, enriched: 0, skipped: 0, failed: 0, done: false }); setNotice(''); setError('');
    try {
      let latest: EnrichmentProgress | undefined;
      for await (const res of instrumentClient.streamInstrumentCatalog({ mode }, { signal: controller.signal })) {
        latest = {
          mode: res.mode,
          phase: res.phase,
          current: res.current ?? undefined,
          processed: res.processed,
          total: res.total,
          available: res.available ?? undefined,
          enriched: res.enriched,
          skipped: res.skipped,
          failed: res.failed,
          done: res.done,
          error: res.error ?? undefined,
        };
        setStreamProgress(latest);
        if (latest.error) throw new Error(latest.error);
      }
      if (latest) setNotice(`Finished: ${latest.enriched} refreshed, ${latest.skipped} non-UCITS skipped, ${latest.failed} failed.`);
      setRanked([]); await reload();
    } catch (cause) {
      if (cause instanceof Error && (cause.name === 'AbortError' || cause.message.includes('canceled'))) { setNotice('Refresh stopped. Completed profiles were saved; the next run will resume from the remaining or oldest records.'); setRanked([]); await reload(); }
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setStreamController(current => current === controller ? undefined : current); }
  };
  const showAlternatives = (instrument: Instrument) => setSimilarityFilter(instrument.isin);
  const star = async (instrument: Instrument) => { try { await api(`/api/instruments/${encodeURIComponent(instrument.isin)}/star`, { method: 'PUT', body: JSON.stringify({ starred: !instrument.starred }) }); setRanked([]); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const remove = async (instrument: Instrument) => { if (confirmDelete('instrument', `${instrument.ticker || instrument.name} · ${instrument.isin}`, 'Remove its holdings first if this instrument is currently owned.')) { try { await api(`/api/instruments/${instrument.id}`, { method: 'DELETE' }); setRanked([]); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } } };
  const open = (instrument?: Instrument) => { setEditing(instrument); setOpened(true); };
  const refreshedCount = instruments.filter(instrument => instrument.data_status === 'enriched').length;
  const rankableCount = instruments.filter(instrument => instrument.instrument_type === 'etf' && instrument.data_status === 'enriched' && instrument.ucits).length;
  const nonUCITSCount = instruments.filter(instrument => !instrument.ucits).length;
  const issuerOptions = [...new Set(instruments.flatMap(instrument => instrument.provider ? [instrument.provider] : []))].sort();
  const domicileOptions = [...new Set(instruments.flatMap(instrument => instrument.domicile ? [instrument.domicile] : []))].sort();
  const currencyOptions = [...new Set(instruments.map(instrument => instrument.fund_currency).filter(Boolean))].sort();
  const similarTo = instruments.find(instrument => instrument.isin === similarity);
  const rows: CatalogRow[] = similarity ? alternatives.map(item => ({ instrument: item.instrument, total: -1, cost: 0, tracking_difference: 0, tracking_error: 0, size: 0, age: 0, similarity: item })) : ranked.length > 0 ? ranked : catalog.rows.map(instrument => ({ instrument, total: -1, cost: 0, tracking_difference: 0, tracking_error: 0, size: 0, age: 0 }));
  const query = localQuery.trim().toLowerCase();
  const matchingRows = rows.filter(({ instrument }) =>
    (!query || [instrument.name, instrument.ticker, instrument.isin, instrument.provider, instrument.index_name, instrument.investment_focus, instrument.asset_class, instrument.instrument_type].some(value => value?.toLowerCase().includes(query))) &&
    matchesExactFilters({ issuer: instrument.provider ?? '', type: instrument.instrument_type, assetClass: instrument.asset_class ?? '', policy: instrument.distribution, replication: instrument.replication, domicile: instrument.domicile ?? '', currency: instrument.fund_currency, ucits: instrument.ucits }, filters));
  const [localSortKey, setLocalSortKey] = useState<string>('');
  const [localSortDir, setLocalSortDir] = useState<SortDirection>('asc');
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const getRowSortValue = (row: CatalogRow, key: string): any => {
    const inst = row.instrument;
    switch (key) {
      case 'starred': return inst.starred ? 1 : 0;
      case 'score': return row.total;
      case 'similarity': return row.similarity?.better ? 2 : row.similarity?.match === 'exact_index' ? 1 : 0;
      case 'name': return (inst.name || '').toLowerCase();
      case 'ticker': return (inst.ticker || '').toLowerCase();
      case 'isin': return inst.isin || '';
      case 'type': return inst.instrument_type || '';
      case 'issuer': return (inst.provider || '').toLowerCase();
      case 'asset_class':
      case 'assetClass': return inst.asset_class || '';
      case 'exposure': return (inst.index_name || inst.investment_focus || '').toLowerCase();
      case 'policy': return inst.distribution || '';
      case 'replication': return inst.replication || '';
      case 'ter': return inst.ter_bps;
      case 'size': return inst.fund_size_million;
      case 'domicile': return inst.domicile || '';
      case 'currency': return inst.fund_currency || '';
      case 'inception': return inst.inception_date || '';
      case 'tracking': return inst.tracking_difference_bps ?? 999999;
      case 'enriched': return inst.enriched_at || '';
      default: return 0;
    }
  };
  const sortedRows = [...matchingRows];
  if ((ranked.length > 0 || similarity) && localSortKey) {
    sortedRows.sort((a, b) => {
      const valA = getRowSortValue(a, localSortKey);
      const valB = getRowSortValue(b, localSortKey);
      let comp = 0;
      if (typeof valA === 'string' && typeof valB === 'string') {
        comp = valA.localeCompare(valB);
      } else {
        comp = (valA ?? 0) < (valB ?? 0) ? -1 : (valA ?? 0) > (valB ?? 0) ? 1 : 0;
      }
      return localSortDir === 'desc' ? -comp : comp;
    });
  }
  const bounds = pageBounds(sortedRows.length, page, pageSize);
  const visibleRows = sortedRows.slice(bounds.start, bounds.end);
  const [selectedCompareISINs, setSelectedCompareISINs] = useState<string[]>([]);
  const [compareModalOpened, setCompareModalOpened] = useState(false);
  const selectedCompareInstruments = instruments.filter(i => selectedCompareISINs.includes(i.isin));

  const streamLabel = streamProgress?.mode === 'discover' ? 'Discovering remaining UCITS ETFs' : streamProgress?.mode === 'oldest' ? 'Refreshing oldest profiles first' : 'Refreshing missing profiles';
  const show = (column: InstrumentColumn) => visibleColumns.includes(column);
  const toggleColumn = (column: InstrumentColumn) => setVisibleColumns(current => current.includes(column) ? current.filter(item => item !== column) : [...current, column]);
  const searchColumns: DataColumn<Instrument>[] = [
    { key: 'select', render: item => <Checkbox aria-label={`Select ${item.name}`} checked={selected.includes(item.isin)} onChange={event => setSelected(current => event.currentTarget.checked ? [...current, item.isin] : current.filter(isin => isin !== item.isin))} /> },
    { key: 'instrument', label: 'Product', render: item => <><Text fw={650}>{item.name}</Text><Group gap={5} mt={3}><Chip size="xs">{productLabel(item)}</Chip><Text size="xs" c="dimmed">{[item.ticker, item.isin, item.domicile].filter(Boolean).join(' · ')}</Text></Group></> },
    { key: 'policy', label: 'Policy', render: item => policyChip(item) },
    { key: 'replication', label: 'Replication', render: item => replicationLabel(item.replication) },
    { key: 'ter', label: 'TER', render: item => percent(item.ter_bps) },
    { key: 'size', label: 'Size', render: item => `${item.fund_size_million.toLocaleString()}m` },
    { key: 'actions', render: item => <TableActions><TableAction label={`Open ${item.isin} on justETF`} href={item.source_url} disabled={!item.source_url}>↗</TableAction></TableActions> },
  ];
  const catalogColumns: DataColumn<CatalogRow>[] = [
    {
      key: 'select_compare',
      render: (item: CatalogRow) => (
        <Checkbox
          aria-label={`Select ${item.instrument.isin} for comparison`}
          checked={selectedCompareISINs.includes(item.instrument.isin)}
          onChange={e => {
            const isin = item.instrument.isin;
            setSelectedCompareISINs(curr =>
              e.currentTarget.checked ? [...curr, isin] : curr.filter(i => i !== isin)
            );
          }}
        />
      ),
    },
    { key: 'starred', sortable: true, render: item => <TableAction label={item.instrument.starred ? `Unstar ${item.instrument.isin}` : `Star ${item.instrument.isin}`} color="yellow" variant={item.instrument.starred ? 'light' : 'subtle'} onClick={() => void star(item.instrument)}>{item.instrument.starred ? '★' : '☆'}</TableAction> },
    ...(ranked.length > 0 ? [{ key: 'score', label: 'Score', sortable: true, render: (item: CatalogRow) => <Tooltip label={`Cost ${(item.cost * 100).toFixed(0)} · tracking diff ${(item.tracking_difference * 100).toFixed(0)} · tracking error ${(item.tracking_error * 100).toFixed(0)} · size ${(item.size * 100).toFixed(0)} · age ${(item.age * 100).toFixed(0)}`}><Chip size="lg" variant="filled" colorKey="Score">{item.total.toFixed(1)}</Chip></Tooltip> }] : []),
    ...(similarity ? [{ key: 'similarity', label: 'Similarity', sortable: true, render: (item: CatalogRow) => item.similarity ? <Stack gap={4}><Group gap={4}>{item.similarity.better && <Chip size="xs">Strictly better</Chip>}<Chip size="xs">{item.similarity.match === 'exact_index' ? 'Same index' : 'Same exposure'}</Chip></Group><Text size="xs" c="dimmed">{item.similarity.reasons.join(' · ')}</Text></Stack> : '—' }] : []),
    { key: 'name', label: 'Instrument', sortable: true, render: item => <><Text fw={650}>{item.instrument.name}</Text><Chip size="xs" mt={3}>{productLabel(item.instrument)}</Chip></> },
    ...(show('ticker') ? [{ key: 'ticker', label: 'Ticker', sortable: true, render: (item: RankedInstrument) => <Text fw={650}>{item.instrument.ticker || '—'}</Text> }] : []),
    ...(show('isin') ? [{ key: 'isin', label: 'ISIN', sortable: true, render: (item: RankedInstrument) => <Text size="sm" ff="monospace">{item.instrument.isin}</Text> }] : []),
    ...(show('type') ? [{ key: 'type', label: 'Type', sortable: true, render: (item: RankedInstrument) => <Chip>{instrumentLabels[item.instrument.instrument_type]}</Chip> }] : []),
    ...(show('issuer') ? [{ key: 'issuer', label: 'Issuer', sortable: true, render: (item: RankedInstrument) => item.instrument.provider || '—' }] : []),
    ...(show('assetClass') ? [{ key: 'asset_class', label: 'Asset class', sortable: true, render: (item: RankedInstrument) => item.instrument.asset_class ? <Chip>{label(item.instrument.asset_class)}</Chip> : '—' }] : []),
    ...(show('exposure') ? [{ key: 'exposure', label: 'Exposure', sortable: true, render: (item: RankedInstrument) => <><Text size="sm">{item.instrument.index_name || item.instrument.investment_focus || 'Profile not refreshed'}</Text><Group gap={4} mt={4}><Chip size="xs">{item.instrument.data_status === 'enriched' ? 'Refreshed' : 'Awaiting refresh'}</Chip>{item.instrument.asset_class && <Chip size="xs">{label(item.instrument.asset_class)}</Chip>}{item.instrument.currency_hedged && <Chip size="xs">Hedged</Chip>}</Group></> }] : []),
    ...(show('policy') ? [{ key: 'policy', label: 'Policy', sortable: true, render: (item: RankedInstrument) => policyChip(item.instrument) }] : []),
    ...(show('replication') ? [{ key: 'replication', label: 'Replication', sortable: true, render: (item: RankedInstrument) => <Text size="sm">{replicationLabel(item.instrument.replication)}</Text> }] : []),
    ...(show('ter') ? [{ key: 'ter', label: 'TER', sortable: true, render: (item: RankedInstrument) => percent(item.instrument.ter_bps) }] : []),
    ...(show('size') ? [{ key: 'size', label: 'Size', sortable: true, render: (item: RankedInstrument) => `${item.instrument.fund_size_million.toLocaleString()}m` }] : []),
    ...(show('domicile') ? [{ key: 'domicile', label: 'Domicile', sortable: true, render: (item: RankedInstrument) => item.instrument.domicile || '—' }] : []),
    ...(show('currency') ? [{ key: 'currency', label: 'Currency', sortable: true, render: (item: RankedInstrument) => item.instrument.fund_currency || '—' }] : []),
    ...(show('inception') ? [{ key: 'inception', label: 'Inception', sortable: true, render: (item: RankedInstrument) => item.instrument.inception_date || '—' }] : []),
    ...(show('tracking') ? [{ key: 'tracking', label: 'Tracking', sortable: true, render: (item: RankedInstrument) => item.instrument.tracking_difference_bps === null && item.instrument.tracking_error_bps === null ? <Text c="dimmed">—</Text> : <Stack gap={1}><Text size="sm">Diff {item.instrument.tracking_difference_bps === null ? '—' : percent(item.instrument.tracking_difference_bps)}</Text><Text size="xs" c="dimmed">Error {item.instrument.tracking_error_bps === null ? '—' : percent(item.instrument.tracking_error_bps)}</Text></Stack> }] : []),
    ...(show('enriched') ? [{ key: 'enriched', label: 'Last refreshed', sortable: true, render: (item: RankedInstrument) => <Text size="sm" c={item.instrument.enriched_at ? undefined : 'dimmed'}>{item.instrument.enriched_at ? new Date(item.instrument.enriched_at).toLocaleString() : '—'}</Text> }] : []),
    { key: 'actions', render: item => <TableActions><TableAction label={`Open ${item.instrument.isin} on justETF`} href={item.instrument.source_url} disabled={!item.instrument.source_url}>↗</TableAction><TableAction label={item.instrument.ucits && item.instrument.instrument_type === 'etf' ? `Find alternatives for ${item.instrument.isin}` : 'Alternatives are limited to comparable UCITS ETFs'} disabled={item.instrument.instrument_type !== 'etf' || item.instrument.data_status !== 'enriched' || !item.instrument.ucits || item.instrument.asset_class === 'other'} onClick={() => showAlternatives(item.instrument)}>≈</TableAction><TableAction label={`Refresh ${item.instrument.isin}`} disabled={lookingUp} onClick={() => void lookup(item.instrument.isin)}>↻</TableAction><TableAction label={`Edit ${item.instrument.isin}`} onClick={() => open(item.instrument)}>✎</TableAction><TableAction label={`Delete ${item.instrument.isin}`} color="red" onClick={() => void remove(item.instrument)}>×</TableAction></TableActions> },
  ];
  useEffect(() => { try { localStorage.setItem('loot.instrumentColumns.v2', JSON.stringify(visibleColumns)); } catch { /* preference persistence is optional */ } }, [visibleColumns]);
  useEffect(() => () => streamController?.abort(), [streamController]);
  useEffect(() => { setPage(1); }, [localQuery, filters, similarity, ranked, catalog.sort, catalog.direction, pageSize]);
  useEffect(() => {
    if (!similarity) { setAlternatives([]); setLoadingAlternatives(false); return; }
    if (!similarTo) { setAlternatives([]); setLoadingAlternatives(false); setError(`Similarity instrument ${similarity} is not in the local catalog`); return; }
    let active = true; setLoadingAlternatives(true);
    void api<InstrumentAlternative[]>(`/api/instruments/${similarTo.id}/alternatives`).then(result => { if (active) { setAlternatives(result ?? []); setError(''); } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (active) setLoadingAlternatives(false); });
    return () => { active = false; };
  }, [similarity, similarTo?.id]);
  return <Stack gap="lg"><Group justify="space-between"><Box><Title order={2}>Instrument finder</Title><Text c="dimmed">Store investments of any type locally. justETF lookup and comparison remain focused on exchange-traded products.</Text></Box><Button onClick={() => open()}>Add instrument</Button></Group>
    {(error || catalog.sortError) && <Alert color="red">{error || catalog.sortError}</Alert>}{notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
    <Paper className="metric" p="lg" radius="lg"><Group justify="space-between" align="end" wrap="wrap"><Box><Text fw={700}>Local catalog</Text><Text size="sm" c="dimmed">{instruments.length.toLocaleString()} instruments · {refreshedCount.toLocaleString()} refreshed · {nonUCITSCount.toLocaleString()} non-UCITS · {(instruments.length - refreshedCount).toLocaleString()} awaiting refresh</Text></Box><Group wrap="wrap"><Button variant="light" loading={syncing} disabled={Boolean(streamController)} onClick={() => void syncCatalog()}>Sync catalog</Button><Button variant="light" disabled={Boolean(streamController)} onClick={() => void streamEnrichment('discover')}>Discover remaining UCITS</Button><Button variant="light" loading={enriching} disabled={Boolean(streamController) || refreshedCount === instruments.length} onClick={() => void enrichCatalog()}>Refresh next 20</Button><Button disabled={Boolean(streamController) || instruments.length === 0} onClick={() => void streamEnrichment(refreshedCount < instruments.length ? 'missing' : 'oldest')}>Refresh all</Button>{streamController && <Button color="red" variant="light" onClick={() => streamController.abort()}>Stop</Button>}</Group></Group><Text size="xs" c="dimmed" mt="xs">Bulk sync and discovery stay UCITS-only; exact ticker/ISIN loads may add non-UCITS instruments. Refresh is rate-limited; after missing profiles are complete, the next run starts from the oldest.</Text>
      {streamProgress && <Box mt="md"><Group justify="space-between" mb={5}><Text size="sm" fw={650}>{streamLabel}</Text><Text size="sm" c="dimmed">{streamProgress.phase === 'loading' ? 'Loading screener…' : `${streamProgress.processed.toLocaleString()} / ${streamProgress.total.toLocaleString()}`}</Text></Group><Progress value={streamProgress.total ? streamProgress.processed / streamProgress.total * 100 : 0} animated={!streamProgress.done} striped={!streamProgress.done} /><Text size="xs" c="dimmed" mt={5}>{streamProgress.current ? `Current ${streamProgress.current} · ` : ''}{streamProgress.enriched} refreshed · {streamProgress.skipped} non-UCITS skipped · {streamProgress.failed} failed</Text></Box>}
    </Paper>
    <Paper className="metric" p="lg" radius="lg"><Group align="end" wrap="wrap"><TextInput style={{ flex: 1 }} label="Find products on justETF" placeholder="VWCE, SGLD, an ISIN, MSCI World…" value={lookupQuery} onChange={event => setLookupQuery(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void search(); }} /><Button variant="light" loading={searching} onClick={() => void search()}>Search many</Button><Button loading={lookingUp} onClick={() => void lookup()}>Load exact</Button></Group><Text size="xs" c="dimmed" mt="xs">Search and exact load accept UCITS ETFs and non-UCITS ETCs/ETNs. Non-UCITS products are clearly marked and excluded from ETF ranking.</Text></Paper>
    {searchResults.length > 0 && <DataTable rows={searchResults} columns={searchColumns} rowKey={item => item.isin} minWidth={850} toolbar={<Group justify="space-between" mb="sm"><Checkbox label={`Select all ${searchResults.length}`} checked={selected.length === searchResults.length} indeterminate={selected.length > 0 && selected.length < searchResults.length} onChange={event => setSelected(event.currentTarget.checked ? searchResults.map(item => item.isin) : [])} /><Button loading={importing} disabled={selected.length === 0} onClick={() => void importSelected()}>Import {selected.length} selected</Button></Group>} />}
    <Paper className="metric" p="lg" radius="lg"><SimpleGrid cols={{ base: 1, sm: 2, lg: 6 }}>
      <TextInput label="Index contains" placeholder="MSCI World" value={indexQuery} onChange={e => setIndexQuery(e.currentTarget.value)} />
      <Select label="Distribution" value={distribution} data={[{ value: '', label: 'Any' }, { value: 'accumulating', label: 'Accumulating' }, { value: 'distributing', label: 'Distributing' }]} onChange={value => setDistribution(value ?? '')} />
      <Select label="Replication" value={replication} data={[{ value: '', label: 'Any' }, { value: 'physical_full', label: 'Physical full' }, { value: 'physical_sampling', label: 'Physical sampling' }, { value: 'synthetic', label: 'Synthetic' }]} onChange={value => setReplication(value ?? '')} />
      <TextInput label="Domiciles" placeholder="IE, LU" value={domicile} onChange={e => setDomicile(e.currentTarget.value)} />
      <NumberInput label="Max TER (%)" placeholder="Any" min={0} decimalScale={2} value={maxTER} onChange={setMaxTER} />
      <NumberInput label="Min size (€m)" min={0} value={minSize} onChange={setMinSize} />
      <NumberInput label="Min age (years)" min={0} value={minAge} onChange={setMinAge} />
    </SimpleGrid><Button mt="md" onClick={() => void rank()}>Rank {rankableCount} refreshed UCITS ETFs</Button></Paper>
    {similarity && <Alert color="blue" title={similarTo ? `Similar to ${similarTo.ticker || similarTo.name}` : `Similarity filter: ${similarity}`} withCloseButton onClose={() => setSimilarityFilter()}>{loadingAlternatives ? 'Loading comparable instruments…' : `${alternatives.length} comparable instruments · remove this filter to return to the full catalog.`}</Alert>}
    {loadingAlternatives ? <Group justify="center" p="xl"><Loader /></Group> : rows.length === 0 ? <Empty title={similarity ? 'No comparable instruments' : 'No instrument data'} text={similarity ? 'Refresh more comparable profiles, then retry.' : 'Sync the justETF catalog, load one by ticker or ISIN, or add one manually.'} /> : <Stack gap="sm">
      {selectedCompareISINs.length > 0 && (
        <Paper p="xs" radius="md" withBorder bg="var(--mantine-color-teal-0)">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Badge color="teal" size="md">{selectedCompareISINs.length} Selected</Badge>
              <Text fw={600} size="sm">Select 2 to 5 instruments to compare side-by-side</Text>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                color="teal"
                disabled={selectedCompareISINs.length < 2 || selectedCompareISINs.length > 5}
                onClick={() => setCompareModalOpened(true)}
              >
                Compare {selectedCompareISINs.length} Selected Side-by-Side
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setSelectedCompareISINs([])}>
                Clear Selection
              </Button>
            </Group>
          </Group>
        </Paper>
      )}
      <DataTable rows={visibleRows} columns={catalogColumns} rowKey={item => item.instrument.id} minWidth={1100} sort={ranked.length > 0 || similarity ? localSortKey : catalog.sort} direction={ranked.length > 0 || similarity ? localSortDir : catalog.direction} onSort={(key, direction) => {
        if (ranked.length > 0 || similarity) {
          setLocalSortKey(key);
          setLocalSortDir(direction);
        } else {
          void catalog.sortRows(key, direction);
        }
      }} toolbar={<>
        <Group justify="space-between" mb="sm">
          <TextInput style={{ flex: 1, maxWidth: 440 }} placeholder="Search name, ticker, ISIN, issuer, index…" value={localQuery} onChange={event => setLocalQuery(event.currentTarget.value)} />
          <Group><Text size="sm" c="dimmed">Showing {matchingRows.length ? bounds.start + 1 : 0}–{bounds.end} of {matchingRows.length}</Text><Button size="xs" variant="light" onClick={() => setFiltersOpen(current => !current)}>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</Button><Button size="xs" variant="light" onClick={() => setColumnsOpen(current => !current)}>Columns</Button></Group>
        </Group>
        {filtersOpen && <Card withBorder padding="sm" mb="sm"><SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Select size="xs" searchable clearable label="Issuer" placeholder="All issuers" value={filters.issuer || null} data={issuerOptions} onChange={value => setFilters(current => ({ ...current, issuer: value === null ? '' : String(value) }))} />
          <Select size="xs" clearable label="Instrument type" placeholder="All types" value={filters.type || null} data={Object.entries(instrumentLabels).map(([value, itemLabel]) => ({ value, label: itemLabel }))} onChange={value => setFilters(current => ({ ...current, type: value ?? '' }))} />
          <Select size="xs" clearable label="Asset class" placeholder="All classes" value={filters.assetClass || null} data={[...new Set(instruments.flatMap(instrument => instrument.asset_class ? [instrument.asset_class] : []))].sort().map(value => ({ value, label: label(value) }))} onChange={value => setFilters(current => ({ ...current, assetClass: value === null ? '' : String(value) }))} />
          <Select size="xs" clearable label="Policy" placeholder="Any policy" value={filters.policy || null} data={[{ value: 'accumulating', label: 'Accumulating' }, { value: 'distributing', label: 'Distributing' }]} onChange={value => setFilters(current => ({ ...current, policy: value ?? '' }))} />
          <Select size="xs" clearable label="Replication" placeholder="Any method" value={filters.replication || null} data={[{ value: 'physical_full', label: 'Physical full' }, { value: 'physical_sampling', label: 'Physical sampling' }, { value: 'synthetic', label: 'Synthetic' }]} onChange={value => setFilters(current => ({ ...current, replication: value ?? '' }))} />
          <Select size="xs" searchable clearable label="Domicile" placeholder="All domiciles" value={filters.domicile || null} data={domicileOptions} onChange={value => setFilters(current => ({ ...current, domicile: value === null ? '' : String(value) }))} />
          <Select size="xs" searchable clearable label="Fund currency" placeholder="All currencies" value={filters.currency || null} data={currencyOptions} onChange={value => setFilters(current => ({ ...current, currency: value ?? '' }))} />
          <Select size="xs" clearable label="UCITS" placeholder="Any status" value={filters.ucits || null} data={[{ value: 'true', label: 'UCITS' }, { value: 'false', label: 'Non-UCITS' }]} onChange={value => setFilters(current => ({ ...current, ucits: value ?? '' }))} />
        </SimpleGrid>{activeFilterCount > 0 && <Button size="xs" variant="subtle" mt="xs" onClick={() => setFilters({ issuer: '', type: '', assetClass: '', policy: '', replication: '', domicile: '', currency: '', ucits: '' })}>Clear filters</Button>}</Card>}
        {columnsOpen && <Card withBorder padding="sm" mb="sm"><Group gap="lg">{instrumentColumns.map(column => <Checkbox key={column.value} label={column.label} checked={show(column.value)} onChange={() => toggleColumn(column.value)} />)}</Group></Card>}
      </>} />
      <Group justify="space-between"><Group gap="xs"><Text size="sm" c="dimmed">Rows per page</Text><Select size="xs" w={82} aria-label="Rows per page" value={String(pageSize)} data={['10', '25', '50', '100']} onChange={value => setPageSize(Number(value ?? 50))} /></Group>{bounds.pages > 1 && <Pagination size="sm" total={bounds.pages} value={bounds.current} onChange={setPage} />}</Group>
    </Stack>}
    <InstrumentModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} instrument={editing} saved={async () => { setOpened(false); setRanked([]); await reload(); }} />
    <CompareModal
      opened={compareModalOpened}
      onClose={() => setCompareModalOpened(false)}
      instruments={selectedCompareInstruments}
      onShowAlternatives={showAlternatives}
    />
  </Stack>;
}

function InstrumentModal({ opened, close, instrument, saved }: { opened: boolean; close: () => void; instrument?: Instrument; saved: () => Promise<void> }) {
  const [form, setForm] = useState<InstrumentDraft>(() => instrument ? { ...instrument, ter: instrument.ter_bps / 100, size: instrument.fund_size_million, trackingDifference: instrument.tracking_difference_bps === null ? '' : instrument.tracking_difference_bps / 100, trackingError: instrument.tracking_error_bps === null ? '' : instrument.tracking_error_bps / 100 } : blankInstrument());
  const [error, setError] = useState('');
  const save = async () => { try { await api('/api/instruments', { method: 'POST', body: JSON.stringify({ isin: form.isin, name: form.name, ticker: form.ticker, instrument_type: form.instrument_type, provider: form.provider, index_name: form.index_name, investment_focus: form.investment_focus, asset_class: form.asset_class, strategy: form.strategy, currency_hedged: form.currency_hedged, data_status: 'enriched', distribution: form.distribution, replication: form.replication, domicile: form.domicile, fund_currency: form.fund_currency, ter_bps: bps(form.ter), fund_size_million: n(form.size), inception_date: form.inception_date, tracking_difference_bps: form.trackingDifference === '' ? null : bps(form.trackingDifference), tracking_error_bps: form.trackingError === '' ? null : bps(form.trackingError), ucits: form.ucits, source_url: form.source_url }) }); await saved(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const set = <K extends keyof InstrumentDraft>(key: K, value: InstrumentDraft[K]) => setForm(current => ({ ...current, [key]: value }));
  return <Modal opened={opened} onClose={close} title={instrument ? 'Edit instrument' : 'Add instrument'} size="xl"><Stack>{error && <Alert color="red">{error}</Alert>}<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
    <TextInput required label="ISIN" value={form.isin} onChange={e => set('isin', e.currentTarget.value.toUpperCase())} />
    <TextInput required label="Name" value={form.name} onChange={e => set('name', e.currentTarget.value)} />
    <TextInput label="Ticker" value={form.ticker} onChange={e => set('ticker', e.currentTarget.value)} />
    <Select label="Instrument type" value={form.instrument_type} data={Object.entries(instrumentLabels).map(([value, label]) => ({ value, label }))} onChange={value => set('instrument_type', (value ?? 'other') as InstrumentType)} />
    <TextInput label="Issuer" value={form.provider} onChange={e => set('provider', e.currentTarget.value)} />
    <TextInput label="Tracked index" value={form.index_name} onChange={e => set('index_name', e.currentTarget.value)} />
    <TextInput label="Investment focus" placeholder="Equity, World" value={form.investment_focus} onChange={e => set('investment_focus', e.currentTarget.value)} />
    <Select label="Asset class" value={form.asset_class} data={[{ value: '', label: 'Unknown' }, { value: 'equity', label: 'Equity' }, { value: 'bond', label: 'Bond' }, { value: 'commodity', label: 'Commodity' }, { value: 'money_market', label: 'Money market' }, { value: 'real_estate', label: 'Real estate' }, { value: 'crypto', label: 'Crypto' }, { value: 'mixed', label: 'Mixed' }, { value: 'other', label: 'Other' }]} onChange={value => set('asset_class', value ?? '')} />
    <Select label="Strategy" value={form.strategy} data={[{ value: 'broad', label: 'Broad' }, { value: 'esg', label: 'ESG / screened' }, { value: 'dividend', label: 'Dividend' }, { value: 'factor', label: 'Factor' }]} onChange={value => set('strategy', value ?? 'broad')} />
    <TextInput label="Domicile" maxLength={2} value={form.domicile} onChange={e => set('domicile', e.currentTarget.value.toUpperCase())} />
    <Select label="Distribution" value={form.distribution} data={[{ value: 'accumulating', label: 'Accumulating' }, { value: 'distributing', label: 'Distributing' }]} onChange={value => set('distribution', (value ?? 'accumulating') as InstrumentDraft['distribution'])} />
    <Select label="Replication" value={form.replication} data={[{ value: 'physical_full', label: 'Physical full' }, { value: 'physical_sampling', label: 'Physical sampling' }, { value: 'synthetic', label: 'Synthetic' }]} onChange={value => set('replication', (value ?? 'physical_full') as InstrumentDraft['replication'])} />
    <TextInput label="Fund currency" maxLength={3} value={form.fund_currency} onChange={e => set('fund_currency', e.currentTarget.value.toUpperCase())} />
    <NumberInput label="TER (%)" min={0} decimalScale={3} value={form.ter} onChange={value => set('ter', value)} />
    <NumberInput label="Fund size (million)" min={0} value={form.size} onChange={value => set('size', value)} />
    <TextInput type="date" label="Inception date" value={form.inception_date} onChange={e => set('inception_date', e.currentTarget.value)} />
    <Checkbox label="UCITS compliant" checked={form.ucits} onChange={event => set('ucits', event.currentTarget.checked)} />
    <Checkbox label="Currency hedged" checked={form.currency_hedged} onChange={event => set('currency_hedged', event.currentTarget.checked)} />
    <NumberInput label="Tracking difference (%)" decimalScale={3} value={form.trackingDifference} onChange={value => set('trackingDifference', value)} />
    <NumberInput label="Tracking error (%)" min={0} decimalScale={3} value={form.trackingError} onChange={value => set('trackingError', value)} />
    <TextInput label="Source URL" type="url" value={form.source_url} onChange={e => set('source_url', e.currentTarget.value)} />
  </SimpleGrid><Text size="xs" c="dimmed">Instrument type describes the legal wrapper; asset class describes what it invests in. The ISIN is the stable key.</Text><Group justify="end"><Button onClick={() => void save()}>Save instrument</Button></Group></Stack></Modal>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <Paper className="metric" p="xl" radius="lg" ta="center"><Title order={3}>{title}</Title><Text c="dimmed" mt={6}>{text}</Text></Paper>;
}
