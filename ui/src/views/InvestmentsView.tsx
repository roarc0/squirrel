import { useState, useEffect } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
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
  IconChartPie,
  IconChevronDown,
  IconChevronUp,
  IconFlask,
  IconGlobe,
  IconNotes,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { api, instrumentClient, type Account, type Holding, type Instrument, type TaxRate } from '../api';
import { GeoRadarSection } from './GeoRadarView';
import { DraftPortfoliosView } from './DraftPortfoliosView';
import { SubnavTabs } from '../components/SubnavTabs';
import { AllocationBar } from '../components/AllocationBar';
import { PerformanceResult } from '../components/PerformanceResult';
import { useBackendRows } from '../hooks/useBackendRows';
import { copyToClipboard } from '../utils/copyToClipboard';
import { Chip, ISINBadge, TickerBadge } from '../components/Chip';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn } from '../components/DataTable';
import { instrumentLabels, investedMoney, label, money, percent } from '../utils/format';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { useQueryParamArray } from '../hooks/useQueryParam';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';
import { availablePacBps, availablePacPercent } from '../utils/pac';

type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);
type HoldingDraft = {
  accountID: string;
  instrumentID: string;
  value: Numeric;
  sinceBuy: Numeric;
  pac: Numeric;
  tax: Numeric;
  notes: string;
};

function PacAmountEditor({ account, currency, onSaved }: { account: Account; currency: string; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState<number | string>((account.pac_amount_minor ?? 0) / 100);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue((account.pac_amount_minor ?? 0) / 100), [account.pac_amount_minor]);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...account, pac_amount_minor: Math.round(Number(value) * 100) }),
      });
      notifications.show({ color: 'teal', title: 'Monthly contribution updated', message: `Monthly amount set to ${money(Math.round(Number(value) * 100), currency)}/mo` });
      await onSaved();
    } catch (cause) {
      notifications.show({ color: 'red', title: 'Failed to update monthly contribution', message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void save(); };

  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <NumberInput aria-label={`Monthly PAC for ${account.name}`} size="xs" w={150} min={0} decimalScale={2} value={value} onChange={setValue} onKeyDown={onKey}
        leftSection={<Text size="xs" c="dimmed">{currency}</Text>} leftSectionWidth={30} />
      <Button size="compact-xs" loading={saving} disabled={Math.round(Number(value) * 100) === (account.pac_amount_minor ?? 0)} onClick={() => void save()}>Save amount</Button>
    </Group>
  );
}

function InlinePlannedBpsEditor({
  holding,
  onSaved,
}: {
  holding: Holding;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  const pacBps = holding.pac_bps ?? 0;

  const start = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setValue(pacBps / 100);
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
        body: JSON.stringify({ pac_bps: newBps }),
      });
      notifications.show({
        color: 'teal',
        title: 'PAC share updated',
        message: `${holding.instrument_name} PAC share set to ${Number(value).toFixed(2)}%`,
      });
      setEditing(false);
      await onSaved();
    } catch (cause) {
      notifications.show({
        color: 'red',
        title: 'Failed to update PAC share',
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
      <Group gap={4} wrap="nowrap" align="center" justify="end" style={{ cursor: 'pointer' }} onClick={start}>
        <Badge color="teal" size="sm" variant="light" style={{ cursor: 'pointer', flexShrink: 0 }}>
          {percent(pacBps)}
        </Badge>
        <Tooltip label="Edit PAC share" position="top" withArrow>
          <ActionIcon aria-label="Edit PAC share" size={18} variant="subtle" color="gray" onClick={start}>
            <IconPencil size={11} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center" justify="end" onClick={e => e.stopPropagation()}>
      <NumberInput
        aria-label="PAC share"
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
      <ActionIcon aria-label="Save PAC share" size={22} variant="filled" color="teal" loading={saving} onClick={save}>
        <IconCheck size={12} />
      </ActionIcon>
      <ActionIcon aria-label="Cancel PAC share edit" size={22} variant="subtle" color="gray" onClick={cancel}>
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
          <ActionIcon aria-label={`Edit ${label.toLowerCase()}`} size={18} variant="subtle" color="gray" onClick={start}>
            <IconPencil size={11} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" align="center" justify="end" onClick={e => e.stopPropagation()}>
      <NumberInput
        aria-label={label}
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
      <ActionIcon aria-label={`Save ${label.toLowerCase()}`} size={22} variant="filled" color="teal" loading={saving} onClick={save}>
        <IconCheck size={12} />
      </ActionIcon>
      <ActionIcon aria-label={`Cancel ${label.toLowerCase()} edit`} size={22} variant="subtle" color="gray" onClick={cancel}>
        <IconX size={12} />
      </ActionIcon>
    </Group>
  );
}

export type InvestmentsSubtab = 'holdings' | 'pac' | 'radar' | 'sandbox';

export function InvestmentsView({
  holdings,
  accounts,
  instruments,
  taxRates,
  reload,
  activeSubtab = 'holdings',
  onSubtabChange,
  onOpenDrafts,
  onOpenDetail,
}: {
  holdings: Holding[];
  accounts: Account[];
  instruments: Instrument[];
  taxRates: TaxRate[];
  reload: () => Promise<void>;
  activeSubtab?: InvestmentsSubtab;
  onSubtabChange?: (subtab: InvestmentsSubtab) => void;
  onOpenDrafts?: () => void;
  onOpenDetail?: (isin: string) => void;
}) {
  const [currentSubtab, setCurrentSubtab] = useState<InvestmentsSubtab>(activeSubtab);

  useEffect(() => {
    if (activeSubtab) {
      setCurrentSubtab(activeSubtab);
    }
  }, [activeSubtab]);

  const handleSubtabChange = (subtab: InvestmentsSubtab) => {
    setCurrentSubtab(subtab);
    onSubtabChange?.(subtab);
  };

  const [opened, setOpened] = useState(false); const [editing, setEditing] = useState<Holding>(); const [error, setError] = useState('');
  const [accountIDs, setAccountIDs] = useQueryParamArray('accounts');
  const [selectedAssetClass, setSelectedAssetClass] = useState<string | null>(null);
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const [refreshingISIN, setRefreshingISIN] = useState<string | null>(null);
  const [showTax, setShowTax] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const table = useBackendRows('/api/holdings', holdings, 'value', 'desc');
  const activeAccounts = accounts.filter(account => !account.archived); const activeAccountIDs = new Set(activeAccounts.map(account => account.id));
  const accountMap = new Map<number, Account>(accounts.map(a => [a.id, a]));
  const open = (holding?: Holding) => { setEditing(holding); setOpened(true); };
  const remove = (holding: Holding) => {
    confirmDelete('investment', `${holding.instrument_name} · ${holding.account_name}`, async () => {
      try { await api(`/api/holdings/${holding.id}`, { method: 'DELETE' }); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    });
  };
  const refreshInstrument = async (isin: string) => {
    setRefreshingISIN(isin);
    try {
      await instrumentClient.importInstruments({ isins: [isin] });
      await reload();
      notifications.show({ color: 'teal', message: `${isin} data refreshed` });
    } catch (cause) {
      notifications.show({ color: 'red', message: `Failed to refresh ${isin}: ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setRefreshingISIN(null);
    }
  };
  const zeroPac = async (holding: Holding) => {
    try {
      await api(`/api/holdings/${holding.id}`, {
        method: 'PUT',
        body: JSON.stringify({ pac_bps: 0 }),
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const ready = activeAccounts.length > 0 && instruments.length > 0;
  const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));
  const activeHoldings = table.rows.filter(holding => activeAccountIDs.has(holding.account_id));
  const visibleHoldings = activeHoldings.filter(holding => accountIDs.length === 0 || accountIDs.includes(String(holding.account_id)));
  const queryLower = filterQuery.trim().toLowerCase();
  const displayedHoldings = visibleHoldings.filter(holding => {
    if (holding.value_minor === 0) return false;
    if (selectedAssetClass && holding.asset_class !== selectedAssetClass) return false;
    if (queryLower) {
      const nameMatch = holding.instrument_name?.toLowerCase().includes(queryLower);
      const tickerMatch = holding.instrument_ticker?.toLowerCase().includes(queryLower);
      const isin = holding.instrument_isin || instMap.get(holding.instrument_id)?.isin;
      const isinMatch = isin?.toLowerCase().includes(queryLower);
      if (!nameMatch && !tickerMatch && !isinMatch) return false;
    }
    return true;
  });
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
  const actualBPS = (holding: Holding) => holding.actual_bps;
  const columns: DataColumn<Holding>[] = [
    { key: 'account', label: 'Account', sortable: true, render: holding => <><Text fw={650}>{holding.account_name}</Text><Text size="xs" c="dimmed">{holding.currency}</Text></> },
    {
      key: 'instrument',
      label: 'Instrument',
      sortable: true,
      render: holding => {
        const isin = holding.instrument_isin || instMap.get(holding.instrument_id)?.isin;
        return (
          <Stack gap={2}>
            <Tooltip label={isin && onOpenDetail ? `View ${holding.instrument_name} details` : undefined} disabled={!isin || !onOpenDetail} withArrow openDelay={400}>
              <Text
                size="sm"
                fw={600}
                lh={1.3}
                style={onOpenDetail && isin ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 } : undefined}
                onClick={onOpenDetail && isin ? () => onOpenDetail(isin) : undefined}
              >
                {holding.instrument_name}
              </Text>
            </Tooltip>
            <Group gap={6} align="center" mt={2}>
              {holding.instrument_ticker && <TickerBadge ticker={holding.instrument_ticker} />}
              {isin && <ISINBadge isin={isin} />}
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
        );
      },
    },
    { key: 'type', label: 'Type', sortable: true, render: holding => <Chip>{instrumentLabels[holding.instrument_type ?? 'other']}</Chip> },
    { key: 'asset_class', label: 'Asset class', sortable: true, render: holding => <Chip>{label(holding.asset_class || 'other')}</Chip> },
    { key: 'actual', label: 'Portfolio %', sortable: true, align: 'right', render: holding => <Text fw={650}>{percent(actualBPS(holding))}</Text> },
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
    { key: 'aum', label: 'Fund AUM', sortable: false, align: 'right', render: holding => {
      const fundSize = instMap.get(holding.instrument_id)?.fund_size_million ?? 0;
      if (!fundSize) return <Text c="dimmed">—</Text>;
      return <Text size="sm" c="dimmed">{fundSize >= 1000 ? `€${(fundSize / 1000).toFixed(1)}bn` : `€${fundSize}m`}</Text>;
    } },
    { key: 'change', label: 'Gain / loss', sortable: true, align: 'right', render: holding => { if (holding.invested_minor === 0) return <Text c="dimmed">—</Text>; const change = holding.value_minor - holding.invested_minor; return <Stack gap={1} align="flex-end"><Text fw={650} c={change >= 0 ? 'teal' : 'red'}>{money(change, holding.currency ?? 'EUR')}</Text><Text size="xs" c="dimmed">{change >= 0 ? '+' : ''}{(change / holding.invested_minor * 100).toFixed(1)}%</Text></Stack>; } },
    { key: 'tax', label: 'Tax', sortable: true, align: 'right', render: holding => percent(holding.tax_bps) },
    { key: 'actions', align: 'right', render: holding => {
      const isin = holding.instrument_isin || instMap.get(holding.instrument_id)?.isin;
      return (
        <TableActions>
          {onOpenDetail && isin && (
            <TableAction label={`View ${holding.instrument_name} details`} onClick={() => onOpenDetail(isin)}>
              <IconChartPie size={14} />
            </TableAction>
          )}
          <TableAction label={`Edit ${holding.instrument_name}`} onClick={() => open(holding)}><IconPencil size={14} /></TableAction>
          <TableAction label={`Delete ${holding.instrument_name}`} color="red" onClick={() => void remove(holding)}><IconTrash size={14} /></TableAction>
        </TableActions>
      );
    } },
  ];

  const visibleAccounts = activeAccounts.filter(account => accountIDs.length === 0 || accountIDs.includes(String(account.id)));
  const plannedHoldings = visibleHoldings
    .filter(h => (h.pac_bps ?? 0) > 0)
    .sort((a, b) => (b.pac_bps ?? 0) - (a.pac_bps ?? 0));

  const totalMonthlyContributionMinor = visibleAccounts.reduce((sum, account) => sum + (account.pac_amount_minor ?? 0), 0);
  const currency = visibleHoldings[0]?.currency ?? visibleAccounts[0]?.currency ?? 'EUR';
  const mixedCurrencies = new Set(visibleAccounts.map(a => a.currency)).size > 1;

  let totalPacBps = 0;
  let totalPacTERNum = 0;
  let totalMonthlyAllocatedMinor = 0;
  let totalAnnualFeeDragMinor = 0;

  const planItems = plannedHoldings.map(h => {
    const acc = accountMap.get(h.account_id);
    const inst = instMap.get(h.instrument_id);
    const pacBps = h.pac_bps ?? 0;
    const itemMonthlyMinor = Math.round(((acc?.pac_amount_minor ?? 0) * pacBps) / 10000);
    const itemYearlyMinor = itemMonthlyMinor * 12;
    const terBps = h.ter_bps ?? inst?.ter_bps ?? 0;
    const annualDragMinor = Math.round((itemYearlyMinor * terBps) / 10000);

    totalPacBps += pacBps;
    totalPacTERNum += pacBps * terBps;
    totalMonthlyAllocatedMinor += itemMonthlyMinor;
    totalAnnualFeeDragMinor += annualDragMinor;

    return {
      holding: h,
      instrumentName: h.instrument_name,
      ticker: h.instrument_ticker,
      isin: h.instrument_isin || inst?.isin,
      pacBps,
      itemMonthlyMinor,
      terBps,
      fundSizeMillion: inst?.fund_size_million ?? 0,
    };
  });

  const pacWeightedTERBps = totalPacBps > 0 ? totalPacTERNum / totalPacBps : 0;
  const plannedByAccount = new Map<number, number>();
  planItems.forEach(item => {
    plannedByAccount.set(item.holding.account_id, (plannedByAccount.get(item.holding.account_id) ?? 0) + (item.holding.pac_bps ?? 0));
  });

  return (
    <ViewShell error={error || table.sortError}>
      <SubnavTabs<InvestmentsSubtab>
        value={currentSubtab}
        onChange={handleSubtabChange}
        tabs={[
          {
            value: 'holdings',
            label: 'Holdings',
            icon: <IconBriefcase size={16} />,
            badge: activeHoldings.length > 0 ? activeHoldings.length : undefined,
          },
          {
            value: 'pac',
            label: 'Allocation Strategy',
            icon: <IconChartPie size={16} />,
            badge: plannedHoldings.length > 0 ? plannedHoldings.length : undefined,
            badgeColor: 'teal',
          },
          {
            value: 'radar',
            label: 'Geo & FX Radar',
            icon: <IconGlobe size={16} />,
          },
          {
            value: 'sandbox',
            label: 'Sandbox',
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
      ) : currentSubtab === 'pac' ? (
        <Stack gap="md">
          <SectionHeader
            title="Investment Allocation Strategy"
            subtitle="PAC shares split each account’s monthly contribution. Portfolio % shows your actual current allocation."
            actions={
              <Group gap="sm" align="center" wrap="wrap">
                {activeAccounts.length > 0 && (
                  <MultiSelect
                    w={220}
                    searchable
                    clearable
                    placeholder="Filter by account"
                    value={accountIDs}
                    data={activeAccounts.map(account => ({ value: String(account.id), label: account.name }))}
                    onChange={setAccountIDs}
                  />
                )}
                <Button disabled={!ready} onClick={() => open()}>Add Investment</Button>
              </Group>
            }
          />

          {mixedCurrencies ? <Text size="sm" c="dimmed">Contributions are shown separately per account below; currencies are not combined.</Text> : <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            <Card withBorder className="stat-card" p="md" radius="md">
              <Text size="xs" c="dimmed">Monthly Contribution</Text>
              <Text size="xl" fw={800} c="teal" mt={4}>{money(totalMonthlyContributionMinor, currency)}/mo</Text>
              <Text size="xs" c="dimmed" mt={4}>Optional · across {visibleAccounts.length} {visibleAccounts.length === 1 ? 'account' : 'accounts'}</Text>
            </Card>
            <Card withBorder className="stat-card" p="md" radius="md">
              <Text size="xs" c="dimmed">Annual Contributions</Text>
              <Text size="xl" fw={800} mt={4}>{totalMonthlyContributionMinor > 0 ? `${money(totalMonthlyContributionMinor * 12, currency)}/yr` : '—'}</Text>
              <Text size="xs" c="dimmed" mt={4}>{totalMonthlyContributionMinor > 0 ? '12 monthly contributions' : 'No recurring amount set'}</Text>
            </Card>
            <Card withBorder className="stat-card" p="md" radius="md">
              <Text size="xs" c="dimmed">PAC-Weighted TER</Text>
              <Text size="xl" fw={800} mt={4}>{totalPacBps > 0 ? percent(pacWeightedTERBps) : '—'}</Text>
              <Text size="xs" c={totalMonthlyAllocatedMinor > 0 ? 'orange' : 'dimmed'} mt={4}>{totalMonthlyAllocatedMinor > 0 ? `Fee drag: -${money(totalAnnualFeeDragMinor, currency)}/yr` : 'Based on PAC allocations'}</Text>
            </Card>
            <Card withBorder className="stat-card" p="md" radius="md">
              <Text size="xs" c="dimmed">5-Yr Contributions</Text>
              <Text size="xl" fw={800} mt={4}>{totalMonthlyContributionMinor > 0 ? money(totalMonthlyContributionMinor * 60, currency) : '—'}</Text>
              {totalAnnualFeeDragMinor > 0 && (
                <Text size="xs" c="orange" mt={4}>5yr drag: -{money(totalAnnualFeeDragMinor * 5, currency)}</Text>
              )}
              {totalMonthlyContributionMinor === 0 && <Text size="xs" c="dimmed" mt={4}>Set a monthly amount below</Text>}
            </Card>
          </SimpleGrid>}

          {visibleAccounts.length === 0 ? (
            <Empty
              title="No active accounts"
              text="Add or restore an account to build an allocation strategy."
            />
          ) : plannedHoldings.length === 0 ? (
            <Empty
              title="No PAC allocations"
              text="Assign a planned allocation to at least one holding to build a strategy."
            />
          ) : (
            <Stack gap="md">
              {visibleAccounts.filter(acc => planItems.some(item => item.holding.account_id === acc.id)).map(acc => {
                const allocatedBps = plannedByAccount.get(acc.id) ?? 0;
                const pct = Math.min(allocatedBps / 100, 100);
                const over = allocatedBps > 10000;
                const full = allocatedBps === 10000;
                const accountPlannedHoldings = planItems.filter(item => item.holding.account_id === acc.id);
                const allocatedMonthlyMinor = Math.round(((acc.pac_amount_minor ?? 0) * allocatedBps) / 10000);

                // Per-account portfolio stats
                const accHoldings = activeHoldings.filter(h => h.account_id === acc.id);
                const accountTotalValue = accHoldings.reduce((sum, h) => sum + h.value_minor, 0);
                const accountTotalInvested = accHoldings.reduce((sum, h) => sum + h.invested_minor, 0);
                const accPacTERNum = accountPlannedHoldings.reduce((sum, item) => sum + item.pacBps * item.terBps, 0);
                const accountPacBpsTotal = accountPlannedHoldings.reduce((sum, item) => sum + item.pacBps, 0);
                const accWeightedTERBps = accountPacBpsTotal > 0 ? accPacTERNum / accountPacBpsTotal : 0;
                const accAnnualFeeDragMinor = accountPlannedHoldings.reduce((sum, item) => sum + Math.round((item.itemMonthlyMinor * 12 * item.terBps) / 10000), 0);

                return (
                  <Card key={acc.id} withBorder className="section-card" p="md" radius="md">
                    <Group justify="space-between" align="start" mb="xs">
                      <Box>
                        <Group gap="xs" align="center">
                          <Text fw={750} size="md">{acc.name}</Text>
                          <Badge size="xs" variant="light" color="gray">{acc.type}</Badge>
                          <Badge size="xs" variant="outline" color="teal">{acc.currency ?? currency}</Badge>
                        </Group>
                      </Box>
                      <Stack gap={2} align="flex-end">
                        <Text size="xs" c="dimmed">Monthly contribution (optional)</Text>
                        <Group gap="xs" align="center" wrap="wrap" justify="flex-end">
                          <PacAmountEditor account={acc} currency={acc.currency ?? currency} onSaved={reload} />
                          {full && <Badge color="teal" variant="light" leftSection={<IconCheck size={12} />}>100% Allocated</Badge>}
                          {over && <Badge color="red" variant="light" leftSection={<IconAlertTriangle size={12} />}>Over-allocated ({((allocatedBps / 100)).toFixed(1)}%)</Badge>}
                          {!full && !over && <Badge color="orange" variant="light">{((10000 - allocatedBps) / 100).toFixed(1)}% Unallocated</Badge>}
                        </Group>
                      </Stack>
                    </Group>

                    <Group gap="sm" align="center" my="xs" wrap="nowrap">
                      {(accountTotalValue > 0 || accWeightedTERBps > 0) && (
                        <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                          {accWeightedTERBps > 0 && (
                            <Text size="xs" c="dimmed">
                              TER <Text span fw={700} c="default">{percent(accWeightedTERBps)}</Text>
                              {accAnnualFeeDragMinor > 0 && <Text span c="orange"> −{money(accAnnualFeeDragMinor, acc.currency ?? currency)}/yr</Text>}
                            </Text>
                          )}
                          {accWeightedTERBps > 0 && accountTotalValue > 0 && <Text size="xs" c="dimmed">·</Text>}
                          {accountTotalValue > 0 && (
                            <Text size="xs" c="dimmed">
                              Value <Text span fw={700} c="default">{money(accountTotalValue, acc.currency ?? currency)}</Text>
                            </Text>
                          )}
                          {accountTotalInvested > 0 && (() => {
                            const gain = accountTotalValue - accountTotalInvested;
                            return (
                              <>
                                <Text size="xs" c="dimmed">·</Text>
                                <Text size="xs" c="dimmed">
                                  Invested <Text span fw={700} c="default">{money(accountTotalInvested, acc.currency ?? currency)}</Text>
                                  {gain !== 0 && <Text span fw={600} c={gain >= 0 ? 'teal' : 'red'}> {gain >= 0 ? '+' : ''}{(gain / accountTotalInvested * 100).toFixed(1)}%</Text>}
                                </Text>
                              </>
                            );
                          })()}
                        </Group>
                      )}
                      <Box style={{ flex: 1, height: 6, display: 'flex', overflow: 'hidden', borderRadius: 999 }} bg="light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))">
                        <Box
                          bg={over ? 'red.5' : full ? 'teal.5' : 'yellow.5'}
                          style={{ width: `${pct}%`, borderRadius: 999, transition: 'width 0.3s ease' }}
                        />
                      </Box>
                      <Text size="xs" fw={700} c={over ? 'red' : full ? 'teal' : 'dimmed'} style={{ flexShrink: 0 }}>
                        {(acc.pac_amount_minor ?? 0) > 0 ? `${money(allocatedMonthlyMinor, acc.currency ?? currency)} / ${money(acc.pac_amount_minor ?? 0, acc.currency ?? currency)} · ` : ''}{((allocatedBps / 100)).toFixed(2)}%
                      </Text>
                    </Group>

                    {accountPlannedHoldings.length === 0 ? (
                      <Text size="xs" c="dimmed" py="sm" ta="center">
                        No ETF allocations assigned to this account yet. Click "Add Investment" to configure.
                      </Text>
                    ) : (
                      <>
                        <Paper className="data-table-card" radius="md" withBorder style={{ padding: 0, marginTop: 8 }}>
                          <Table tabularNums verticalSpacing="xs" horizontalSpacing="xs" highlightOnHover className="data-table compact">
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th style={{ width: '22%' }}><Text size="xs" fw={700} c="dimmed" tt="uppercase">Instrument</Text></Table.Th>
                                <Table.Th style={{ width: '7%', textAlign: 'right' }}><Text size="xs" fw={700} c="dimmed" tt="uppercase">TER</Text></Table.Th>
                                <Table.Th style={{ width: '8%', textAlign: 'right' }}><Text size="xs" fw={700} c="dimmed" tt="uppercase">AUM</Text></Table.Th>
                                <Table.Th style={{ width: '10%', textAlign: 'right' }}><Text size="xs" fw={700} c="dimmed" tt="uppercase">Portfolio %</Text></Table.Th>
                                <Table.Th style={{ textAlign: 'right' }}><Text size="xs" fw={700} c="dimmed">PAC Share</Text></Table.Th>
                                <Table.Th style={{ width: '9%', textAlign: 'right' }}><Text size="xs" fw={700} c="dimmed" tt="uppercase">Monthly</Text></Table.Th>
                                <Table.Th style={{ width: '8%', textAlign: 'right' }}><Text size="xs" fw={700} c="dimmed" tt="uppercase">Value</Text></Table.Th>
                                <Table.Th style={{ width: '8%', textAlign: 'right' }}><Text size="xs" fw={700} c="dimmed" tt="uppercase">Invested</Text></Table.Th>
                                <Table.Th style={{ width: '5%', textAlign: 'right' }}></Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {accountPlannedHoldings.map(item => {
                                const isin = item.isin;
                                return (
                                  <Table.Tr key={item.holding.id}>
                                    <Table.Td>
                                      <Stack gap={2}>
                                        <Tooltip label={isin && onOpenDetail ? `View ${item.instrumentName} details` : undefined} disabled={!isin || !onOpenDetail} withArrow openDelay={400}>
                                          <Text
                                            size="xs"
                                            fw={600}
                                            lh={1.3}
                                            style={onOpenDetail && isin ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 } : undefined}
                                            onClick={onOpenDetail && isin ? () => onOpenDetail(isin) : undefined}
                                          >
                                            {item.instrumentName}
                                          </Text>
                                        </Tooltip>
                                        <Group gap={6} align="center">
                                          {item.ticker && <TickerBadge ticker={item.ticker} />}
                                          {isin && <ISINBadge isin={isin} />}
                                        </Group>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      <Text size="xs" c={item.terBps > 0 ? undefined : 'dimmed'}>{item.terBps > 0 ? percent(item.terBps) : '—'}</Text>
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      {item.fundSizeMillion > 0 ? (
                                        <Text size="xs" c="dimmed">
                                          {item.fundSizeMillion >= 1000
                                            ? `€${(item.fundSizeMillion / 1000).toFixed(1)}bn`
                                            : `€${item.fundSizeMillion}m`}
                                        </Text>
                                      ) : <Text size="xs" c="dimmed">—</Text>}
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      <Text size="xs" fw={700}>{percent(actualBPS(item.holding))}</Text>
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      <InlinePlannedBpsEditor holding={item.holding} onSaved={reload} />
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      <Text size="xs" fw={700} c={item.itemMonthlyMinor > 0 ? 'teal' : 'dimmed'}>
                                        {item.itemMonthlyMinor > 0 ? `${money(item.itemMonthlyMinor, acc.currency ?? currency)}/mo` : '—'}
                                      </Text>
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      <Text size="xs" fw={600}>
                                        {money(item.holding.value_minor, item.holding.currency ?? currency)}
                                      </Text>
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      {item.holding.invested_minor > 0 ? (() => {
                                        const gain = item.holding.value_minor - item.holding.invested_minor;
                                        return (
                                          <Stack gap={1} align="flex-end">
                                            <Text size="xs" fw={600}>{money(item.holding.invested_minor, item.holding.currency ?? currency)}</Text>
                                            <Text size="10px" fw={600} c={gain >= 0 ? 'teal' : 'red'}>
                                              {gain >= 0 ? '+' : ''}{(gain / item.holding.invested_minor * 100).toFixed(1)}%
                                            </Text>
                                          </Stack>
                                        );
                                      })() : <Text size="xs" c="dimmed">—</Text>}
                                    </Table.Td>
                                    <Table.Td style={{ textAlign: 'right' }}>
                                      <TableActions>
                                        {onOpenDetail && item.isin && (
                                          <Tooltip label={`View ${item.instrumentName} details`} position="top" withArrow>
                                            <TableAction label={`View ${item.instrumentName} details`} onClick={() => onOpenDetail(item.isin!)}>
                                              <IconChartPie size={14} />
                                            </TableAction>
                                          </Tooltip>
                                        )}
                                        <Tooltip label={`Refresh ${item.isin} data from justETF`} position="top" withArrow>
                                          <TableAction label={`Refresh ${item.instrumentName}`} color="blue" disabled={refreshingISIN !== null} onClick={() => void refreshInstrument(item.isin ?? '')}>
                                            <IconRefresh size={14} style={refreshingISIN === item.isin ? { animation: 'spin 1s linear infinite' } : undefined} />
                                          </TableAction>
                                        </Tooltip>
                                        <Tooltip label={`Edit ${item.instrumentName}`} position="top" withArrow>
                                          <TableAction label={`Edit ${item.instrumentName}`} onClick={() => open(item.holding)}>
                                            <IconPencil size={14} />
                                          </TableAction>
                                        </Tooltip>
                                        <Tooltip label="Remove from PAC (keeps holding)" position="top" withArrow>
                                          <TableAction label={`Remove ${item.instrumentName} from PAC`} color="gray" onClick={() => void zeroPac(item.holding)}><IconX size={14} /></TableAction>
                                        </Tooltip>
                                        {item.holding.value_minor === 0 && (
                                          <Tooltip label="Delete holding" position="top" withArrow>
                                            <TableAction label={`Delete ${item.instrumentName}`} color="red" onClick={() => void remove(item.holding)}><IconTrash size={14} /></TableAction>
                                          </Tooltip>
                                        )}
                                      </TableActions>
                                    </Table.Td>
                                  </Table.Tr>
                                );
                              })}
                            </Table.Tbody>
                          </Table>
                        </Paper>

                      </>
                    )}
                  </Card>
                );
              })}
            </Stack>
          )}
        </Stack>
      ) : (
        <>
          <SectionHeader
            title="Investments"
            subtitle="Your actual holdings, values, performance, and current portfolio allocation."
            actions={
              <Group gap="sm" align="center" wrap="wrap">
                <TextInput
                  size="xs"
                  w={180}
                  placeholder="Search holdings…"
                  leftSection={<IconSearch size={14} />}
                  value={filterQuery}
                  onChange={e => setFilterQuery(e.currentTarget.value)}
                  rightSection={
                    filterQuery ? (
                      <ActionIcon size={16} variant="subtle" color="gray" onClick={() => setFilterQuery('')}>
                        <IconX size={10} />
                      </ActionIcon>
                    ) : null
                  }
                />
                {activeAccounts.length > 0 && (
                  <MultiSelect
                    w={220}
                    searchable
                    clearable
                    placeholder="Filter by account"
                    value={accountIDs}
                    data={activeAccounts.map(account => ({ value: String(account.id), label: account.name }))}
                    onChange={setAccountIDs}
                  />
                )}
                <Button size="xs" variant={showTax ? 'light' : 'subtle'} color="gray" onClick={() => setShowTax(v => !v)}>
                  {showTax ? 'Hide tax' : 'Show tax'}
                </Button>
                <Button disabled={!ready} onClick={() => open()}>Add investment</Button>
              </Group>
            }
          />

          {activeHoldings.length > 0 && visibleHoldings.length > 0 && (
            <SimpleGrid cols={{ base: 1, md: Math.min(2, Math.max(1, totals.size)) }}>
              {[...totals].map(([currency, summary]) => (
                <Card key={currency} withBorder className="section-card" p="md" radius="md">
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

          {(selectedAssetClass || filterQuery) && (
            <Group gap="xs" align="center" mt="xs">
              {selectedAssetClass && (
                <>
                  <Text size="xs" c="dimmed">Asset class:</Text>
                  <Chip colorKey={selectedAssetClass || ''} variant="filled">{label(selectedAssetClass)}</Chip>
                  <Button size="xs" variant="subtle" color="gray" onClick={() => setSelectedAssetClass(null)}>
                    Clear ✕
                  </Button>
                </>
              )}
              {filterQuery && (
                <>
                  <Text size="xs" c="dimmed">Search:</Text>
                  <Badge size="sm" variant="light" color="blue">"{filterQuery}"</Badge>
                  <Button size="xs" variant="subtle" color="gray" onClick={() => setFilterQuery('')}>
                    Clear ✕
                  </Button>
                </>
              )}
            </Group>
          )}

          {!ready ? (
            <Empty title="Accounts and instruments required" text="Add an active account and an instrument before recording an investment." />
          ) : activeHoldings.length === 0 ? (
            <Empty title="No active investments" text="Add an investment or restore an archived account." />
          ) : visibleHoldings.length === 0 ? (
            <Empty title="No matching investments" text="Choose another account or clear the filter." />
          ) : displayedHoldings.length === 0 ? (
            <Empty
              title="No matching investments"
              text={filterQuery ? `No holdings match "${filterQuery}". Clear search to show all.` : `No investments found under ${label(selectedAssetClass || '')}. Clear filter to show all.`}
            />
          ) : (
            <Stack gap="md">
              {visibleAccounts.filter(acc => displayedHoldings.some(h => h.account_id === acc.id)).map(acc => {
                const accHoldings = displayedHoldings.filter(h => h.account_id === acc.id);
                const accValue = accHoldings.reduce((s, h) => s + h.value_minor, 0);
                const accInvested = accHoldings.reduce((s, h) => s + h.invested_minor, 0);
                const accTERNum = accHoldings.reduce((s, h) => s + h.value_minor * (h.ter_bps ?? instMap.get(h.instrument_id)?.ter_bps ?? 0), 0);
                const accTER = accValue > 0 ? accTERNum / accValue : 0;
                const accFeeDrag = Math.round(accTERNum / 10000);
                const accGain = accValue - accInvested;
                const accCurrency = acc.currency ?? currency;
                const accColumns = columns.filter(c => c.key !== 'account' && (showTax || c.key !== 'tax'));
                return (
                  <Card key={acc.id} withBorder className="section-card" p="md" radius="md">
                    <Group justify="space-between" align="start" mb="xs">
                      <Group gap="xs" align="center">
                        <Text fw={750} size="md">{acc.name}</Text>
                        <Badge size="xs" variant="light" color="gray">{acc.type}</Badge>
                        <Badge size="xs" variant="outline" color="teal">{accCurrency}</Badge>
                      </Group>
                      <Group gap="xl" align="baseline">
                        {accValue > 0 && <Text size="sm" fw={700}>{money(accValue, accCurrency)}</Text>}
                        {accInvested > 0 && (
                          <Text size="xs" c={accGain >= 0 ? 'teal' : 'red'} fw={600}>
                            {accGain >= 0 ? '+' : ''}{(accGain / accInvested * 100).toFixed(1)}% P&L
                          </Text>
                        )}
                        {accTER > 0 && (
                          <Text size="xs" c="dimmed">
                            TER <Text span fw={700} c="dimmed">{(accTER / 100).toFixed(2)}%</Text>
                            {accFeeDrag > 0 && <Text span c="orange"> · -{money(accFeeDrag, accCurrency)}/yr</Text>}
                          </Text>
                        )}
                      </Group>
                    </Group>
                    <DataTable
                      rows={accHoldings}
                      columns={accColumns}
                      rowKey={h => h.id}
                      minWidth={950}
                      sort={table.sort}
                      direction={table.direction}
                      onSort={(key, direction) => void table.sortRows(key, direction)}
                      compact
                      stickyHeader
                    />
                  </Card>
                );
              })}
            </Stack>
          )}
        </>
      )}

      <HoldingModal
        key={editing?.id ?? 'new'}
        opened={opened}
        close={() => setOpened(false)}
        holding={editing}
        accounts={activeAccounts}
        instruments={instruments}
        taxRates={taxRates}
        holdings={activeHoldings}
        defaultAccountID={accountIDs.length === 1 ? accountIDs[0] : undefined}
        saved={async () => {
          setOpened(false);
          await reload();
        }}
      />
      {confirmDeleteModal}
    </ViewShell>
  );
}

function HoldingModal({
  opened,
  close,
  holding,
  accounts,
  instruments,
  taxRates,
  holdings,
  defaultAccountID,
  saved,
}: {
  opened: boolean;
  close: () => void;
  holding?: Holding;
  accounts: Account[];
  instruments: Instrument[];
  taxRates: TaxRate[];
  holdings: Holding[];
  defaultAccountID?: string;
  saved: () => Promise<void>;
}) {
  const initialAccountID = holding
    ? String(holding.account_id)
    : (defaultAccountID && accounts.some(item => String(item.id) === defaultAccountID)
        ? defaultAccountID
        : String(accounts.find(item => item.preferred)?.id ?? accounts[0]?.id ?? ''));

  const initialPac = holding
    ? (holding.pac_bps ?? 0) / 100
    : availablePacPercent(Number(initialAccountID), holdings);

  const [form, setForm] = useState<HoldingDraft>(() =>
    holding
      ? {
          accountID: String(holding.account_id),
          instrumentID: String(holding.instrument_id),
          value: holding.value_minor / 100,
          sinceBuy: holding.invested_minor ? (holding.value_minor - holding.invested_minor) / 100 : '',
          pac: initialPac,
          tax: holding.tax_bps / 100,
          notes: holding.notes ?? '',
        }
      : {
          accountID: initialAccountID,
          instrumentID: String(instruments[0]?.id ?? ''),
          value: 0,
          sinceBuy: '',
          pac: initialPac,
          tax: (taxRates[0]?.rate_bps ?? 2600) / 100,
          notes: '',
        }
  );
  const [saving, setSaving] = useState(false);

  const selectedAccount = accounts.find(item => String(item.id) === String(form.accountID));
  const accountCurrency = selectedAccount?.currency ?? 'EUR';
  const pacBudgetMinor = selectedAccount?.pac_amount_minor ?? 0;
  const currentAccountId = Number(form.accountID);
  const availableBps = availablePacBps(currentAccountId, holdings, holding?.id);
  const availablePct = availableBps / 100;
  const currentPacBps = bps(form.pac);
  const monthlyContribution =
    pacBudgetMinor > 0 && form.pac !== ''
      ? Math.round(((pacBudgetMinor * (Number(form.pac) || 0)) / 100)) / 100
      : '';

  const save = async () => {
    setSaving(true);
    try {
      const value = minor(form.value);
      const pacBpsVal = bps(form.pac);
      if (value === 0 && pacBpsVal === 0) {
        throw new Error('Investments with 0 value require a PAC allocation share');
      }
      const invested = value === 0 ? 0 : (form.sinceBuy === '' ? value : value - minor(form.sinceBuy));
      if (invested < 0) throw new Error('Since-buy gain/loss cannot be greater than the current value');

      const body = {
        account_id: Number(form.accountID),
        instrument_id: Number(form.instrumentID),
        invested_minor: invested,
        value_minor: value,
        tax_bps: bps(form.tax),
        is_pac: pacBpsVal > 0,
        pac_bps: pacBpsVal,
        pac_frequency: holding?.pac_frequency || 'monthly',
        notes: form.notes,
      };
      await api(holding ? `/api/holdings/${holding.id}` : '/api/holdings', {
        method: holding ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      notifications.show({
        color: 'teal',
        title: holding ? 'Investment updated' : 'Investment added',
        message: holding ? 'Changes saved successfully.' : 'New investment added to your portfolio.',
      });
      await saved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      notifications.show({ color: 'red', title: 'Failed to save investment', message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title={holding ? 'Edit investment' : 'Add investment'}>
      <Stack>
        <Select
          searchable
          required
          label="Account"
          value={form.accountID}
          data={accounts.map(item => ({
            value: String(item.id),
            label: `${item.name} · ${item.type}${item.preferred ? ' · default' : ''} · ${item.currency}`,
          }))}
          onChange={value => {
            const nextAccountId = value ?? '';
            if (!holding) {
              const nextAvailablePct = availablePacPercent(Number(nextAccountId), holdings);
              setForm(f => ({ ...f, accountID: nextAccountId, pac: nextAvailablePct }));
            } else {
              setForm(f => ({ ...f, accountID: nextAccountId }));
            }
          }}
        />

        <Select
          searchable
          required
          label="Instrument"
          nothingFoundMessage="No ticker, name, or ISIN match"
          value={form.instrumentID}
          data={instruments.map(item => ({
            value: String(item.id),
            label: [item.ticker, item.name, instrumentLabels[item.instrument_type], item.isin].filter(Boolean).join(' · '),
          }))}
          onChange={value => setForm(f => ({ ...f, instrumentID: value ?? '' }))}
        />

        <SimpleGrid cols={2}>
          <NumberInput
            label="Current value"
            min={0}
            decimalScale={2}
            value={form.value}
            onChange={value => setForm(f => ({ ...f, value }))}
            rightSection={<Text size="xs" c="dimmed" pr={6}>{accountCurrency}</Text>}
            rightSectionWidth={46}
          />
          <NumberInput
            label="Since buy gain / loss (optional)"
            placeholder="Example: -0.85"
            decimalScale={2}
            value={form.sinceBuy}
            onChange={value => setForm(f => ({ ...f, sinceBuy: value }))}
            rightSection={<Text size="xs" c="dimmed" pr={6}>{accountCurrency}</Text>}
            rightSectionWidth={46}
          />
        </SimpleGrid>

        <SimpleGrid cols={2}>
          <Box>
            <NumberInput
              label="PAC share (%)"
              min={0}
              max={100}
              decimalScale={2}
              value={form.pac}
              onChange={val => setForm(f => ({ ...f, pac: val }))}
              rightSection={<Text size="xs" c="dimmed" pr={4}>%</Text>}
              rightSectionWidth={24}
            />
            <Group justify="space-between" align="center" mt={4} wrap="nowrap">
              <Text size="xs" c={currentPacBps > availableBps ? 'orange' : 'dimmed'}>
                {currentPacBps > availableBps
                  ? `Exceeds unallocated (${availablePct.toFixed(1)}% free)`
                  : `Bank unallocated: ${availablePct.toFixed(1)}%`}
              </Text>
              <Group gap={6} wrap="nowrap">
                {availablePct > 0 && Number(form.pac) !== availablePct && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="teal"
                    p={0}
                    h="auto"
                    onClick={() => setForm(f => ({ ...f, pac: availablePct }))}
                  >
                    Use max ({availablePct.toFixed(1)}%)
                  </Button>
                )}
                {Number(form.pac) > 0 && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    p={0}
                    h="auto"
                    onClick={() => setForm(f => ({ ...f, pac: 0 }))}
                  >
                    0%
                  </Button>
                )}
              </Group>
            </Group>
          </Box>
          <Box>
            <NumberInput
              label="Monthly contribution"
              min={0}
              decimalScale={2}
              rightSection={<Text size="xs" c="dimmed" pr={6}>{accountCurrency}/mo</Text>}
              rightSectionWidth={64}
              value={monthlyContribution}
              disabled={pacBudgetMinor === 0}
              placeholder={pacBudgetMinor === 0 ? 'No bank PAC set' : '0.00'}
              onChange={val => {
                if (pacBudgetMinor > 0) {
                  if (val === '' || val === undefined) {
                    setForm(f => ({ ...f, pac: '' }));
                  } else {
                    const computedPct = Math.round(((Number(val) * 100) / pacBudgetMinor) * 10000) / 100;
                    setForm(f => ({ ...f, pac: Math.min(100, Math.max(0, computedPct)) }));
                  }
                }
              }}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {pacBudgetMinor > 0
                ? `Of ${money(pacBudgetMinor, accountCurrency)}/mo account budget`
                : 'Set monthly budget on account to calculate amount'}
            </Text>
          </Box>
        </SimpleGrid>

        <SimpleGrid cols={2}>
          <NumberInput
            label="Applicable tax (%)"
            min={0}
            max={100}
            decimalScale={2}
            value={form.tax}
            onChange={value => setForm(f => ({ ...f, tax: value }))}
            rightSection={<Text size="xs" c="dimmed" pr={4}>%</Text>}
            rightSectionWidth={24}
          />
          <Select
            label="Tax preset"
            placeholder="Select preset"
            clearable
            data={taxRates.map(item => ({
              value: String(item.rate_bps),
              label: `${item.label} (${percent(item.rate_bps)})`,
            }))}
            onChange={value => value && setForm(f => ({ ...f, tax: Number(value) / 100 }))}
          />
        </SimpleGrid>

        <Textarea
          label="Notes & Context for AI Assistant"
          placeholder="e.g. Core global equity allocation for long-term wealth accumulation..."
          rows={2}
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.currentTarget.value }))}
        />

        <Group justify="end">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save investment</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
