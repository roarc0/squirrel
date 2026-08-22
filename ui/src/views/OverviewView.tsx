import { useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api, type Holding, type Instrument, type Snapshot, type Summary } from '../api';
import { useBackendRows, AllocationBar, PerformanceResult } from '../App';
import { Empty } from '../components/Empty';
import { DataTable, type DataColumn } from '../DataTable';
import { confirmDelete, investedMoney, label, money } from '../utils/format';
import { chartGeometry } from '../visual';

type Data = { summary: Summary; accounts: any[]; rates: any[]; taxRates: any[]; instruments: Instrument[]; holdings: Holding[]; snapshots: Snapshot[] };
type Numeric = string | number;

const minor = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Math.round(Number(value) * 100));

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">{label}</Text><Text size="xl" fw={750} mt={4} className={positive ? 'positive' : ''}>{value}</Text></Card>;
}

function InvestmentMetric({ value, invested, currency }: { value: number; invested: number; currency: string }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">Investments</Text><Text size="xl" fw={750} mt={4}>{money(value, currency)}</Text><Text size="xs" c="dimmed" mt={5}>Invested {investedMoney(invested, value, currency)}</Text></Card>;
}

function PerformanceMetric({ value, invested, currency }: { value: number; invested: number; currency: string }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">Investment trend</Text><Group mt={10} align="center"><PerformanceResult value={value} invested={invested} currency={currency} mood /></Group></Card>;
}

function TERMetric({ holdings, instruments, currency }: { holdings: Holding[]; instruments: Instrument[]; currency: string }) {
  const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));
  let totalVal = 0;
  let weightedTERNum = 0;
  let annualFeeDrag = 0;

  for (const h of holdings) {
    if ((h.currency ?? 'EUR') === currency) {
      const inst = instMap.get(h.instrument_id);
      const terBps = inst?.ter_bps ?? 0;
      totalVal += h.value_minor;
      weightedTERNum += h.value_minor * terBps;
      annualFeeDrag += Math.round((h.value_minor * terBps) / 10000);
    }
  }

  const weightedTER = totalVal > 0 ? (weightedTERNum / totalVal / 100).toFixed(2) : '0.00';

  return (
    <Card className="metric" p="lg" radius="lg">
      <Text size="sm" c="dimmed">Weighted Expense (TER)</Text>
      <Group justify="space-between" align="baseline" mt={5}>
        <Text size="xl" fw={750}>{totalVal > 0 ? `${weightedTER}%` : '—'}</Text>
        {annualFeeDrag > 0 && (
          <Text size="xs" fw={700} c="orange" title="Estimated annual ETF TER cost">
            -{money(annualFeeDrag, currency)}/yr
          </Text>
        )}
      </Group>
    </Card>
  );
}

function NetPassiveCashflowCard({ netInterestMinor, holdings, instruments, currency }: { netInterestMinor: number; holdings: Holding[]; instruments: Instrument[]; currency: string }) {
  const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));
  let annualTERDrag = 0;
  for (const h of holdings) {
    if ((h.currency ?? 'EUR') === currency) {
      const terBps = h.ter_bps ?? instMap.get(h.instrument_id)?.ter_bps ?? 0;
      annualTERDrag += Math.round((h.value_minor * terBps) / 10000);
    }
  }
  const netBalance = netInterestMinor - annualTERDrag;
  return (
    <Card className="metric" p="lg" radius="lg">
      <Group justify="space-between" mb="xs">
        <Text fw={700} size="sm">Net Passive Flow</Text>
        <Badge color={netBalance >= 0 ? 'teal' : 'red'} variant="light">
          {netBalance >= 0 ? 'Positive Yield' : 'Net Cost'}
        </Badge>
      </Group>
      <Group align="baseline" gap="xs">
        <Text size="xl" fw={750} c={netBalance >= 0 ? 'teal' : 'red'}>
          {netBalance >= 0 ? '+' : ''}{money(netBalance, currency)}/yr
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        +{money(netInterestMinor, currency)}/yr net interest · -{money(annualTERDrag, currency)}/yr TER fees
      </Text>
    </Card>
  );
}

function EmergencyReserveCard({ cashMinor, currency }: { cashMinor: number; currency: string }) {
  const [goal, setGoal] = useState<number>(() => {
    try {
      const val = localStorage.getItem(`loot.emergencyGoal.${currency}`);
      return val ? Number(val) : 10000;
    } catch { return 10000; }
  });
  const [editing, setEditing] = useState(false);
  const [draftGoal, setDraftGoal] = useState<Numeric>(goal);

  const saveGoal = () => {
    const next = Math.max(1, Number(draftGoal) || 10000);
    setGoal(next);
    try { localStorage.setItem(`loot.emergencyGoal.${currency}`, String(next)); } catch { /* optional */ }
    setEditing(false);
  };

  const goalMinor = goal * 100;
  const pct = Math.min(100, Math.round((cashMinor / Math.max(1, goalMinor)) * 100));

  return (
    <Card className="metric" p="lg" radius="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={700} size="sm">Emergency Reserve</Text>
          <Button size="xs" variant="subtle" color="gray" onClick={() => { setDraftGoal(goal); setEditing(true); }}>
            ✎ Goal
          </Button>
        </Group>
        <Badge color={pct >= 100 ? 'teal' : pct >= 50 ? 'blue' : 'orange'} variant="filled">
          {pct >= 100 ? 'Fully Reserved' : `${pct}% Funded`}
        </Badge>
      </Group>
      <Group align="baseline" justify="space-between" mt={4}>
        <Text size="lg" fw={750}>
          {money(cashMinor, currency)} <Text span size="xs" c="dimmed">/ {money(goalMinor, currency)} goal</Text>
        </Text>
      </Group>
      <Progress value={pct} color={pct >= 100 ? 'teal' : pct >= 50 ? 'blue' : 'orange'} animated={pct < 100} radius="xl" mt="xs" />
      <Modal opened={editing} onClose={() => setEditing(false)} title={`Target Emergency Reserve (${currency})`} size="sm">
        <Stack gap="sm">
          <NumberInput label="Target Cash Goal" min={100} value={draftGoal} onChange={setDraftGoal} />
          <Text size="xs" c="dimmed">Recommended: 3 to 6 months of essential living expenses kept in liquid cash.</Text>
          <Button onClick={saveGoal}>Save Goal</Button>
        </Stack>
      </Modal>
    </Card>
  );
}

export function OverviewView({ data, reload, onSwitchTab }: { data: Data; reload: () => Promise<void>; onSwitchTab: (tab: string) => void }) {
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
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }}>
          <Metric label="Cash balance" value={money(item.balance_minor, item.currency)} />
          <InvestmentMetric value={item.portfolio_minor} invested={item.invested_minor} currency={item.currency} />
          <PerformanceMetric value={item.portfolio_minor} invested={item.invested_minor} currency={item.currency} />
          <TERMetric holdings={data.holdings} instruments={data.instruments} currency={item.currency} />
          <Metric label="Total wealth" value={money(item.total_minor, item.currency)} positive />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
          <NetPassiveCashflowCard
            netInterestMinor={item.net_revenue_minor}
            holdings={data.holdings}
            instruments={data.instruments}
            currency={item.currency}
          />
          <EmergencyReserveCard
            cashMinor={item.balance_minor}
            currency={item.currency}
          />
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
  const columns: DataColumn<Snapshot>[] = [
    { key: 'date', label: 'Date', sortable: true, render: item => new Date(`${item.observed_on}T00:00:00`).toLocaleDateString() },
    { key: 'currency', label: 'Currency', sortable: true, render: item => item.currency },
    { key: 'cash', label: 'Cash', sortable: true, render: item => money(item.cash_minor, item.currency) },
    { key: 'portfolio', label: 'Investments', sortable: true, render: item => money(item.portfolio_minor, item.currency) },
    { key: 'total', label: 'Total', sortable: true, render: item => money(item.total_minor, item.currency) },
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
