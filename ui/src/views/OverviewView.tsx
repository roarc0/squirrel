import { useState, useEffect } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
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
import { AllocationBar, PerformanceResult, useBackendRows } from '../App';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn } from '../DataTable';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { compactMoney, investedMoney, label, money } from '../utils/format';
import { chartGeometry, filterChartRange, nearestChartIndex, type ChartRange } from '../visual';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { useProfile } from '../hooks/useProfile';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';
import { handleLinkClick } from '../utils/navigation';

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
  const [profile, setProfile] = useProfile();
  const goal = Math.round(profile.emergency_goal_minor / 100) || 10000;
  const [editing, setEditing] = useState(false);
  const [draftGoal, setDraftGoal] = useState<Numeric>(goal);
  useEffect(() => { setDraftGoal(Math.round(profile.emergency_goal_minor / 100) || 10000); }, [profile.emergency_goal_minor]);

  const saveGoal = () => {
    const next = Math.max(1, Number(draftGoal) || 10000);
    setProfile({ emergency_goal_minor: next * 100 });
    setEditing(false);
  };

  const goalMinor = goal * 100;
  const pct = Math.min(100, Math.round((cashMinor / Math.max(1, goalMinor)) * 100));

  return (
    <Card className="metric" p="lg" radius="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={700} size="sm">Emergency Reserve</Text>
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconPencil size={12} />} onClick={() => { setDraftGoal(goal); setEditing(true); }}>
            Goal
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

function FreedomCalculatorCard({ totalWealthMinor, currency }: { totalWealthMinor: number; currency: string }) {
  const [profile, setProfile] = useProfile();
  const annualExpenses = Math.round(profile.fire_expenses_minor / 100) || 24000;
  const [editing, setEditing] = useState(false);
  const [draftExpenses, setDraftExpenses] = useState<Numeric>(annualExpenses);
  useEffect(() => { setDraftExpenses(Math.round(profile.fire_expenses_minor / 100) || 24000); }, [profile.fire_expenses_minor]);

  const saveExpenses = () => {
    const next = Math.max(1000, Number(draftExpenses) || 24000);
    setProfile({ fire_expenses_minor: next * 100 });
    setEditing(false);
  };

  const wealthEur = totalWealthMinor / 100;
  const swr4Annual = Math.round(totalWealthMinor * 0.04);
  const swr4Monthly = Math.round(swr4Annual / 12);
  const yearsCovered = annualExpenses > 0 ? (wealthEur / annualExpenses).toFixed(1) : '0';
  const targetFireWealthMinor = annualExpenses * 25 * 100;
  const fireProgressPct = Math.min(100, Math.round((totalWealthMinor / Math.max(1, targetFireWealthMinor)) * 100));

  return (
    <Card className="metric" p="lg" radius="lg" mt="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={700} size="sm">Financial Independence (FIRE) & SWR</Text>
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconPencil size={12} />} onClick={() => { setDraftExpenses(annualExpenses); setEditing(true); }}>
            Expenses Goal
          </Button>
        </Group>
        <Badge color={fireProgressPct >= 100 ? 'teal' : 'blue'} variant="filled">
          {fireProgressPct >= 100 ? 'FIRE Target Reached 🎉' : `${fireProgressPct}% to FIRE Target`}
        </Badge>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }} mt="sm">
        <Box>
          <Text size="xs" c="dimmed">4% SWR Safe Passive Income</Text>
          <Text size="md" fw={750} c="teal">{money(swr4Monthly, currency)}/mo</Text>
          <Text size="xs" c="dimmed">{money(swr4Annual, currency)}/yr budget</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Freedom Horizon Covered</Text>
          <Text size="md" fw={750}>{yearsCovered} years</Text>
          <Text size="xs" c="dimmed">at {money(annualExpenses * 100, currency)}/yr expenses</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Target FIRE Net Wealth (25x)</Text>
          <Text size="md" fw={750}>{money(targetFireWealthMinor, currency)}</Text>
          <Text size="xs" c="dimmed">{money(totalWealthMinor, currency)} current wealth</Text>
        </Box>
      </SimpleGrid>
      <Progress value={fireProgressPct} color={fireProgressPct >= 100 ? 'teal' : 'blue'} radius="xl" mt="md" />
      <Modal opened={editing} onClose={() => setEditing(false)} title={`Target Annual Living Expenses (${currency})`} size="sm">
        <Stack gap="sm">
          <NumberInput label="Annual Expenses Goal (€/yr)" min={1000} value={draftExpenses} onChange={setDraftExpenses} />
          <Text size="xs" c="dimmed">Your estimated yearly budget needed to cover your living costs independently.</Text>
          <Button onClick={saveExpenses}>Save Expenses Goal</Button>
        </Stack>
      </Modal>
    </Card>
  );
}

export function OverviewView({ data, reload, onSwitchTab }: { data: Data; reload: () => Promise<void>; onSwitchTab: (tab: string) => void }) {
  const [profile] = useProfile();
  const currencies = data.summary.currencies ?? [];
  const diagnostics = data.summary.diagnostics ?? [];
  return (
    <ViewShell>
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
            <Button
              component="a"
              href="/diagnostics"
              size="xs"
              variant="light"
              color="orange"
              onClick={(e) => handleLinkClick(e, '/diagnostics', onSwitchTab)}
            >
              View Diagnostics tab →
            </Button>
          </Group>
        </Paper>
      )}
      {currencies.length === 0 ? <Empty title="No accounts yet" text="Add a bank or brokerage account to see your allocation." /> : currencies.map(item => {
        const allocations = (item.allocations ?? []).filter(allocation => allocation.value_minor > 0);
        return (
        <Box key={item.currency}>
          <SectionHeader
            title="Assets"
            subtitle="Current rough situation"
            badge={<Badge color="teal" variant="light" size="sm">{item.currency}</Badge>}
            order={3}
          />
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }}>
          <Metric label="Cash balance" value={money(item.balance_minor, item.currency)} />
          <InvestmentMetric value={item.portfolio_minor} invested={item.invested_minor} currency={item.currency} />
          <PerformanceMetric value={item.portfolio_minor} invested={item.invested_minor} currency={item.currency} />
          <TERMetric holdings={data.holdings} instruments={data.instruments} currency={item.currency} />
          <Metric label="Total wealth" value={money(item.total_minor, item.currency)} positive />
        </SimpleGrid>
        <Divider my="md" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
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
        {profile.show_fire_calculator && (
          <FreedomCalculatorCard
            totalWealthMinor={item.total_minor}
            currency={item.currency}
          />
        )}
        <Divider my="md" />
        <Paper className="metric" p="lg" radius="lg">
          <Group justify="space-between" mb="sm"><Text fw={700}>Asset allocation</Text><Text size="sm" c="dimmed">Cash interest/year: Gross {money(item.gross_revenue_minor, item.currency)} · Net {money(item.net_revenue_minor, item.currency)}</Text></Group>
          <AllocationBar total={item.total_minor} segments={[{ label: 'Cash', value: item.balance_minor }, ...allocations.map(allocation => ({ label: label(allocation.asset_class), value: allocation.value_minor }))]} />
        </Paper>
      </Box>
    )})}
    <SnapshotHistory snapshots={data.snapshots} currency={data.summary.base_currency} reload={reload} />
  </ViewShell>
  );
}

function SnapshotHistory({ snapshots, currency, reload }: { snapshots: Snapshot[]; currency: string; reload: () => Promise<void> }) {
  const [observedOn, setObservedOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false); const [editing, setEditing] = useState<Snapshot>(); const [error, setError] = useState('');
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const table = useBackendRows('/api/snapshots', snapshots);
  const current = snapshots.filter(item => item.currency === currency).sort((a, b) => a.observed_on.localeCompare(b.observed_on));
  const removeSnapshot = (item: Snapshot) => {
    confirmDelete('snapshot', `${item.observed_on} (${money(item.total_minor, item.currency)})`, async () => {
      await api(`/api/snapshots/${item.id}`, { method: 'DELETE' });
      await reload();
    });
  };
  const columns: DataColumn<Snapshot>[] = [
    { key: 'date', label: 'Date', sortable: true, render: item => new Date(`${item.observed_on}T00:00:00`).toLocaleDateString() },
    { key: 'currency', label: 'Currency', sortable: true, render: item => item.currency },
    { key: 'cash', label: 'Cash', sortable: true, align: 'right', render: item => money(item.cash_minor, item.currency) },
    { key: 'portfolio', label: 'Investments', sortable: true, align: 'right', render: item => money(item.portfolio_minor, item.currency) },
    { key: 'total', label: 'Total', sortable: true, align: 'right', render: item => money(item.total_minor, item.currency) },
    { key: 'actions', align: 'right', render: item => <TableActions><TableAction label="Edit snapshot" onClick={() => setEditing(item)}><IconPencil size={14} /></TableAction><TableAction label="Delete snapshot" color="red" onClick={() => removeSnapshot(item)}><IconTrash size={14} /></TableAction></TableActions> },
  ];
  const save = async () => { setSaving(true); try { await api('/api/snapshots', { method: 'POST', body: JSON.stringify({ observed_on: observedOn }) }); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); } };
  return <Stack gap="md"><Group justify="space-between" align="end"><Box><Title order={3}>Wealth history</Title><Text c="dimmed">A snapshot copies every account's cash and investment holdings for that date.</Text></Box><Group align="end"><TextInput type="date" label="Snapshot date" value={observedOn} onChange={event => setObservedOn(event.currentTarget.value)} /><Button loading={saving} onClick={() => void save()}>Save snapshot</Button></Group></Group>
    {(error || table.sortError) && <Alert color="red">{error || table.sortError}</Alert>}
    {current.length > 1 ? <WealthChart snapshots={current} currency={currency} /> : current.length === 1 && <Alert color="gray">Save one more snapshot to see the wealth trend.</Alert>}
    {snapshots.length === 0 ? <Empty title="No snapshots yet" text="Update your balances and holdings, then save the current situation." /> : <DataTable rows={table.sort ? table.rows : [...table.rows].reverse()} columns={columns} rowKey={item => `${item.id}-${item.currency}`} minWidth={820} sort={table.sort} direction={table.direction} onSort={(key, direction) => void table.sortRows(key, direction)} />}
    <SnapshotModal key={editing ? `${editing.id}-${editing.currency}` : 'closed'} snapshot={editing} close={() => setEditing(undefined)} saved={async () => { setEditing(undefined); await reload(); }} />
    {confirmDeleteModal}
  </Stack>;
}

function SnapshotModal({ snapshot, close, saved }: { snapshot?: Snapshot; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState<{ date: string; cash: Numeric; invested: Numeric; portfolio: Numeric }>(() => snapshot ? { date: snapshot.observed_on, cash: snapshot.cash_minor / 100, invested: snapshot.invested_minor / 100, portfolio: snapshot.portfolio_minor / 100 } : { date: '', cash: 0, invested: 0, portfolio: 0 }); const [error, setError] = useState('');
  const save = async () => { if (!snapshot) return; try { await api(`/api/snapshots/${snapshot.id}`, { method: 'PUT', body: JSON.stringify({ observed_on: form.date, currency: snapshot.currency, cash_minor: minor(form.cash), invested_minor: minor(form.invested), portfolio_minor: minor(form.portfolio) }) }); await saved(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  return <Modal opened={Boolean(snapshot)} onClose={close} title="Correct snapshot"><Stack>{error && <Alert color="red">{error}</Alert>}<SimpleGrid cols={2}><TextInput type="date" label="Date" value={form.date} onChange={event => setForm({ ...form, date: event.currentTarget.value })} /><TextInput readOnly label="Currency" value={snapshot?.currency ?? ''} /><NumberInput min={0} decimalScale={2} label="Cash" value={form.cash} onChange={value => setForm({ ...form, cash: value })} /><NumberInput min={0} decimalScale={2} label="Amount invested" value={form.invested} onChange={value => setForm({ ...form, invested: value })} /><NumberInput min={0} decimalScale={2} label="Investments" value={form.portfolio} onChange={value => setForm({ ...form, portfolio: value })} /></SimpleGrid><Group justify="space-between"><Text size="sm" c="dimmed">Corrected total</Text><Text fw={700}>{money(minor(form.cash) + minor(form.portfolio), snapshot?.currency ?? 'EUR')}</Text></Group><Text size="xs" c="dimmed">This replaces the stored per-account breakdown for this currency with the corrected totals.</Text><Group justify="end"><Button onClick={() => void save()}>Save correction</Button></Group></Stack></Modal>;
}

function WealthChart({ snapshots, currency }: { snapshots: Snapshot[]; currency: string }) {
  type MetricKey = 'total' | 'invested' | 'portfolio' | 'cash';
  const metrics: Record<MetricKey, { label: string; color: string; value: (snapshot: Snapshot) => number }> = {
    total: { label: 'Total', color: 'teal', value: snapshot => snapshot.total_minor },
    invested: { label: 'Invested', color: 'orange', value: snapshot => snapshot.invested_minor },
    portfolio: { label: 'Investment value', color: 'blue', value: snapshot => snapshot.portfolio_minor },
    cash: { label: 'Cash', color: 'cyan', value: snapshot => snapshot.cash_minor },
  };
  const metricKeys = Object.keys(metrics) as MetricKey[];
  const [range, setRange] = useState<ChartRange>('max');
  const [visible, setVisible] = useState<MetricKey[]>(metricKeys);
  const [hovered, setHovered] = useState<number>();
  const shown = filterChartRange(snapshots, range);
  const active = metricKeys.filter(key => visible.includes(key));
  const scaleValues = (active.length ? active : metricKeys).flatMap(key => shown.map(metrics[key].value));
  const geometry = chartGeometry(scaleValues);
  const xPoints = chartGeometry(shown.map(() => 0), scaleValues).points;
  const hoverIndex = hovered === undefined ? undefined : Math.min(hovered, shown.length - 1);
  const hoverX = hoverIndex === undefined ? 0 : xPoints[hoverIndex].x;
  const dates = [0, Math.floor((shown.length - 1) / 2), shown.length - 1].filter((index, position, all) => all.indexOf(index) === position);

  return <Card className="metric" p="lg" radius="lg"><Stack gap="sm">
    <Group justify="space-between" align="center" wrap="nowrap">
      <Text fw={700}>Wealth over time</Text>
      <SegmentedControl size="xs" value={range} onChange={value => setRange(value as ChartRange)} data={['1w', '2w', '1m', '3m', '6m', '1y', '3y', '5y', 'max']} />
    </Group>
    <Group gap="xs" role="group" aria-label="Chart series">
      {metricKeys.map(key => <Button key={key} size="compact-xs" variant={visible.includes(key) ? 'light' : 'subtle'} color={metrics[key].color} aria-pressed={visible.includes(key)} style={{ opacity: visible.includes(key) ? 1 : 0.45 }} leftSection={<Box w={14} h={2} bg={`${metrics[key].color}.5`} />} onClick={() => setVisible(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])}>{metrics[key].label}</Button>)}
    </Group>
    <svg className="wealth-chart" viewBox="0 0 760 260" role="img" tabIndex={0} aria-label={hoverIndex === undefined ? 'Wealth history. Hover or use arrow keys to inspect snapshots.' : `${shown[hoverIndex].observed_on}: ${active.map(key => `${metrics[key].label} ${money(metrics[key].value(shown[hoverIndex]), currency)}`).join(', ')}`} style={{ cursor: 'crosshair' }} onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); setHovered(nearestChartIndex((event.clientX - bounds.left) / bounds.width * 760, shown.length)); }} onPointerLeave={() => setHovered(undefined)} onFocus={() => setHovered(current => current ?? shown.length - 1)} onBlur={() => setHovered(undefined)} onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); setHovered(current => Math.min(shown.length - 1, Math.max(0, (current ?? shown.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))); }}>
      {active.length === 0 ? <text x="407" y="130" textAnchor="middle">Enable a series to show it</text> : <>
        {[0, 1, 2, 3].map(index => { const ratio = index / 3; const y = 24 + ratio * 196; const value = geometry.high - ratio * (geometry.high - geometry.low); return <g key={index}><line x1="74" x2="740" y1={y} y2={y} stroke="currentColor" opacity="0.12" /><text x="66" y={y + 4} textAnchor="end">{compactMoney(value, currency)}</text></g>; })}
        {active.map(key => { const values = shown.map(metrics[key].value); const series = chartGeometry(values, scaleValues); const points = series.points.map(point => `${point.x},${point.y}`).join(' '); return <g key={key}><polyline points={points} fill="none" stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />{series.points.map((point, index) => <circle key={shown[index].observed_on} cx={point.x} cy={point.y} r="3" fill="var(--mantine-color-body)" stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2"><title>{`${metrics[key].label} · ${shown[index].observed_on}: ${money(values[index], currency)}`}</title></circle>)}</g>; })}
        {dates.map(index => <text key={index} x={xPoints[index].x} y="248" textAnchor={shown.length === 1 ? 'middle' : index === 0 ? 'start' : index === shown.length - 1 ? 'end' : 'middle'}>{new Date(`${shown[index].observed_on}T00:00:00`).toLocaleDateString()}</text>)}
        {hoverIndex !== undefined && <>
          <line x1={hoverX} x2={hoverX} y1="24" y2="220" stroke="currentColor" strokeDasharray="4 4" opacity="0.45" />
          {active.map(key => { const point = chartGeometry(shown.map(metrics[key].value), scaleValues).points[hoverIndex]; return <circle key={key} cx={point.x} cy={point.y} r="5" fill="var(--mantine-color-body)" stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2" />; })}
          <g transform={`translate(${hoverX > 520 ? hoverX - 212 : hoverX + 12} 32)`} style={{ pointerEvents: 'none' }}>
            <rect width="200" height={32 + active.length * 20} rx="8" fill="var(--mantine-color-body)" stroke="currentColor" strokeOpacity="0.25" />
            <text x="12" y="20" style={{ fontWeight: 700 }}>{new Date(`${shown[hoverIndex].observed_on}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })}</text>
            {active.map((key, index) => <g key={key}><line x1="12" x2="24" y1={42 + index * 20} y2={42 + index * 20} stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2" /><text x="30" y={46 + index * 20}>{metrics[key].label}: {money(metrics[key].value(shown[hoverIndex]), currency)}</text></g>)}
          </g>
        </>}
      </>}
    </svg>
  </Stack></Card>;
}
