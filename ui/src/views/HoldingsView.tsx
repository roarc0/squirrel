import { useState } from 'react';
import {
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
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { api, type Account, type Holding, type Instrument, type TaxRate } from '../api';
import { AllocationBar, PerformanceResult, useBackendRows } from '../App';
import { Chip } from '../Chip';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn } from '../DataTable';
import { InvestModal } from '../InvestModal';
import { confirmDelete, instrumentLabels, investedMoney, label, money, percent } from '../utils/format';

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
};

export function HoldingsView({ holdings, accounts, instruments, taxRates, reload }: { holdings: Holding[]; accounts: Account[]; instruments: Instrument[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  const [opened, setOpened] = useState(false); const [editing, setEditing] = useState<Holding>(); const [error, setError] = useState('');
  const [accountIDs, setAccountIDs] = useState<string[]>([]);
  const table = useBackendRows('/api/holdings', holdings, 'value', 'desc');
  const activeAccounts = accounts.filter(account => !account.archived); const activeAccountIDs = new Set(activeAccounts.map(account => account.id));
  const accountMap = new Map<number, Account>(accounts.map(a => [a.id, a]));
  const open = (holding?: Holding) => { setEditing(holding); setOpened(true); };
  const remove = async (holding: Holding) => { if (confirmDelete('holding', `${holding.instrument_name} · ${holding.account_name}`)) { try { await api(`/api/holdings/${holding.id}`, { method: 'DELETE' }); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } } };
  const ready = activeAccounts.length > 0 && instruments.length > 0;
  const activeHoldings = table.rows.filter(holding => activeAccountIDs.has(holding.account_id));
  const visibleHoldings = activeHoldings.filter(holding => accountIDs.length === 0 || accountIDs.includes(String(holding.account_id)));
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
    {
      key: 'pac',
      label: 'Strategy',
      sortable: true,
      render: holding => {
        const account = accountMap.get(holding.account_id);
        const totalPacMinor = account?.pac_amount_minor ?? 0;
        const pacBps = holding.pac_bps ?? 0;
        const calcAmountMinor = totalPacMinor > 0 && pacBps > 0 ? Math.round((totalPacMinor * pacBps) / 10000) : 0;

        if (holding.is_pac && pacBps > 0) {
          const freq = (holding.pac_frequency || 'monthly').slice(0, 2);
          const pctStr = percent(pacBps);
          const amtStr = calcAmountMinor > 0 ? money(calcAmountMinor, holding.currency ?? 'EUR') : '';
          return (
            <Badge color="teal" variant="filled" size="xs">
              🔄 PAC ({pctStr}{amtStr ? ` · ${amtStr}/${freq}` : ''})
            </Badge>
          );
        }
        return <Badge color="gray" variant="light" size="xs">One-off</Badge>;
      },
    },
    { key: 'account', label: 'Account', sortable: true, render: holding => <><Text fw={650}>{holding.account_name}</Text><Text size="xs" c="dimmed">{holding.currency}</Text></> },
    { key: 'instrument', label: 'Instrument', sortable: true, render: holding => <><Text fw={650}>{holding.instrument_name}</Text><Text size="xs" c="dimmed">{[holding.instrument_ticker, holding.instrument_isin].filter(Boolean).join(' · ')}</Text></> },
    { key: 'type', label: 'Type', sortable: true, render: holding => <Chip>{instrumentLabels[holding.instrument_type ?? 'other']}</Chip> },
    { key: 'asset_class', label: 'Asset class', sortable: true, render: holding => <Chip>{label(holding.asset_class || 'other')}</Chip> },
    { key: 'ter', label: 'TER / Fee Drag', sortable: true, render: holding => {
      const terBps = holding.ter_bps ?? instMap.get(holding.instrument_id)?.ter_bps;
      if (!terBps || terBps <= 0) return <Text c="dimmed">—</Text>;
      const annualDragMinor = Math.round((holding.value_minor * terBps) / 10000);
      return (
        <Stack gap={1}>
          <Text size="sm">{percent(terBps)}</Text>
          <Text size="xs" c="orange">-{money(annualDragMinor, holding.currency ?? 'EUR')}/yr</Text>
        </Stack>
      );
    } },
    { key: 'value', label: 'Current value', sortable: true, render: holding => <Text fw={650}>{money(holding.value_minor, holding.currency ?? 'EUR')}</Text> },
    { key: 'actual', label: 'Actual', sortable: true, render: holding => percent(actualBPS(holding)) },
    { key: 'planned', label: 'Planned', sortable: true, render: holding => holding.planned_bps > 0 ? percent(holding.planned_bps) : '—' },
    { key: 'invested', label: 'Amount invested', sortable: true, render: holding => investedMoney(holding.invested_minor, holding.value_minor, holding.currency ?? 'EUR') },
    { key: 'change', label: 'Gain / loss', sortable: true, render: holding => { if (holding.invested_minor === 0) return <Text c="dimmed">—</Text>; const change = holding.value_minor - holding.invested_minor; return <Stack gap={1}><Text fw={650} c={change >= 0 ? 'teal' : 'red'}>{money(change, holding.currency ?? 'EUR')}</Text><Text size="xs" c="dimmed">{change >= 0 ? '+' : ''}{(change / holding.invested_minor * 100).toFixed(1)}%</Text></Stack>; } },
    { key: 'tax', label: 'Tax', sortable: true, render: holding => percent(holding.tax_bps) },
    { key: 'actions', render: holding => <TableActions><TableAction label={`Edit ${holding.instrument_name}`} onClick={() => open(holding)}><IconPencil size={14} /></TableAction><TableAction label={`Delete ${holding.instrument_name}`} color="red" onClick={() => void remove(holding)}><IconTrash size={14} /></TableAction></TableActions> },
  ];
  const [investOpened, setInvestOpened] = useState(false);
  return <Stack gap="lg"><Group justify="space-between"><Box><Title order={2}>Holdings</Title><Text c="dimmed">Actual allocation uses current holding values within each currency; planned allocation is your target.</Text></Box><Group gap="sm"><Button variant="light" color="teal" disabled={!ready} onClick={() => setInvestOpened(true)}>Invest & Rebalance</Button><Button disabled={!ready} onClick={() => open()}>Add holding</Button></Group></Group>
    {(error || table.sortError) && <Alert color="red">{error || table.sortError}</Alert>}
    {activeHoldings.length > 0 && <><MultiSelect w="100%" maw={360} searchable clearable label="Accounts" placeholder="All accounts" value={accountIDs} data={activeAccounts.map(account => ({ value: String(account.id), label: account.name }))} onChange={setAccountIDs} />{visibleHoldings.length > 0 && <SimpleGrid cols={{ base: 1, md: Math.min(2, Math.max(1, totals.size)) }}>{[...totals].map(([currency, summary]) => <Card key={currency} className="metric" p="lg" radius="lg"><Group justify="space-between" align="start"><Box><Text size="xs" c="dimmed">Visible holdings · {currency}</Text><Text size="xl" fw={750}>{money(summary.value, currency)}</Text></Box><Text size="sm" c="dimmed">{summary.count} {summary.count === 1 ? 'holding' : 'holdings'}</Text></Group><Group justify="space-between" align="center" mt={5}><Text size="xs" c="dimmed">Invested {investedMoney(summary.invested, summary.value, currency)}</Text><PerformanceResult value={summary.value} invested={summary.invested} currency={currency} /></Group><Group justify="space-between" align="center" mt={3}><Text size="xs" c="dimmed">Weighted TER: <Text span fw={700} c="dimmed">{summary.value > 0 ? `${(summary.weightedTERNum / summary.value / 100).toFixed(2)}%` : '0.00%'}</Text></Text><Text size="xs" c="dimmed">Fee drag: <Text span fw={700} c="orange">-{money(summary.annualFeeDrag, currency)}/yr</Text></Text></Group><AllocationBar total={summary.value} segments={[...summary.classes].map(([assetClass, value]) => ({ label: label(assetClass), value }))} /></Card>)}</SimpleGrid>}</>}
    {!ready ? <Empty title="Accounts and instruments required" text="Add an active account and an instrument before recording a holding." /> : activeHoldings.length === 0 ? <Empty title="No active holdings" text="Add an investment or restore an archived account." /> : visibleHoldings.length === 0 ? <Empty title="No matching holdings" text="Choose another account or clear the filter." /> : <DataTable rows={visibleHoldings} columns={columns} rowKey={holding => holding.id} minWidth={1080} sort={table.sort} direction={table.direction} onSort={(key, direction) => void table.sortRows(key, direction)} rowStyle={holding => ({ opacity: holding.is_pac && (holding.pac_bps ?? 0) > 0 ? 1 : 0.75, backgroundColor: holding.is_pac && (holding.pac_bps ?? 0) > 0 ? 'rgba(32, 201, 151, 0.05)' : undefined })} />}
    <HoldingModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} holding={editing} accounts={activeAccounts} instruments={instruments} taxRates={taxRates} saved={async () => { setOpened(false); await reload(); }} />
    <InvestModal opened={investOpened} onClose={() => setInvestOpened(false)} holdings={holdings} reload={reload} />
  </Stack>;
}

function HoldingModal({ opened, close, holding, accounts, instruments, taxRates, saved }: { opened: boolean; close: () => void; holding?: Holding; accounts: Account[]; instruments: Instrument[]; taxRates: TaxRate[]; saved: () => Promise<void> }) {
  const [form, setForm] = useState<HoldingDraft>(() => holding ? { accountID: String(holding.account_id), instrumentID: String(holding.instrument_id), value: holding.value_minor / 100, sinceBuy: holding.invested_minor ? (holding.value_minor - holding.invested_minor) / 100 : '', planned: holding.planned_bps / 100, tax: holding.tax_bps / 100, isPAC: Boolean(holding.is_pac), pacBps: holding.pac_bps ? holding.pac_bps / 100 : '', pacFrequency: holding.pac_frequency || 'monthly' } : { accountID: String(accounts.find(item => item.preferred)?.id ?? accounts[0]?.id ?? ''), instrumentID: String(instruments[0]?.id ?? ''), value: 0, sinceBuy: '', planned: 0, tax: (taxRates[0]?.rate_bps ?? 2600) / 100, isPAC: true, pacBps: '', pacFrequency: 'monthly' });
  const [error, setError] = useState('');
  const save = async () => { try { const value = minor(form.value); const invested = form.sinceBuy === '' ? 0 : value - minor(form.sinceBuy); if (invested < 0) throw new Error('Since-buy gain/loss cannot be greater than the current value'); const body = { account_id: Number(form.accountID), instrument_id: Number(form.instrumentID), invested_minor: invested, value_minor: value, planned_bps: bps(form.planned), tax_bps: bps(form.tax), is_pac: form.isPAC, pac_bps: bps(form.pacBps), pac_frequency: form.pacFrequency || 'monthly' }; await api(holding ? `/api/holdings/${holding.id}` : '/api/holdings', { method: holding ? 'PUT' : 'POST', body: JSON.stringify(body) }); await saved(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  return <Modal opened={opened} onClose={close} title={holding ? 'Edit holding' : 'Add holding'}><Stack>{error && <Alert color="red">{error}</Alert>}<Select searchable required label="Account" value={form.accountID} data={accounts.map(item => ({ value: String(item.id), label: `${item.name} · ${item.type}${item.preferred ? ' · default' : ''} · ${item.currency}` }))} onChange={value => setForm({ ...form, accountID: value ?? '' })} /><Select searchable required label="Instrument" nothingFoundMessage="No ticker, name, or ISIN match" value={form.instrumentID} data={instruments.map(item => ({ value: String(item.id), label: [item.ticker, item.name, instrumentLabels[item.instrument_type], item.isin].filter(Boolean).join(' · ') }))} onChange={value => setForm({ ...form, instrumentID: value ?? '' })} /><SimpleGrid cols={2}><NumberInput label="Current value" min={0} decimalScale={2} value={form.value} onChange={value => setForm({ ...form, value })} /><NumberInput label="Planned allocation (%)" min={0} max={100} decimalScale={2} value={form.planned} onChange={value => setForm({ ...form, planned: value })} /><NumberInput label="Since buy gain / loss (optional)" placeholder="Example: -0.85" decimalScale={2} value={form.sinceBuy} onChange={value => setForm({ ...form, sinceBuy: value })} /><NumberInput label="Applicable tax (%)" min={0} max={100} decimalScale={2} value={form.tax} onChange={value => setForm({ ...form, tax: value })} /></SimpleGrid><Group mt="xs" align="center" justify="space-between"><Checkbox label="Active Accumulation Plan (PAC / Dollar-cost averaging)" checked={form.isPAC} onChange={e => setForm({ ...form, isPAC: e.currentTarget.checked })} /></Group>{form.isPAC && <SimpleGrid cols={2} mt="xs"><NumberInput label="PAC Share of Account (%)" placeholder="e.g. 50" min={0} max={100} decimalScale={2} value={form.pacBps} onChange={value => setForm({ ...form, pacBps: value })} /><Select label="PAC Frequency" value={form.pacFrequency} data={[{ value: 'monthly', label: 'Monthly' }, { value: 'biweekly', label: 'Biweekly' }, { value: 'weekly', label: 'Weekly' }, { value: 'quarterly', label: 'Quarterly' }]} onChange={val => setForm({ ...form, pacFrequency: val ?? 'monthly' })} /></SimpleGrid>}<Text size="xs" c="dimmed">PAC percentage allocates a portion of your total account PAC deposit. Sum of all PAC shares per account must not exceed 100%.</Text><Select label="Tax preset" data={taxRates.map(item => ({ value: String(item.rate_bps), label: `${item.label} (${percent(item.rate_bps)})` }))} onChange={value => value && setForm({ ...form, tax: Number(value) / 100 })} /><Group justify="end"><Button onClick={() => void save()}>Save holding</Button></Group></Stack></Modal>;
}
