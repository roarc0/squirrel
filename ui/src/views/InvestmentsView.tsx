import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconCheck,
  IconNotes,
  IconPencil,
  IconRepeat,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { api, type Account, type Holding, type Instrument, type TaxRate } from '../api';
import { AllocationBar, PerformanceResult, useBackendRows } from '../App';
import { Chip } from '../Chip';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn } from '../DataTable';
import { InvestModal } from '../InvestModal';
import { instrumentLabels, investedMoney, label, money, percent } from '../utils/format';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { useQueryParamArray } from '../hooks/useQueryParam';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';

type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

type HoldingDraft = {
  accountID: string;
  instrumentID: string;
  value: Numeric;
  sinceBuy: Numeric;
  planned: Numeric;
  tax: Numeric;
  isPAC: boolean;
  pacBps: Numeric;
  pacFrequency: string;
  notes: string;
};

function PacAmountEditor({ account, currency, onSaved }: { account: Account; currency: string; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  const start = () => { setValue((account.pac_amount_minor ?? 0) / 100); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...account, pac_amount_minor: Math.round(Number(value) * 100) }),
      });
      notifications.show({ color: 'teal', title: 'PAC budget updated', message: `Monthly deposit set to ${money(Math.round(Number(value) * 100), currency)}/mo` });
      setEditing(false);
      await onSaved();
    } catch (cause) {
      notifications.show({ color: 'red', title: 'Failed to update PAC budget', message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') cancel(); };

  if (!editing) {
    return (
      <Group gap={6} align="center" wrap="nowrap" justify="flex-end">
        <Text size="xl" fw={800} c="teal">{money(account.pac_amount_minor ?? 0, currency)}/mo</Text>
        <Tooltip label="Edit monthly deposit" position="top" withArrow>
          <ActionIcon size={20} variant="subtle" color="teal" onClick={start}>
            <IconPencil size={13} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center" justify="flex-end">
      <NumberInput size="sm" w={110} min={0} decimalScale={2} value={value} onChange={setValue} onKeyDown={onKey} autoFocus
        leftSection={<Text size="xs" c="dimmed">{currency}</Text>} leftSectionWidth={36} />
      <ActionIcon size={26} variant="filled" color="teal" loading={saving} onClick={() => void save()}>
        <IconCheck size={14} />
      </ActionIcon>
      <ActionIcon size={26} variant="subtle" color="gray" onClick={cancel}>
        <IconX size={14} />
      </ActionIcon>
    </Group>
  );
}

function PacBpsEditor({ holding, onSaved }: { holding: Holding; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  const start = () => { setValue((holding.pac_bps ?? 0) / 100); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/holdings/${holding.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...holding, pac_bps: Math.round(Number(value) * 100) }),
      });
      notifications.show({ color: 'teal', title: 'PAC updated', message: `${holding.instrument_name} → ${Number(value).toFixed(2)}%` });
      setEditing(false);
      await onSaved();
    } catch (cause) {
      notifications.show({ color: 'red', title: 'Failed to update PAC', message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') cancel(); };

  if (!editing) {
    return (
      <Group gap={4} wrap="nowrap" align="center">
        <Badge color="teal" variant="filled" size="sm" style={{ flexShrink: 0 }}>
          <Group gap={3} align="center">
            <IconRepeat size={11} />
            <span>{percent(holding.pac_bps ?? 0)}</span>
          </Group>
        </Badge>
        <Tooltip label="Edit PAC %" position="top" withArrow>
          <ActionIcon size={18} variant="subtle" color="teal" onClick={start} style={{ flexShrink: 0 }}>
            <IconPencil size={12} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center">
      <NumberInput
        size="xs"
        w={72}
        min={0}
        max={100}
        decimalScale={2}
        value={value}
        onChange={setValue}
        onKeyDown={onKey}
        autoFocus
        rightSection={<Text size="xs" c="dimmed" pr={4}>%</Text>}
        rightSectionWidth={20}
        styles={{ input: { paddingRight: 20 } }}
      />
      <ActionIcon size={22} variant="filled" color="teal" loading={saving} onClick={() => void save()}>
        <IconCheck size={12} />
      </ActionIcon>
      <ActionIcon size={22} variant="subtle" color="gray" onClick={cancel}>
        <IconX size={12} />
      </ActionIcon>
    </Group>
  );
}

export function InvestmentsView({ holdings, accounts, instruments, taxRates, reload, onOpenDrafts }: { holdings: Holding[]; accounts: Account[]; instruments: Instrument[]; taxRates: TaxRate[]; reload: () => Promise<void>; onOpenDrafts?: () => void }) {
  const [opened, setOpened] = useState(false); const [editing, setEditing] = useState<Holding>(); const [error, setError] = useState('');
  const [accountIDs, setAccountIDs] = useQueryParamArray('accounts');
  const [selectedAssetClass, setSelectedAssetClass] = useState<string | null>(null);
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const table = useBackendRows('/api/holdings', holdings, 'value', 'desc');
  const activeAccounts = accounts.filter(account => !account.archived); const activeAccountIDs = new Set(activeAccounts.map(account => account.id));
  const accountMap = new Map<number, Account>(accounts.map(a => [a.id, a]));
  const open = (holding?: Holding) => { setEditing(holding); setOpened(true); };
  const remove = (holding: Holding) => {
    confirmDelete('investment', `${holding.instrument_name} · ${holding.account_name}`, async () => {
      try { await api(`/api/holdings/${holding.id}`, { method: 'DELETE' }); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    });
  };
  const ready = activeAccounts.length > 0 && instruments.length > 0;
  const activeHoldings = table.rows.filter(holding => activeAccountIDs.has(holding.account_id));
  const visibleHoldings = activeHoldings.filter(holding => accountIDs.length === 0 || accountIDs.includes(String(holding.account_id)));
  const displayedHoldings = visibleHoldings.filter(holding => !selectedAssetClass || holding.asset_class === selectedAssetClass);
  const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));
  const totals = new Map<string, { value: number; invested: number; count: number; weightedTERNum: number; annualFeeDrag: number; classes: Map<string, number> }>();
  for (const holding of visibleHoldings) {
    const currency = holding.currency ?? 'EUR';
    const summary = totals.get(currency) ?? { value: 0, invested: 0, count: 0, weightedTERNum: 0, annualFeeDrag: 0, classes: new Map<string, number>() };
    const assetClass = holding.asset_class || 'other';
    const inst = instMap.get(holding.instrument_id);
    const terBps = inst?.ter_bps ?? 0;

    summary.value += holding.value_minor;
    summary.invested += holding.invested_minor;
    summary.count++;
    summary.weightedTERNum += holding.value_minor * terBps;
    summary.annualFeeDrag += Math.round((holding.value_minor * terBps) / 10000);
    summary.classes.set(assetClass, (summary.classes.get(assetClass) ?? 0) + holding.value_minor);
    totals.set(currency, summary);
  }
  const actualBPS = (holding: Holding) => { const total = totals.get(holding.currency ?? 'EUR')?.value ?? 0; return total > 0 ? Math.round(holding.value_minor * 10_000 / total) : 0; };
  const columns: DataColumn<Holding>[] = [
    { key: 'account', label: 'Account', sortable: true, render: holding => <><Text fw={650}>{holding.account_name}</Text><Text size="xs" c="dimmed">{holding.currency}</Text></> },
    {
      key: 'instrument',
      label: 'Instrument',
      sortable: true,
      render: holding => (
        <Stack gap={2}>
          <Text fw={650}>{holding.instrument_name}</Text>
          <Text size="xs" c="dimmed">
            {[holding.instrument_ticker, holding.instrument_isin].filter(Boolean).join(' · ')}
          </Text>
          {holding.notes && (
            <Group gap={4} align="center" wrap="nowrap">
              <IconNotes size={13} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
              <Text size="xs" c="dimmed" fs="italic" lineClamp={2}>
                {holding.notes}
              </Text>
            </Group>
          )}
        </Stack>
      ),
    },
    { key: 'type', label: 'Type', sortable: true, render: holding => <Chip>{instrumentLabels[holding.instrument_type ?? 'other']}</Chip> },
    { key: 'asset_class', label: 'Asset class', sortable: true, render: holding => <Chip>{label(holding.asset_class || 'other')}</Chip> },
    {
      key: 'pac',
      label: 'PAC',
      sortable: true,
      align: 'right',
      render: holding => {
        const account = accountMap.get(holding.account_id);
        const totalPacMinor = account?.pac_amount_minor ?? 0;
        const pacBps = holding.pac_bps ?? 0;
        const calcAmountMinor = totalPacMinor > 0 && pacBps > 0 ? Math.round((totalPacMinor * pacBps) / 10000) : 0;

        if (holding.is_pac && pacBps > 0) {
          const freq = (holding.pac_frequency || 'monthly');
          const pctStr = percent(pacBps);
          const amtStr = calcAmountMinor > 0 ? money(calcAmountMinor, holding.currency ?? 'EUR') : '';
          return (
            <Stack gap={2} align="flex-end" style={{ minWidth: 100 }}>
              <Badge color="teal" variant="filled" size="xs" style={{ height: 'auto', padding: '3px 8px', textTransform: 'none', whiteSpace: 'normal', textAlign: 'right' }}>
                <Group gap={3} align="center" justify="end">
                  <IconRepeat size={11} />
                  <span>{pctStr}</span>
                </Group>
              </Badge>
              {amtStr ? (
                <Text size="xs" fw={700} c="teal">
                  {amtStr}/{freq.slice(0, 2)}
                </Text>
              ) : null}
            </Stack>
          );
        }
        return <Text c="dimmed">—</Text>;
      },
    },
    { key: 'ter', label: 'TER / Fee Drag', sortable: true, align: 'right', render: holding => {
      const terBps = holding.ter_bps ?? instMap.get(holding.instrument_id)?.ter_bps;
      if (!terBps || terBps <= 0) return <Text c="dimmed">—</Text>;
      const annualDragMinor = Math.round((holding.value_minor * terBps) / 10000);
      return (
        <Stack gap={1} align="flex-end">
          <Text size="sm">{percent(terBps)}</Text>
          <Text size="xs" c="orange">-{money(annualDragMinor, holding.currency ?? 'EUR')}/yr</Text>
        </Stack>
      );
    } },
    { key: 'value', label: 'Current value', sortable: true, align: 'right', render: holding => <Text fw={650}>{money(holding.value_minor, holding.currency ?? 'EUR')}</Text> },
    { key: 'actual', label: 'Actual', sortable: true, align: 'right', render: holding => percent(actualBPS(holding)) },
    { key: 'invested', label: 'Amount invested', sortable: true, align: 'right', render: holding => investedMoney(holding.invested_minor, holding.value_minor, holding.currency ?? 'EUR') },
    { key: 'change', label: 'Gain / loss', sortable: true, align: 'right', render: holding => { if (holding.invested_minor === 0) return <Text c="dimmed">—</Text>; const change = holding.value_minor - holding.invested_minor; return <Stack gap={1} align="flex-end"><Text fw={650} c={change >= 0 ? 'teal' : 'red'}>{money(change, holding.currency ?? 'EUR')}</Text><Text size="xs" c="dimmed">{change >= 0 ? '+' : ''}{(change / holding.invested_minor * 100).toFixed(1)}%</Text></Stack>; } },
    { key: 'tax', label: 'Tax', sortable: true, align: 'right', render: holding => percent(holding.tax_bps) },
    { key: 'actions', align: 'right', render: holding => <TableActions><TableAction label={`Edit ${holding.instrument_name}`} onClick={() => open(holding)}><IconPencil size={14} /></TableAction><TableAction label={`Delete ${holding.instrument_name}`} color="red" onClick={() => void remove(holding)}><IconTrash size={14} /></TableAction></TableActions> },
  ];
  const [investOpened, setInvestOpened] = useState(false);

  // Compute PAC accumulation metrics & TER drag, ordered from highest % to lowest %
  const activePacHoldings = visibleHoldings
    .filter(h => h.is_pac && (h.pac_bps ?? 0) > 0)
    .sort((a, b) => (b.pac_bps ?? 0) - (a.pac_bps ?? 0));

  const totalMonthlyPacMinor = activeAccounts.reduce((acc, a) => acc + (a.pac_amount_minor ?? 0), 0);
  const currency = visibleHoldings[0]?.currency ?? 'EUR';

  let totalPacWeightedTERNum = 0;
  let totalPacMonthlyInvestedMinor = 0;
  let totalPacAnnualFeeDragMinor = 0;

  const pacItems = activePacHoldings.map(h => {
    const acc = accountMap.get(h.account_id);
    const inst = instMap.get(h.instrument_id);
    const totalAccPac = acc?.pac_amount_minor ?? 0;
    const itemMonthlyMinor = totalAccPac > 0 && h.pac_bps ? Math.round((totalAccPac * h.pac_bps) / 10000) : 0;
    const itemYearlyMinor = itemMonthlyMinor * 12;
    const terBps = h.ter_bps ?? inst?.ter_bps ?? 0;
    const annualDragMinor = Math.round((itemYearlyMinor * terBps) / 10000);

    totalPacMonthlyInvestedMinor += itemMonthlyMinor;
    totalPacWeightedTERNum += itemMonthlyMinor * terBps;
    totalPacAnnualFeeDragMinor += annualDragMinor;

    return {
      holding: h,
      accountName: h.account_name,
      instrumentName: h.instrument_name,
      ticker: h.instrument_ticker,
      isin: h.instrument_isin,
      pacBps: h.pac_bps ?? 0,
      itemMonthlyMinor,
      itemYearlyMinor,
      terBps,
      annualDragMinor,
    };
  });

  const pacWeightedTERBps = totalPacMonthlyInvestedMinor > 0 ? totalPacWeightedTERNum / totalPacMonthlyInvestedMinor : 0;

  // PAC accounts (accounts that have active PAC holdings, ordered by preference)
  const pacAccountsList = [...new Set(pacItems.map(i => i.holding.account_id))]
    .map(id => activeAccounts.find(a => a.id === id))
    .filter(Boolean) as Account[];

  // Per-account PAC allocation totals
  const pacByAccount = new Map<number, { name: string; allocatedBps: number }>();
  pacItems.forEach(item => {
    const cur = pacByAccount.get(item.holding.account_id);
    pacByAccount.set(item.holding.account_id, {
      name: item.accountName ?? 'Account',
      allocatedBps: (cur?.allocatedBps ?? 0) + item.pacBps,
    });
  });

  return (
    <ViewShell error={error || table.sortError}>
      <SectionHeader
        title="Investments"
        subtitle="Actual allocation uses current investment values within each currency; planned allocation is your target."
        actions={
          <Group gap="sm" align="center" wrap="wrap">
            {activeAccounts.length > 0 && (
              <MultiSelect
                w={240}
                searchable
                clearable
                placeholder="Filter by account"
                value={accountIDs}
                data={activeAccounts.map(account => ({ value: String(account.id), label: account.name }))}
                onChange={setAccountIDs}
              />
            )}
            <Button variant="light" color="teal" disabled={!ready} onClick={() => setInvestOpened(true)}>Invest & Rebalance</Button>
            <Button disabled={!ready} onClick={() => open()}>Add investment</Button>
          </Group>
        }
      />

    {totalMonthlyPacMinor > 0 && (
      <Card className="metric" p="lg" radius="lg">
        <Group justify="space-between" align="start" mb="md">
          <Box>
            <Group gap="xs" mb={2}>
              <IconRepeat size={18} color="var(--mantine-color-teal-6)" />
              <Text fw={800} size="lg">Active Accumulation Plan (PAC)</Text>
              <Badge color="teal" variant="filled">{activePacHoldings.length} Active PAC Investments</Badge>
            </Group>
            <Text size="xs" c="dimmed">Recurring automated dollar-cost averaging investments per account.</Text>
          </Box>

          <Group gap="xl">
            <Box ta="right">
              <Text size="xs" c="dimmed">Monthly Deposit</Text>
              {pacAccountsList.length === 1 ? (
                <PacAmountEditor account={pacAccountsList[0]} currency={currency} onSaved={reload} />
              ) : (
                <Stack gap={2} align="flex-end">
                  {pacAccountsList.map(a => (
                    <PacAmountEditor key={a.id} account={a} currency={currency} onSaved={reload} />
                  ))}
                </Stack>
              )}
            </Box>
            <Box ta="right">
              <Text size="xs" c="dimmed">Yearly Investment</Text>
              <Text size="xl" fw={800} c="teal">{money(totalMonthlyPacMinor * 12, currency)}/yr</Text>
            </Box>
            <Box ta="right">
              <Text size="xs" c="dimmed">Weighted PAC TER</Text>
              <Text size="lg" fw={800} c="dimmed">{percent(pacWeightedTERBps)}</Text>
              <Text size="xs" c="orange">-{money(totalPacAnnualFeeDragMinor, currency)}/yr drag</Text>
            </Box>
            <Box ta="right">
              <Text size="xs" c="dimmed">5-Yr Capital Projection</Text>
              <Text size="md" fw={700}>{money(totalMonthlyPacMinor * 60, currency)}</Text>
              {totalPacAnnualFeeDragMinor > 0 && (
                <Text size="xs" c="orange">-{money(totalPacAnnualFeeDragMinor * 5, currency)} 5yr fee drag</Text>
              )}
            </Box>
          </Group>
        </Group>

        {[...pacByAccount.entries()].map(([accountId, { name, allocatedBps }]) => {
          const pct = Math.min(allocatedBps / 100, 100);
          const over = allocatedBps > 10000;
          const full = allocatedBps === 10000;
          return (
            <Box key={accountId} mb="xs">
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">{name} · PAC allocation</Text>
                <Group gap={4} align="center">
                  <Text size="xs" fw={700} c={over ? 'red' : full ? 'teal' : 'dimmed'}>
                    {(allocatedBps / 100).toFixed(2)}% / 100%
                  </Text>
                  {full && <IconCheck size={12} color="var(--mantine-color-teal-6)" />}
                  {over && <IconAlertTriangle size={12} color="var(--mantine-color-red-6)" />}
                </Group>
              </Group>
              <Box h={14} bg="light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))" style={{ display: 'flex', overflow: 'hidden', borderRadius: 999 }}>
                <Box
                  bg={over ? 'red.5' : full ? 'teal.5' : 'yellow.5'}
                  style={{ width: `${pct}%`, borderRadius: 999, transition: 'width 0.3s ease' }}
                />
              </Box>
              {!full && !over && (
                <Text size="xs" c="dimmed" mt={2}>{((10000 - allocatedBps) / 100).toFixed(2)}% unallocated</Text>
              )}
            </Box>
          );
        })}
      </Card>
    )}

    {activeHoldings.length > 0 && visibleHoldings.length > 0 && (
      <SimpleGrid cols={{ base: 1, md: Math.min(2, Math.max(1, totals.size)) }}>
        {[...totals].map(([currency, summary]) => (
          <Card key={currency} className="metric" p="lg" radius="lg">
            <Group justify="space-between" align="start">
              <Box>
                <Text size="xs" c="dimmed">Visible investments · {currency}</Text>
                <Text size="xl" fw={750}>{money(summary.value, currency)}</Text>
              </Box>
              <Text size="sm" c="dimmed">{summary.count} {summary.count === 1 ? 'investment' : 'investments'}</Text>
            </Group>
            <Group justify="space-between" align="center" mt={5}>
              <Text size="xs" c="dimmed">Invested {investedMoney(summary.invested, summary.value, currency)}</Text>
              <PerformanceResult value={summary.value} invested={summary.invested} currency={currency} />
            </Group>
            <Group justify="space-between" align="center" mt={3}>
              <Text size="xs" c="dimmed">Weighted TER: <Text span fw={700} c="dimmed">{summary.value > 0 ? `${(summary.weightedTERNum / summary.value / 100).toFixed(2)}%` : '0.00%'}</Text></Text>
              <Text size="xs" c="dimmed">Fee drag: <Text span fw={700} c="orange">-{money(summary.annualFeeDrag, currency)}/yr</Text></Text>
            </Group>
            <AllocationBar
              total={summary.value}
              segments={[...summary.classes].map(([assetClass, value]) => ({ label: label(assetClass), value, key: assetClass }))}
              selectedKey={selectedAssetClass}
              onSelectKey={setSelectedAssetClass}
            />
          </Card>
        ))}
      </SimpleGrid>
    )}

    {selectedAssetClass && (
      <Group gap="xs" align="center" mt="xs">
        <Text size="xs" c="dimmed">Filtered by asset class:</Text>
        <Chip colorKey={selectedAssetClass || ''} variant="filled">{label(selectedAssetClass)}</Chip>
        <Button size="xs" variant="subtle" color="gray" onClick={() => setSelectedAssetClass(null)}>
          Clear filter ✕
        </Button>
      </Group>
    )}

    {!ready ? (
      <Empty title="Accounts and instruments required" text="Add an active account and an instrument before recording an investment." />
    ) : activeHoldings.length === 0 ? (
      <Empty title="No active investments" text="Add an investment or restore an archived account." />
    ) : visibleHoldings.length === 0 ? (
      <Empty title="No matching investments" text="Choose another account or clear the filter." />
    ) : displayedHoldings.length === 0 ? (
      <Empty title="No matching asset class investments" text={`No investments found under ${label(selectedAssetClass || '')}. Clear filter to show all.`} />
    ) : (
      <DataTable
        rows={displayedHoldings}
        columns={columns}
        rowKey={holding => holding.id}
        minWidth={1080}
        sort={table.sort}
        direction={table.direction}
        onSort={(key, direction) => void table.sortRows(key, direction)}
        rowStyle={holding => {
          const isPacActive = holding.is_pac && (holding.pac_bps ?? 0) > 0;
          return {
            opacity: isPacActive ? 1 : 0.65,
            backgroundColor: isPacActive ? 'var(--mantine-color-teal-light)' : undefined,
            borderLeft: isPacActive ? '4px solid var(--mantine-color-teal-5)' : undefined,
          };
        }}
      />
    )}
    <HoldingModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} holding={editing} accounts={activeAccounts} holdings={holdings} instruments={instruments} taxRates={taxRates} saved={async () => { setOpened(false); await reload(); }} />
    <InvestModal opened={investOpened} onClose={() => setInvestOpened(false)} holdings={holdings} reload={reload} />
    {confirmDeleteModal}
  </ViewShell>
  );
}

function HoldingModal({ opened, close, holding, accounts, holdings, instruments, taxRates, saved }: { opened: boolean; close: () => void; holding?: Holding; accounts: Account[]; holdings: Holding[]; instruments: Instrument[]; taxRates: TaxRate[]; saved: () => Promise<void> }) {
  const [form, setForm] = useState<HoldingDraft>(() => holding ? { accountID: String(holding.account_id), instrumentID: String(holding.instrument_id), value: holding.value_minor / 100, sinceBuy: holding.invested_minor ? (holding.value_minor - holding.invested_minor) / 100 : '', planned: holding.planned_bps / 100, tax: holding.tax_bps / 100, isPAC: Boolean(holding.is_pac), pacBps: holding.pac_bps ? holding.pac_bps / 100 : '', pacFrequency: holding.pac_frequency || 'monthly', notes: holding.notes ?? '' } : { accountID: String(accounts.find(item => item.preferred)?.id ?? accounts[0]?.id ?? ''), instrumentID: String(instruments[0]?.id ?? ''), value: 0, sinceBuy: '', planned: 0, tax: (taxRates[0]?.rate_bps ?? 2600) / 100, isPAC: true, pacBps: '', pacFrequency: 'monthly', notes: '' });
  const [saving, setSaving] = useState(false);

  const selectedAccount = accounts.find(a => String(a.id) === form.accountID);
  const otherHoldingsPacBps = holdings
    .filter(h => String(h.account_id) === form.accountID && h.id !== holding?.id)
    .reduce((sum, h) => sum + (h.pac_bps ?? 0), 0);

  const currentEnteredPacBps = bps(form.pacBps);
  const totalAccountPacBps = otherHoldingsPacBps + currentEnteredPacBps;

  const save = async () => {
    setSaving(true);
    try {
      const value = minor(form.value);
      const pacBpsVal = bps(form.pacBps);
      const plannedBpsVal = bps(form.planned);
      const isPacActive = form.isPAC || pacBpsVal > 0;

      const invested = value === 0 ? 0 : (form.sinceBuy === '' ? value : value - minor(form.sinceBuy));
      if (invested < 0) throw new Error('Since-buy gain/loss cannot be greater than the current value');

      if (value === 0 && pacBpsVal === 0 && plannedBpsVal === 0) {
        throw new Error('Investments with €0 value require a positive PAC allocation percentage (e.g. 5%) or target weight');
      }

      const body = {
        account_id: Number(form.accountID),
        instrument_id: Number(form.instrumentID),
        invested_minor: invested,
        value_minor: value,
        planned_bps: plannedBpsVal,
        tax_bps: bps(form.tax),
        is_pac: isPacActive,
        pac_bps: pacBpsVal,
        pac_frequency: form.pacFrequency || 'monthly',
        notes: form.notes,
      };
      await api(holding ? `/api/holdings/${holding.id}` : '/api/holdings', { method: holding ? 'PUT' : 'POST', body: JSON.stringify(body) });
      notifications.show({ color: 'teal', title: holding ? 'Investment updated' : 'Investment added', message: holding ? 'Changes saved successfully.' : 'New investment added to your portfolio.' });
      await saved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      notifications.show({ color: 'red', title: 'Failed to save investment', message });
    } finally {
      setSaving(false);
    }
  };

  return <Modal opened={opened} onClose={close} title={holding ? 'Edit investment' : 'Add investment'}><Stack><Select searchable required label="Account" value={form.accountID} data={accounts.map(item => ({ value: String(item.id), label: `${item.name} · ${item.type}${item.preferred ? ' · default' : ''} · ${item.currency}` }))} onChange={value => setForm({ ...form, accountID: value ?? '' })} /><Select searchable required label="Instrument" nothingFoundMessage="No ticker, name, or ISIN match" value={form.instrumentID} data={instruments.map(item => ({ value: String(item.id), label: [item.ticker, item.name, instrumentLabels[item.instrument_type], item.isin].filter(Boolean).join(' · ') }))} onChange={value => setForm({ ...form, instrumentID: value ?? '' })} /><SimpleGrid cols={2}><NumberInput label="Current value" min={0} decimalScale={2} value={form.value} onChange={value => setForm({ ...form, value })} /><NumberInput label="Planned allocation (%)" min={0} max={100} decimalScale={2} value={form.planned} onChange={value => setForm({ ...form, planned: value })} /><NumberInput label="Since buy gain / loss (optional)" placeholder="Example: -0.85" decimalScale={2} value={form.sinceBuy} onChange={value => setForm({ ...form, sinceBuy: value })} /><NumberInput label="Applicable tax (%)" min={0} max={100} decimalScale={2} value={form.tax} onChange={value => setForm({ ...form, tax: value })} /></SimpleGrid><Textarea label="Notes & Context for AI Assistant" placeholder="e.g. Core global equity allocation for long-term 20yr wealth accumulation..." rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.currentTarget.value })} /><Group mt="xs" align="center" justify="space-between"><Checkbox label="Active Accumulation Plan (PAC / Dollar-cost averaging)" checked={form.isPAC || bps(form.pacBps) > 0} onChange={e => setForm({ ...form, isPAC: e.currentTarget.checked })} /></Group>{(form.isPAC || bps(form.pacBps) > 0) && <Stack gap="xs" mt="xs"><SimpleGrid cols={2}><NumberInput label="PAC Share of Account (%)" placeholder="e.g. 64" min={0} max={100} decimalScale={2} value={form.pacBps} onChange={value => setForm({ ...form, pacBps: value, isPAC: true })} /><Select label="PAC Frequency" value={form.pacFrequency} data={[{ value: 'monthly', label: 'Monthly' }, { value: 'biweekly', label: 'Biweekly' }, { value: 'weekly', label: 'Weekly' }, { value: 'quarterly', label: 'Quarterly' }]} onChange={val => setForm({ ...form, pacFrequency: val ?? 'monthly' })} /></SimpleGrid><Text size="xs" c={totalAccountPacBps > 10000 ? 'red' : 'dimmed'}>Total PAC allocated for {selectedAccount?.name || 'Account'}: <Text span fw={700}>{percent(totalAccountPacBps)}</Text> / 100.00% (Account Total: {money(selectedAccount?.pac_amount_minor ?? 0, selectedAccount?.currency ?? 'EUR')}/mo)</Text></Stack>}<Text size="xs" c="dimmed">Investments with €0 value are fully supported for new PAC accumulation plans prior to your first purchase.</Text><Select label="Tax preset" data={taxRates.map(item => ({ value: String(item.rate_bps), label: `${item.label} (${percent(item.rate_bps)})` }))} onChange={value => value && setForm({ ...form, tax: Number(value) / 100 })} /><Group justify="end"><Button loading={saving} onClick={() => void save()}>Save investment</Button></Group></Stack></Modal>;
}
