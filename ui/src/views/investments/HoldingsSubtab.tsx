import React, { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  MultiSelect,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconChartPie,
  IconCheck,
  IconNotes,
  IconPencil,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { updateHolding, type Account, type Holding, type Instrument } from '../../api';
import { instrumentLabels, investedMoney, label, money, percent } from '../../utils/format';
import { SectionHeader } from '../../components/SectionHeader';
import { Empty } from '../../components/Empty';
import { Chip, ISINBadge, TickerBadge } from '../../components/Chip';
import { DataTable, TableAction, TableActions, type DataColumn, type SortDirection } from '../../components/DataTable';
import { AllocationBar } from '../../components/AllocationBar';
import { PerformanceResult } from '../../components/PerformanceResult';

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
      await updateHolding(holding.id, { [field]: newMinor });
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

export interface HoldingsSubtabProps {
  activeAccounts: Account[];
  visibleAccounts: Account[];
  activeHoldings: Holding[];
  visibleHoldings: Holding[];
  displayedHoldings: Holding[];
  instMap: Map<number, Instrument>;
  totals: Map<string, { value: number; invested: number; count: number; weightedTERNum: number; annualFeeDrag: number; classes: Map<string, number> }>;
  table: {
    sort?: string;
    direction?: SortDirection;
    sortRows: (column: string, direction: SortDirection) => Promise<void>;
  };
  filterQuery: string;
  setFilterQuery: (q: string) => void;
  accountIDs: string[];
  setAccountIDs: (ids: string[]) => void;
  showTax: boolean;
  setShowTax: React.Dispatch<React.SetStateAction<boolean>>;
  selectedAssetClass: string | null;
  setSelectedAssetClass: (cls: string | null) => void;
  ready: boolean;
  onOpenDetail?: (isin: string) => void;
  onAddInvestment: () => void;
  onEditInvestment: (holding: Holding) => void;
  onDeleteHolding: (holding: Holding) => void;
  reload: () => Promise<void>;
}

export function HoldingsSubtab({
  activeAccounts,
  visibleAccounts,
  activeHoldings,
  visibleHoldings,
  displayedHoldings,
  instMap,
  totals,
  table,
  filterQuery,
  setFilterQuery,
  accountIDs,
  setAccountIDs,
  showTax,
  setShowTax,
  selectedAssetClass,
  setSelectedAssetClass,
  ready,
  onOpenDetail,
  onAddInvestment,
  onEditInvestment,
  onDeleteHolding,
  reload,
}: HoldingsSubtabProps) {
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
    {
      key: 'gain',
      label: 'Gain / Loss',
      sortable: true,
      align: 'right',
      render: holding => {
        if (!holding.invested_minor) return <Text size="xs" c="dimmed">—</Text>;
        const gain = holding.value_minor - holding.invested_minor;
        const gainPct = holding.invested_minor > 0 ? (gain / holding.invested_minor) * 100 : 0;
        const c = gain > 0 ? 'teal' : gain < 0 ? 'red' : 'dimmed';
        return (
          <Group gap={6} align="baseline" justify="flex-end" wrap="nowrap">
            <Text size="xs" fw={700} c={c}>
              {gain > 0 ? '+' : ''}{money(gain, holding.currency ?? 'EUR')}
            </Text>
            <Text size="11px" fw={600} c={c}>
              ({gain > 0 ? '+' : ''}{gainPct.toFixed(1)}%)
            </Text>
          </Group>
        );
      },
    },
    {
      key: 'tax',
      label: 'Tax rate',
      sortable: true,
      align: 'right',
      render: holding => (holding.tax_bps > 0 ? <Badge size="xs" variant="light" color="gray">{percent(holding.tax_bps)}</Badge> : <Text size="xs" c="dimmed">—</Text>),
    },
    { key: 'actions', align: 'right', render: holding => {
      const isin = holding.instrument_isin || instMap.get(holding.instrument_id)?.isin;
      return (
        <TableActions>
          {onOpenDetail && isin && (
            <TableAction label={`View ${holding.instrument_name} details`} onClick={() => onOpenDetail(isin)}>
              <IconChartPie size={14} />
            </TableAction>
          )}
          <TableAction label={`Edit ${holding.instrument_name}`} onClick={() => onEditInvestment(holding)}><IconPencil size={14} /></TableAction>
          <TableAction label={`Delete ${holding.instrument_name}`} color="red" onClick={() => void onDeleteHolding(holding)}><IconTrash size={14} /></TableAction>
        </TableActions>
      );
    } },
  ];

  return (
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
            <Button disabled={!ready} onClick={onAddInvestment}>Add investment</Button>
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
            const accCurrency = acc.currency ?? 'EUR';
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
                  onSort={(key, direction) => {
                    if (direction) void table.sortRows(key, direction);
                  }}
                  compact
                  stickyHeader
                />
              </Card>
            );
          })}
        </Stack>
      )}
    </>
  );
}
