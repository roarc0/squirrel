import { useState, useEffect } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
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
  IconBriefcase,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconFlask,
  IconGlobe,
  IconNotes,
  IconPencil,
  IconRepeat,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { api, type Account, type Holding, type Instrument, type TaxRate } from '../api';
import { GeoRadarSection } from './GeoRadarView';
import { DraftPortfoliosView } from './DraftPortfoliosView';
import { SubnavTabs } from '../components/SubnavTabs';
import { AllocationBar, PerformanceResult, useBackendRows } from '../App';
import { copyToClipboard } from '../utils/copyToClipboard';
import { Chip, ISINBadge, TickerBadge } from '../Chip';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn } from '../DataTable';
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
      <Group gap={4} align="center" wrap="nowrap">
        <Badge color="teal" variant="light" size="sm" style={{ height: 'auto', padding: '2px 6px' }}>
          <Text fw={750} size="xs" c="teal">
            {money(account.pac_amount_minor ?? 0, currency)}/mo
          </Text>
        </Badge>
        <Tooltip label="Edit monthly deposit" position="top" withArrow>
          <ActionIcon size={18} variant="subtle" color="teal" onClick={start}>
            <IconPencil size={12} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center">
      <NumberInput size="xs" w={96} min={0} decimalScale={2} value={value} onChange={setValue} onKeyDown={onKey} autoFocus
        leftSection={<Text size="xs" c="dimmed">{currency}</Text>} leftSectionWidth={30} />
      <ActionIcon size={22} variant="filled" color="teal" loading={saving} onClick={() => void save()}>
        <IconCheck size={12} />
      </ActionIcon>
      <ActionIcon size={22} variant="subtle" color="gray" onClick={cancel}>
        <IconX size={12} />
      </ActionIcon>
    </Group>
  );
}

function PacBpsEditor({ holding, accountMap, onSaved }: { holding: Holding; accountMap: Map<number, Account>; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  const account = accountMap.get(holding.account_id);
  const totalPacMinor = account?.pac_amount_minor ?? 0;
  const pacBps = holding.pac_bps ?? 0;
  const calcAmountMinor = totalPacMinor > 0 && pacBps > 0 ? Math.round((totalPacMinor * pacBps) / 10000) : 0;
  const freq = holding.pac_frequency || 'monthly';

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
    if (!holding.is_pac && (holding.pac_bps ?? 0) === 0) {
      return (
        <Group gap={4} wrap="nowrap" align="center" justify="end">
          <Text size="xs" c="dimmed">—</Text>
          <Tooltip label="Set PAC %" position="top" withArrow>
            <ActionIcon size={18} variant="subtle" color="gray" onClick={start}>
              <IconPencil size={11} />
            </ActionIcon>
          </Tooltip>
        </Group>
      );
    }

    return (
      <Stack gap={2} align="flex-end" style={{ minWidth: 84 }}>
        <Badge color="teal" variant="filled" size="xs" style={{ flexShrink: 0, textTransform: 'none' }}>
          <Group gap={3} align="center" wrap="nowrap">
            <IconRepeat size={10} style={{ flexShrink: 0 }} />
            <Text span size="xs" fw={700} style={{ whiteSpace: 'nowrap' }}>{percent(holding.pac_bps ?? 0)}</Text>
          </Group>
        </Badge>
        <Group gap={3} align="center" justify="end" wrap="nowrap">
          {calcAmountMinor > 0 && (
            <Text size="xs" fw={700} c="teal" style={{ whiteSpace: 'nowrap' }}>
              {money(calcAmountMinor, holding.currency ?? 'EUR')}/{freq.slice(0, 2)}
            </Text>
          )}
          <Tooltip label="Edit PAC %" position="top" withArrow>
            <ActionIcon size={16} variant="subtle" color="teal" onClick={start} style={{ flexShrink: 0 }}>
              <IconPencil size={11} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center" justify="end">
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

function InlineCurrencyEditor({
  holding,
  field,
  label,
  onSaved,
}: {
  holding: Holding;
  field: 'value_minor' | 'invested_minor';
  label: string;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  const currency = holding.currency ?? 'EUR';
  const rawMinor = holding[field] ?? 0;

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(rawMinor / 100);
    setEditing(true);
  };
  const cancel = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditing(false);
  };
  const save = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSaving(true);
    try {
      const newMinor = Math.round(Number(value) * 100);
      await api(`/api/holdings/${holding.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...holding, [field]: newMinor }),
      });
      notifications.show({
        color: 'teal',
        title: 'Holding updated',
        message: `${holding.instrument_name} ${label} set to ${money(newMinor, currency)}`,
      });
      setEditing(false);
      await onSaved();
    } catch (cause) {
      notifications.show({
        color: 'red',
        title: `Failed to update ${label.toLowerCase()}`,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void save();
    if (e.key === 'Escape') cancel();
  };

  if (!editing) {
    return (
      <Group gap={4} align="center" justify="end" wrap="nowrap" style={{ cursor: 'pointer' }} onClick={start}>
        {field === 'invested_minor' ? (
          investedMoney(holding.invested_minor, holding.value_minor, currency)
        ) : (
          <Text fw={650}>{money(holding.value_minor, currency)}</Text>
        )}
        <Tooltip label={`Edit ${label.toLowerCase()}`} position="top" withArrow>
          <ActionIcon size={18} variant="subtle" color="gray" onClick={start}>
            <IconPencil size={11} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center" justify="end" onClick={e => e.stopPropagation()}>
      <NumberInput
        size="xs"
        w={104}
        min={0}
        decimalScale={2}
        value={value}
        onChange={setValue}
        onKeyDown={onKey}
        autoFocus
        leftSection={<Text size="xs" c="dimmed">{currency}</Text>}
        leftSectionWidth={30}
      />
      <ActionIcon size={22} variant="filled" color="teal" loading={saving} onClick={save}>
        <IconCheck size={12} />
      </ActionIcon>
      <ActionIcon size={22} variant="subtle" color="gray" onClick={cancel}>
        <IconX size={12} />
      </ActionIcon>
    </Group>
  );
}

function InlinePlannedBpsEditor({
  holding,
  actualBps,
  onSaved,
}: {
  holding: Holding;
  actualBps: number;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  const plannedBps = holding.planned_bps ?? 0;

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(plannedBps / 100);
    setEditing(true);
  };
  const cancel = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditing(false);
  };
  const save = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSaving(true);
    try {
      const newBps = Math.round(Number(value) * 100);
      await api(`/api/holdings/${holding.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...holding, planned_bps: newBps }),
      });
      notifications.show({
        color: 'teal',
        title: 'Target allocation updated',
        message: `${holding.instrument_name} wanted allocation set to ${Number(value).toFixed(2)}%`,
      });
      setEditing(false);
      await onSaved();
    } catch (cause) {
      notifications.show({
        color: 'red',
        title: 'Failed to update target allocation',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void save();
    if (e.key === 'Escape') cancel();
  };

  const deviationBps = actualBps - plannedBps;

  if (!editing) {
    return (
      <Stack gap={1} align="flex-end" style={{ cursor: 'pointer' }} onClick={start}>
        <Group gap={4} wrap="nowrap" align="center">
          <Text fw={650} c={plannedBps > 0 ? undefined : 'dimmed'}>
            {percent(plannedBps)}
          </Text>
          <Tooltip label="Edit wanted / target %" position="top" withArrow>
            <ActionIcon size={18} variant="subtle" color="gray" onClick={start}>
              <IconPencil size={11} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {plannedBps > 0 && Math.abs(deviationBps) > 50 && (
          <Text size="xs" c={deviationBps > 0 ? 'orange' : 'blue'}>
            {deviationBps > 0 ? `+${percent(deviationBps)} over` : `${percent(deviationBps)} under`}
          </Text>
        )}
      </Stack>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center" justify="end" onClick={e => e.stopPropagation()}>
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
      <ActionIcon size={22} variant="filled" color="teal" loading={saving} onClick={save}>
        <IconCheck size={12} />
      </ActionIcon>
      <ActionIcon size={22} variant="subtle" color="gray" onClick={cancel}>
        <IconX size={12} />
      </ActionIcon>
    </Group>
  );
}

export function InvestmentsView({
  holdings,
  accounts,
  instruments,
  taxRates,
  reload,
  activeSubtab = 'holdings',
  onSubtabChange,
}: {
  holdings: Holding[];
  accounts: Account[];
  instruments: Instrument[];
  taxRates: TaxRate[];
  reload: () => Promise<void>;
  activeSubtab?: 'holdings' | 'radar' | 'sandbox';
  onSubtabChange?: (subtab: 'holdings' | 'radar' | 'sandbox') => void;
  onOpenDrafts?: () => void;
}) {
  const [currentSubtab, setCurrentSubtab] = useState<'holdings' | 'radar' | 'sandbox'>(activeSubtab);

  useEffect(() => {
    if (activeSubtab) {
      setCurrentSubtab(activeSubtab);
    }
  }, [activeSubtab]);

  const handleSubtabChange = (subtab: 'holdings' | 'radar' | 'sandbox') => {
    setCurrentSubtab(subtab);
    onSubtabChange?.(subtab);
  };

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
          <Group gap={6} align="center" mt={2}>
            {holding.instrument_ticker && <TickerBadge ticker={holding.instrument_ticker} />}
            {holding.instrument_isin && <ISINBadge isin={holding.instrument_isin} />}
          </Group>
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
      key: 'planned',
      label: 'Wanted %',
      sortable: true,
      align: 'right',
      render: holding => <InlinePlannedBpsEditor holding={holding} actualBps={actualBPS(holding)} onSaved={reload} />,
    },
    { key: 'actual', label: 'Actual %', sortable: true, align: 'right', render: holding => <Text fw={650}>{percent(actualBPS(holding))}</Text> },
    {
      key: 'pac',
      label: 'PAC %',
      sortable: true,
      align: 'right',
      render: holding => <PacBpsEditor holding={holding} accountMap={accountMap} onSaved={reload} />,
    },
    {
      key: 'value',
      label: 'Current value',
      sortable: true,
      align: 'right',
      render: holding => <InlineCurrencyEditor holding={holding} field="value_minor" label="Current value" onSaved={reload} />,
    },
    {
      key: 'invested',
      label: 'Amount invested',
      sortable: true,
      align: 'right',
      render: holding => <InlineCurrencyEditor holding={holding} field="invested_minor" label="Amount invested" onSaved={reload} />,
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
    { key: 'change', label: 'Gain / loss', sortable: true, align: 'right', render: holding => { if (holding.invested_minor === 0) return <Text c="dimmed">—</Text>; const change = holding.value_minor - holding.invested_minor; return <Stack gap={1} align="flex-end"><Text fw={650} c={change >= 0 ? 'teal' : 'red'}>{money(change, holding.currency ?? 'EUR')}</Text><Text size="xs" c="dimmed">{change >= 0 ? '+' : ''}{(change / holding.invested_minor * 100).toFixed(1)}%</Text></Stack>; } },
    { key: 'tax', label: 'Tax', sortable: true, align: 'right', render: holding => percent(holding.tax_bps) },
    { key: 'actions', align: 'right', render: holding => <TableActions><TableAction label={`Edit ${holding.instrument_name}`} onClick={() => open(holding)}><IconPencil size={14} /></TableAction><TableAction label={`Delete ${holding.instrument_name}`} color="red" onClick={() => void remove(holding)}><IconTrash size={14} /></TableAction></TableActions> },
  ];

  // Compute PAC accumulation metrics & TER drag for visible holdings & visible accounts
  const visibleAccounts = activeAccounts.filter(account => accountIDs.length === 0 || accountIDs.includes(String(account.id)));
  const activePacHoldings = visibleHoldings
    .filter(h => h.is_pac && (h.pac_bps ?? 0) > 0)
    .sort((a, b) => (b.pac_bps ?? 0) - (a.pac_bps ?? 0));

  const totalMonthlyPacMinor = visibleAccounts.reduce((acc, a) => acc + (a.pac_amount_minor ?? 0), 0);
  const currency = visibleHoldings[0]?.currency ?? visibleAccounts[0]?.currency ?? 'EUR';

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

  // Visible accounts that have a PAC budget or active PAC holdings
  const pacAccountsList = visibleAccounts.filter(a => (a.pac_amount_minor ?? 0) > 0 || activePacHoldings.some(h => h.account_id === a.id));

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
      <SubnavTabs<'holdings' | 'radar' | 'sandbox'>
        value={currentSubtab}
        onChange={handleSubtabChange}
        tabs={[
          {
            value: 'holdings',
            label: 'Holdings & PAC',
            icon: <IconBriefcase size={16} />,
            badge: activeHoldings.length > 0 ? activeHoldings.length : undefined,
          },
          {
            value: 'radar',
            label: 'Geo & FX Radar',
            icon: <IconGlobe size={16} />,
          },
          {
            value: 'sandbox',
            label: 'Portfolio Sandbox',
            icon: <IconFlask size={16} />,
          },
        ]}
      />

      {currentSubtab === 'radar' ? (
        <Stack gap="md">
          <SectionHeader
            title="Geo & FX Radar"
            subtitle="Geographical distribution, currency exposure, and FX risk across your investment holdings."
          />
          <Paper withBorder radius="lg" p="lg">
            <GeoRadarSection />
          </Paper>
        </Stack>
      ) : currentSubtab === 'sandbox' ? (
        <DraftPortfoliosView
          holdings={holdings}
          instruments={instruments}
          accounts={accounts}
          reload={reload}
        />
      ) : (
        <>
          <SectionHeader
            title="Investments & PAC"
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

                <Group gap="lg" align="center">
                  <Box ta="right">
                    <Text size="xs" c="dimmed">Monthly Deposit</Text>
                    <Text size="xl" fw={800} c="teal">{money(totalMonthlyPacMinor, currency)}/mo</Text>
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

              <Stack gap="xs">
                {pacAccountsList.map(acc => {
                  const allocatedBps = pacByAccount.get(acc.id)?.allocatedBps ?? 0;
                  const pct = Math.min(allocatedBps / 100, 100);
                  const over = allocatedBps > 10000;
                  const full = allocatedBps === 10000;

                  return (
                    <Paper key={acc.id} p="xs" radius="md" withBorder style={{ backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))' }}>
                      <Group justify="space-between" align="center" mb={6}>
                        <Group gap="xs" align="center">
                          <Text size="xs" fw={750}>{acc.name}</Text>
                          <PacAmountEditor account={acc} currency={acc.currency ?? currency} onSaved={reload} />
                        </Group>
                        <Group gap={4} align="center">
                          <Text size="xs" fw={700} c={over ? 'red' : full ? 'teal' : 'dimmed'}>
                            {(allocatedBps / 100).toFixed(2)}% / 100%
                          </Text>
                          {full && <IconCheck size={12} color="var(--mantine-color-teal-6)" />}
                          {over && <IconAlertTriangle size={12} color="var(--mantine-color-red-6)" />}
                        </Group>
                      </Group>
                      <Box h={12} bg="light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))" style={{ display: 'flex', overflow: 'hidden', borderRadius: 999 }}>
                        <Box
                          bg={over ? 'red.5' : full ? 'teal.5' : 'yellow.5'}
                          style={{ width: `${pct}%`, borderRadius: 999, transition: 'width 0.3s ease' }}
                        />
                      </Box>
                      {!full && !over && (
                        <Text size="xs" c="dimmed" mt={2}>{((10000 - allocatedBps) / 100).toFixed(2)}% unallocated</Text>
                      )}
                    </Paper>
                  );
                })}
              </Stack>
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
              minWidth={1250}
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
        </>
      )}

      <HoldingModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} holding={editing} accounts={activeAccounts} holdings={holdings} instruments={instruments} taxRates={taxRates} saved={async () => { setOpened(false); await reload(); }} />
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
