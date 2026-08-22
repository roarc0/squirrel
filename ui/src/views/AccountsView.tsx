import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Grid,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { api, type Account, type ReferenceRate, type TaxRate } from '../api';
import { useBackendRows } from '../App';
import { Chip } from '../Chip';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn } from '../DataTable';
import { confirmDelete as legacyConfirmDelete, money, percent } from '../utils/format';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';

type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

type TierDraft = { upTo: Numeric; kind: 'fixed' | 'reference'; rate: Numeric; reference: string; spread: Numeric };
type AccountDraft = { name: string; institution: string; type: Account['type']; preferred: boolean; archived: boolean; currency: string; balance: Numeric; tax: Numeric; fee: Numeric; pacAmount: Numeric; tiers: TierDraft[] };
const blankTier = (): TierDraft => ({ upTo: '', kind: 'fixed', rate: 0, reference: '', spread: 0 });
const blankAccount = (tax = 26): AccountDraft => ({ name: '', institution: '', type: 'bank', preferred: false, archived: false, currency: 'EUR', balance: 0, tax, fee: 0, pacAmount: '', tiers: [blankTier()] });

export function AccountsView({ accounts, rates, taxRates, reload }: { accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Account>();
  const [error, setError] = useState('');
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const table = useBackendRows('/api/accounts', accounts, 'total', 'desc');
  const open = (account?: Account) => { setEditing(account); setOpened(true); };
  const remove = (account: Account) => {
    confirmDelete('account', account.name, async () => {
      await api(`/api/accounts/${account.id}`, { method: 'DELETE' });
      await reload();
    }, 'Its current holdings will also be removed. Saved snapshots stay intact.');
  };
  const toggleArchived = async (account: Account) => { try { await api(`/api/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ ...account, archived: !account.archived }) }); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const columns: DataColumn<Account>[] = [
    { key: 'name', label: 'Account', sortable: true, render: account => <Stack gap={4}><Group gap={6} wrap="nowrap"><Text fw={650}>{account.name}</Text>{account.preferred && <Chip size="xs">Default</Chip>}{account.archived && <Chip size="xs" colorKey="Archived">Archived</Chip>}</Group><Group gap={5}><Chip size="xs">{account.type}</Chip>{account.institution && <Text size="xs" c="dimmed">{account.institution}</Text>}{account.pac_amount_minor ? <Chip colorKey="PAC">{`PAC ${money(account.pac_amount_minor, account.currency)}/mo`}</Chip> : null}</Group></Stack> },
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
    {confirmDeleteModal}
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
    tax: account.tax_bps / 100, fee: account.annual_fee_minor / 100, pacAmount: account.pac_amount_minor ? account.pac_amount_minor / 100 : '',
    tiers: (account.tiers ?? []).map(tier => ({ upTo: tier.up_to_minor === null ? '' : tier.up_to_minor / 100, kind: tier.fixed_rate_bps === null ? 'reference' : 'fixed', rate: (tier.fixed_rate_bps ?? 0) / 100, reference: tier.reference_code ?? '', spread: tier.spread_bps / 100 })),
  } : blankAccount((taxRates[0]?.rate_bps ?? 2600) / 100));
  const [error, setError] = useState('');
  const tier = (index: number, patch: Partial<TierDraft>) => setForm(current => ({ ...current, tiers: current.tiers.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const save = async () => {
    try {
      const body = {
        name: form.name, institution: form.institution, type: form.type, preferred: form.preferred, archived: form.archived, currency: form.currency.toUpperCase(), balance_minor: minor(form.balance), tax_bps: bps(form.tax), annual_fee_minor: minor(form.fee), pac_amount_minor: minor(form.pacAmount),
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
      <NumberInput label="Total Monthly PAC Amount" placeholder="e.g. 300" min={0} decimalScale={2} value={form.pacAmount} onChange={value => setForm({ ...form, pacAmount: value })} />
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
