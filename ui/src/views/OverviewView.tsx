import { useState, useEffect, useMemo } from 'react';
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
import { useElementSize } from '@mantine/hooks';
import { AllocationBar, PerformanceResult, useBackendRows } from '../App';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn } from '../DataTable';
import { IconAlertTriangle, IconChartPie, IconPencil, IconTrash } from '@tabler/icons-react';
import { compactMoney, investedMoney, label, money } from '../utils/format';
import { chartGeometry, filterChartRange, nearestChartIndex, type ChartRange } from '../visual';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { useProfile } from '../hooks/useProfile';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';
import { handleLinkClick } from '../utils/navigation';
import { SubnavTabs } from '../components/SubnavTabs';
import { DiagnosticsView } from './DiagnosticsView';

type Data = { summary: Summary; accounts: any[]; rates: any[]; taxRates: any[]; instruments: Instrument[]; holdings: Holding[]; snapshots: Snapshot[] };
type Numeric = string | number;

const minor = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Math.round(Number(value) * 100));

function StatTile({
  label,
  value,
  hint,
  positive,
  negative,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <Card withBorder className="stat-card" p="md" radius="md">
      <div className="stat-tile-label">{label}</div>
      <div className={`stat-tile-value ${positive ? 'positive' : negative ? 'negative' : ''}`}>
        {value}
      </div>
      {hint && <div className="stat-tile-hint">{hint}</div>}
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
  const annualExpenses = profile.fire_expenses_minor > 0 ? profile.fire_expenses_minor : 2400000;
  const monthlyExpenses = annualExpenses / 12;
  const monthsCovered = monthlyExpenses > 0 ? (cashMinor / monthlyExpenses).toFixed(1) : null;

  return (
    <Card withBorder className="solid-inner-card" p="lg" radius="md">
      <div className="solid-card-header">
        <Group gap="xs">
          <Text fw={700} size="sm">Emergency Reserve</Text>
          <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconPencil size={12} />} onClick={() => { setDraftGoal(goal); setEditing(true); }}>
            Goal
          </Button>
        </Group>
        <Badge color={pct >= 100 ? 'teal' : pct >= 50 ? 'blue' : 'orange'} variant="light" size="xs">
          {pct >= 100 ? 'Fully Reserved' : `${pct}% Funded`}
        </Badge>
      </div>
      <Group align="baseline" justify="space-between" mt={4}>
        <Text size="xl" fw={750} style={{ fontFamily: 'ui-monospace, monospace' }}>
          {money(cashMinor, currency)}
        </Text>
        <Text size="xs" c="dimmed">
          Goal: {money(goalMinor, currency)}
        </Text>
      </Group>
      <Progress value={pct} color={pct >= 100 ? 'teal' : pct >= 50 ? 'blue' : 'orange'} animated={pct < 100} radius="xl" mt="xs" />
      <Text size="xs" c="dimmed" mt={8}>
        {monthsCovered ? `Covers ~${monthsCovered} months of essential living costs.` : 'Recommended: 3 to 6 months of liquid expenses.'}
      </Text>
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
    <Card withBorder className="solid-inner-card" p="lg" radius="md">
      <div className="solid-card-header">
        <Group gap="xs">
          <Text fw={700} size="sm">Financial Independence (FIRE) & SWR</Text>
          <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconPencil size={12} />} onClick={() => { setDraftExpenses(annualExpenses); setEditing(true); }}>
            Expenses
          </Button>
        </Group>
        <Badge color={fireProgressPct >= 100 ? 'teal' : 'blue'} variant="light" size="xs">
          {fireProgressPct >= 100 ? 'FIRE Target Reached 🎉' : `${fireProgressPct}% to FIRE Target`}
        </Badge>
      </div>
      <SimpleGrid cols={{ base: 1, sm: 3 }} mt="xs">
        <Card withBorder className="stat-card" p="xs" radius="sm" style={{ minHeight: 74 }}>
          <div className="stat-tile-label">4% SWR Safe Income</div>
          <div className="stat-tile-value" style={{ fontSize: '1.15rem', color: 'var(--mantine-color-teal-6)' }}>
            {money(swr4Monthly, currency)}/mo
          </div>
          <div className="stat-tile-hint">{money(swr4Annual, currency)}/yr budget</div>
        </Card>
        <Card withBorder className="stat-card" p="xs" radius="sm" style={{ minHeight: 74 }}>
          <div className="stat-tile-label">Freedom Runway</div>
          <div className="stat-tile-value" style={{ fontSize: '1.15rem' }}>
            {yearsCovered} yrs
          </div>
          <div className="stat-tile-hint">at {money(annualExpenses * 100, currency)}/yr</div>
        </Card>
        <Card withBorder className="stat-card" p="xs" radius="sm" style={{ minHeight: 74 }}>
          <div className="stat-tile-label">Target 25x Wealth</div>
          <div className="stat-tile-value" style={{ fontSize: '1.15rem' }}>
            {money(targetFireWealthMinor, currency)}
          </div>
          <div className="stat-tile-hint">{money(totalWealthMinor, currency)} current</div>
        </Card>
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

export function OverviewView({
  data,
  reload,
  onSwitchTab,
  activeSubtab = 'overview',
  onSubtabChange,
}: {
  data: Data;
  reload: () => Promise<void>;
  onSwitchTab: (tab: string) => void;
  activeSubtab?: 'overview' | 'diagnostics';
  onSubtabChange?: (subtab: 'overview' | 'diagnostics') => void;
}) {
  const [profile] = useProfile();
  const [currentSubtab, setCurrentSubtab] = useState<'overview' | 'diagnostics'>(activeSubtab);

  useEffect(() => {
    if (activeSubtab) {
      setCurrentSubtab(activeSubtab);
    }
  }, [activeSubtab]);

  const handleSubtabChange = (tab: 'overview' | 'diagnostics') => {
    setCurrentSubtab(tab);
    onSubtabChange?.(tab);
  };

  const currencies = data.summary.currencies ?? [];
  const diagnostics = data.summary.diagnostics ?? [];

  return (
    <ViewShell>
      <SubnavTabs<'overview' | 'diagnostics'>
        value={currentSubtab}
        onChange={handleSubtabChange}
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            icon: <IconChartPie size={16} />,
          },
          {
            value: 'diagnostics',
            label: 'Diagnostics',
            icon: <IconAlertTriangle size={16} />,
            badge: diagnostics.length > 0 ? diagnostics.length : undefined,
            badgeColor: 'orange',
          },
        ]}
      />

      {currentSubtab === 'diagnostics' ? (
        <DiagnosticsView
          diagnostics={diagnostics}
          onOpenSettings={() => onSwitchTab('settings')}
          onOpenInvest={() => onSwitchTab('investments')}
        />
      ) : (
        <>
          {currencies.length === 0 ? (
            <Empty title="No accounts yet" text="Add a bank or brokerage account to see your allocation." />
          ) : (
            currencies.map(item => {
              const allocations = (item.allocations ?? []).filter(allocation => allocation.value_minor > 0);

              // Calculate weighted TER and annual drag
              const instMap = new Map<number, Instrument>(data.instruments.map(i => [i.id, i]));
              let totalVal = 0;
              let weightedTERNum = 0;
              let annualTERDrag = 0;
              for (const h of data.holdings) {
                if ((h.currency ?? 'EUR') === item.currency) {
                  const inst = instMap.get(h.instrument_id);
                  const terBps = h.ter_bps ?? inst?.ter_bps ?? 0;
                  totalVal += h.value_minor;
                  weightedTERNum += h.value_minor * terBps;
                  annualTERDrag += Math.round((h.value_minor * terBps) / 10000);
                }
              }
              const weightedTER = totalVal > 0 ? (weightedTERNum / totalVal / 100).toFixed(2) : '0.00';
              const netPassiveBalance = item.net_revenue_minor - annualTERDrag;
              const cashRatio = item.total_minor > 0 ? ((item.balance_minor / item.total_minor) * 100).toFixed(1) : '0';

              const investedChange = item.portfolio_minor - item.invested_minor;
              const investedPct = item.invested_minor > 0 ? ((investedChange / item.invested_minor) * 100).toFixed(1) : '0.0';

              return (
                <Stack key={item.currency} gap="md" mb="xl">
                  {/* Area 1: Summary Lead Section (Faithful to Trade Republic Analyzer) */}
                  <Card withBorder className="section-card" p="md" radius="md">
                    <div className="section-card-header">
                      <div>
                        <h2 className="section-card-title">Summary</h2>
                        <p className="section-card-meta">
                          {data.accounts.filter(a => !a.archived && a.currency === item.currency).length} active accounts · {data.holdings.filter(h => (h.currency ?? 'EUR') === item.currency).length} investment positions · Currency {item.currency}
                        </p>
                      </div>
                      <Badge color="teal" variant="light" size="md">{item.currency}</Badge>
                    </div>

                    <div className="stat-tiles-grid">
                      <StatTile
                        label="Total Net Wealth"
                        value={money(item.total_minor, item.currency)}
                        hint="Consolidated capital across liquid cash and investments."
                      />

                      <StatTile
                        label="Investment Profit"
                        value={
                          item.invested_minor > 0
                            ? `${investedChange >= 0 ? '+' : ''}${money(investedChange, item.currency)}`
                            : '—'
                        }
                        positive={item.invested_minor > 0 && investedChange >= 0}
                        negative={item.invested_minor > 0 && investedChange < 0}
                        hint={
                          item.invested_minor > 0
                            ? `Return of ${investedChange >= 0 ? '+' : ''}${investedPct}% on ${money(item.invested_minor, item.currency)} capital paid in.`
                            : 'No investment purchase cost basis recorded.'
                        }
                      />

                      <StatTile
                        label="Annual Net Flow"
                        value={`${netPassiveBalance >= 0 ? '+' : ''}${money(netPassiveBalance, item.currency)}/yr`}
                        positive={netPassiveBalance >= 0}
                        negative={netPassiveBalance < 0}
                        hint={`+${money(item.net_revenue_minor, item.currency)}/yr net interest after -${money(annualTERDrag, item.currency)}/yr TER fund fees.`}
                      />

                      <StatTile
                        label="Liquid Cash"
                        value={money(item.balance_minor, item.currency)}
                        hint={`${cashRatio}% liquidity ratio · Gross interest +${money(item.gross_revenue_minor, item.currency)}/yr.`}
                      />
                    </div>
                  </Card>

                  {/* Area 2: Asset Allocation & Composition */}
                  <Card withBorder className="section-card" p="md" radius="md">
                    <div className="section-card-header">
                      <div>
                        <h2 className="section-card-title">Asset Allocation</h2>
                        <p className="section-card-meta">
                          Distribution across liquid cash and investment asset classes
                        </p>
                      </div>
                      <Text size="xs" c="dimmed">
                        Total Assets: <Text span fw={750} c="inherit">{money(item.total_minor, item.currency)}</Text>
                      </Text>
                    </div>
                    <Card withBorder className="solid-inner-card" p="sm" radius="md">
                      <AllocationBar
                        total={item.total_minor}
                        segments={[
                          { label: 'Cash', value: item.balance_minor },
                          ...allocations.map(a => ({ label: label(a.asset_class), value: a.value_minor })),
                        ]}
                      />
                    </Card>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="sm" mt="sm">
                      <Card withBorder className="asset-card" p="sm" radius="md">
                        <Group justify="space-between" align="center">
                          <Group gap={6}>
                            <Box w={8} h={8} style={{ borderRadius: '50%', background: 'var(--mantine-color-cyan-5)' }} />
                            <Text size="xs" fw={700}>Liquid Cash</Text>
                          </Group>
                          <Badge size="xs" variant="light" color="cyan">{cashRatio}%</Badge>
                        </Group>
                        <Text size="md" fw={750} mt={4} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {money(item.balance_minor, item.currency)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          Net interest: +{money(item.net_revenue_minor, item.currency)}/yr
                        </Text>
                      </Card>
                      {allocations.map(a => {
                        const sharePct = item.total_minor > 0 ? ((a.value_minor / item.total_minor) * 100).toFixed(1) : '0';
                        const matchingCount = data.holdings.filter(h => {
                          if ((h.currency ?? 'EUR') !== item.currency) return false;
                          const inst = instMap.get(h.instrument_id);
                          return (inst?.asset_class ?? 'equity') === a.asset_class;
                        }).length;

                        return (
                          <Card key={a.asset_class} withBorder className="asset-card" p="sm" radius="md">
                            <Group justify="space-between" align="center">
                              <Group gap={6}>
                                <Box w={8} h={8} style={{ borderRadius: '50%', background: 'var(--mantine-color-teal-5)' }} />
                                <Text size="xs" fw={700}>{label(a.asset_class)}</Text>
                              </Group>
                              <Badge size="xs" variant="light" color="teal">{sharePct}%</Badge>
                            </Group>
                            <Text size="md" fw={750} mt={4} style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {money(a.value_minor, item.currency)}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {matchingCount > 0 ? `${matchingCount} position${matchingCount > 1 ? 's' : ''}` : 'Allocated assets'}
                            </Text>
                          </Card>
                        );
                      })}
                    </SimpleGrid>
                  </Card>

                  {/* Area 3: Milestones & Financial Independence */}
                  <Card withBorder className="section-card" p="md" radius="md">
                    <div className="section-card-header">
                      <div>
                        <h2 className="section-card-title">Financial Independence & Milestones</h2>
                        <p className="section-card-meta">
                          Emergency liquidity reserves and safe withdrawal capacity
                        </p>
                      </div>
                    </div>
                    <SimpleGrid cols={{ base: 1, md: profile.show_fire_calculator ? 2 : 1 }} spacing="sm">
                      <EmergencyReserveCard cashMinor={item.balance_minor} currency={item.currency} />
                      {profile.show_fire_calculator && (
                        <FreedomCalculatorCard totalWealthMinor={item.total_minor} currency={item.currency} />
                      )}
                    </SimpleGrid>
                  </Card>
                </Stack>
              );
            })
          )}
          <SnapshotHistory snapshots={data.snapshots} currency={data.summary.base_currency} reload={reload} />
        </>
      )}
    </ViewShell>
  );
}

function SnapshotHistory({ snapshots, currency, reload }: { snapshots: Snapshot[]; currency: string; reload: () => Promise<void> }) {
  const [observedOn, setObservedOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Snapshot>();
  const [error, setError] = useState('');
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const table = useBackendRows('/api/snapshots', snapshots, 'date', 'desc');
  const current = snapshots.filter(item => item.currency === currency).sort((a, b) => a.observed_on.localeCompare(b.observed_on));

  const displayRows = useMemo(() => {
    const rows = [...table.rows];
    if (!table.sort || (table.sort === 'date' && table.direction === 'desc')) {
      return rows.sort((a, b) => b.observed_on.localeCompare(a.observed_on));
    }
    if (table.sort === 'date' && table.direction === 'asc') {
      return rows.sort((a, b) => a.observed_on.localeCompare(b.observed_on));
    }
    return rows;
  }, [table.rows, table.sort, table.direction]);

  const deltaMap = new Map<number, { diff: number; pct: number }>();
  for (let i = 0; i < current.length; i++) {
    if (i === 0) {
      deltaMap.set(current[i].id, { diff: 0, pct: 0 });
    } else {
      const prev = current[i - 1];
      const diff = current[i].total_minor - prev.total_minor;
      const pct = prev.total_minor > 0 ? (diff / prev.total_minor) * 100 : 0;
      deltaMap.set(current[i].id, { diff, pct });
    }
  }

  const removeSnapshot = (item: Snapshot) => {
    confirmDelete('snapshot', `${item.observed_on} (${money(item.total_minor, item.currency)})`, async () => {
      await api(`/api/snapshots/${item.id}`, { method: 'DELETE' });
      await reload();
    });
  };

  const columns: DataColumn<Snapshot>[] = [
    { key: 'date', label: 'Date', sortable: true, render: item => new Date(`${item.observed_on}T00:00:00`).toLocaleDateString() },
    { key: 'currency', label: 'Currency', sortable: true, render: item => <Badge variant="light" color="teal" size="xs">{item.currency}</Badge> },
    { key: 'cash', label: 'Cash', sortable: true, align: 'right', render: item => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{money(item.cash_minor, item.currency)}</span> },
    { key: 'portfolio', label: 'Investments', sortable: true, align: 'right', render: item => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{money(item.portfolio_minor, item.currency)}</span> },
    { key: 'total', label: 'Total', sortable: true, align: 'right', render: item => <Text fw={750} style={{ fontFamily: 'ui-monospace, monospace' }}>{money(item.total_minor, item.currency)}</Text> },
    {
      key: 'change',
      label: 'Change',
      sortable: false,
      align: 'right',
      render: item => {
        const delta = deltaMap.get(item.id);
        if (!delta || (delta.diff === 0 && delta.pct === 0)) {
          return <Text size="xs" c="dimmed">—</Text>;
        }
        const isPositive = delta.diff >= 0;
        return (
          <Group gap={6} justify="flex-end" wrap="nowrap">
            <Text
              size="xs"
              fw={700}
              c={isPositive ? 'teal' : 'red'}
              style={{ fontFamily: 'ui-monospace, monospace' }}
            >
              {isPositive ? '+' : ''}{money(delta.diff, item.currency)}
            </Text>
            <Badge
              size="xs"
              variant="light"
              color={isPositive ? 'teal' : 'red'}
              style={{ fontFamily: 'ui-monospace, monospace' }}
            >
              {isPositive ? '+' : ''}{delta.pct.toFixed(1)}%
            </Badge>
          </Group>
        );
      },
    },
    {
      key: 'actions',
      align: 'right',
      render: item => (
        <TableActions>
          <TableAction label="Edit snapshot" onClick={() => setEditing(item)}>
            <IconPencil size={14} />
          </TableAction>
          <TableAction label="Delete snapshot" color="red" onClick={() => removeSnapshot(item)}>
            <IconTrash size={14} />
          </TableAction>
        </TableActions>
      ),
    },
  ];

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/snapshots', { method: 'POST', body: JSON.stringify({ observed_on: observedOn }) });
      setError('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg">
      {/* Area 4: Wealth Evolution Chart */}
      {current.length > 1 ? (
        <WealthChart snapshots={current} currency={currency} />
      ) : current.length === 1 ? (
        <Alert color="gray">Save one more snapshot to see the wealth trend over time.</Alert>
      ) : null}

      {/* Area 5: Snapshots History Ledger */}
      <Card withBorder className="section-card" p="md" radius="md">
        <div className="section-card-header">
          <div>
            <h2 className="section-card-title">Snapshots Ledger</h2>
            <p className="section-card-meta">
              Periodic historical snapshots of cash reserves and investment balances
            </p>
          </div>
          <Group align="end">
            <TextInput
              type="date"
              size="xs"
              label="Snapshot date"
              value={observedOn}
              onChange={event => setObservedOn(event.currentTarget.value)}
            />
            <Button size="xs" loading={saving} onClick={() => void save()}>
              Save snapshot
            </Button>
          </Group>
        </div>

        {(error || table.sortError) && <Alert color="red" mb="sm">{error || table.sortError}</Alert>}

        {snapshots.length === 0 ? (
          <Empty title="No snapshots yet" text="Update your balances and holdings, then save the current situation." />
        ) : (
          <DataTable
            rows={displayRows}
            columns={columns}
            rowKey={item => `${item.id}-${item.currency}`}
            minWidth={820}
            sort={table.sort}
            direction={table.direction}
            onSort={(key, direction) => void table.sortRows(key, direction)}
          />
        )}
      </Card>

      <SnapshotModal
        key={editing ? `${editing.id}-${editing.currency}` : 'closed'}
        snapshot={editing}
        close={() => setEditing(undefined)}
        saved={async () => {
          setEditing(undefined);
          await reload();
        }}
      />
      {confirmDeleteModal}
    </Stack>
  );
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
  const { ref: containerRef, width: containerWidth } = useElementSize();
  const chartWidth = Math.max(600, Math.round(containerWidth || 760));

  const shown = filterChartRange(snapshots, range);
  const active = metricKeys.filter(key => visible.includes(key));
  const scaleValues = (active.length ? active : metricKeys).flatMap(key => shown.map(metrics[key].value));
  const geometry = chartGeometry(scaleValues, undefined, true, chartWidth);
  const xPoints = chartGeometry(shown.map(() => 0), scaleValues, true, chartWidth).points;
  const hoverIndex = hovered === undefined ? undefined : Math.min(hovered, shown.length - 1);
  const hoverX = hoverIndex === undefined ? 0 : xPoints[hoverIndex].x;
  const dates = [0, Math.floor((shown.length - 1) / 2), shown.length - 1].filter((index, position, all) => all.indexOf(index) === position);

  return (
    <Card withBorder className="section-card" p="md" radius="md">
      <div className="section-card-header">
        <div>
          <h2 className="section-card-title">Wealth Evolution</h2>
          <p className="section-card-meta">
            Historical net worth progression over time
          </p>
        </div>
        <SegmentedControl size="xs" value={range} onChange={value => setRange(value as ChartRange)} data={['1w', '2w', '1m', '3m', '6m', '1y', '3y', '5y', 'max']} />
      </div>
      <Card withBorder className="solid-inner-card" p="md" radius="md">
        <Stack gap="sm" ref={containerRef}>
          <Group gap="xs" role="group" aria-label="Chart series">
          {metricKeys.map(key => (
            <Button
              key={key}
              size="compact-xs"
              variant={visible.includes(key) ? 'light' : 'subtle'}
              color={metrics[key].color}
              aria-pressed={visible.includes(key)}
              style={{ opacity: visible.includes(key) ? 1 : 0.45 }}
              leftSection={<Box w={14} h={2} bg={`${metrics[key].color}.5`} />}
              onClick={() => setVisible(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])}
            >
              {metrics[key].label}
            </Button>
          ))}
        </Group>
        <svg
          className="wealth-chart"
          viewBox={`0 0 ${chartWidth} 260`}
          role="img"
          tabIndex={0}
          aria-label={hoverIndex === undefined ? 'Wealth history. Hover or use arrow keys to inspect snapshots.' : `${shown[hoverIndex].observed_on}: ${active.map(key => `${metrics[key].label} ${money(metrics[key].value(shown[hoverIndex]), currency)}`).join(', ')}`}
          style={{ width: '100%', height: 260, display: 'block', cursor: 'crosshair' }}
          onPointerMove={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setHovered(nearestChartIndex(((event.clientX - bounds.left) / bounds.width) * chartWidth, shown.length, chartWidth));
          }}
          onPointerLeave={() => setHovered(undefined)}
          onFocus={() => setHovered(current => current ?? shown.length - 1)}
          onBlur={() => setHovered(undefined)}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setHovered(current => Math.min(shown.length - 1, Math.max(0, (current ?? shown.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
          }}
        >
          {active.length === 0 ? (
            <text x={chartWidth / 2} y="130" textAnchor="middle">Enable a series to show it</text>
          ) : (
            <>
              {[0, 1, 2, 3].map(index => {
                const ratio = index / 3;
                const y = 24 + ratio * 196;
                const value = geometry.high - ratio * (geometry.high - geometry.low);
                return (
                  <g key={index}>
                    <line x1="74" x2={chartWidth - 20} y1={y} y2={y} stroke="currentColor" opacity="0.12" />
                    <text x="66" y={y + 4} textAnchor="end">{compactMoney(value, currency)}</text>
                  </g>
                );
              })}
              {active.map(key => {
                const values = shown.map(metrics[key].value);
                const series = chartGeometry(values, scaleValues, true, chartWidth);
                const points = series.points.map(point => `${point.x},${point.y}`).join(' ');
                return (
                  <g key={key}>
                    <polyline points={points} fill="none" stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    {series.points.map((point, index) => (
                      <circle key={shown[index].observed_on} cx={point.x} cy={point.y} r="3" fill="var(--mantine-color-body)" stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2">
                        <title>{`${metrics[key].label} · ${shown[index].observed_on}: ${money(values[index], currency)}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
              {dates.map(index => (
                <text key={index} x={xPoints[index].x} y="248" textAnchor={shown.length === 1 ? 'middle' : index === 0 ? 'start' : index === shown.length - 1 ? 'end' : 'middle'}>
                  {new Date(`${shown[index].observed_on}T00:00:00`).toLocaleDateString()}
                </text>
              ))}
              {hoverIndex !== undefined && (
                <>
                  <line x1={hoverX} x2={hoverX} y1="24" y2="220" stroke="currentColor" strokeDasharray="4 4" opacity="0.45" />
                  {active.map(key => {
                    const point = chartGeometry(shown.map(metrics[key].value), scaleValues, true, chartWidth).points[hoverIndex];
                    return <circle key={key} cx={point.x} cy={point.y} r="5" fill="var(--mantine-color-body)" stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2" />;
                  })}
                  <g transform={`translate(${hoverX > chartWidth - 230 ? hoverX - 212 : hoverX + 12} 32)`} style={{ pointerEvents: 'none' }}>
                    <rect width="200" height={32 + active.length * 20} rx="8" fill="var(--mantine-color-body)" stroke="currentColor" strokeOpacity="0.25" />
                    <text x="12" y="20" style={{ fontWeight: 700 }}>{new Date(`${shown[hoverIndex].observed_on}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })}</text>
                    {active.map((key, index) => (
                      <g key={key}>
                        <line x1="12" x2="24" y1={42 + index * 20} y2={42 + index * 20} stroke={`var(--mantine-color-${metrics[key].color}-5)`} strokeWidth="2" />
                        <text x="30" y={46 + index * 20}>{metrics[key].label}: {money(metrics[key].value(shown[hoverIndex]), currency)}</text>
                      </g>
                    ))}
                  </g>
                </>
              )}
            </>
          )}
        </svg>
      </Stack>
      </Card>
    </Card>
  );
}
