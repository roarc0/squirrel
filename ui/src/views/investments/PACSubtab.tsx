import React, { useState, useEffect } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconChartPie,
  IconCheck,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { updateAccount, updateHolding, type Account, type Holding, type Instrument } from '../../api';
import { money, percent } from '../../utils/format';
import { SectionHeader } from '../../components/SectionHeader';
import { Empty } from '../../components/Empty';
import { ISINBadge, TickerBadge } from '../../components/Chip';
import { TableAction, TableActions } from '../../components/DataTable';

function PacAmountEditor({ account, currency, onSaved }: { account: Account; currency: string; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState<number | string>((account.pac_amount_minor ?? 0) / 100);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue((account.pac_amount_minor ?? 0) / 100), [account.pac_amount_minor]);

  const save = async () => {
    setSaving(true);
    try {
      await updateAccount(account.id, { ...account, pac_amount_minor: Math.round(Number(value) * 100) });
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
      await updateHolding(holding.id, { pac_bps: newBps });
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

export interface PACSubtabProps {
  activeAccounts: Account[];
  visibleAccounts: Account[];
  activeHoldings: Holding[];
  visibleHoldings: Holding[];
  instMap: Map<number, Instrument>;
  accountMap: Map<number, Account>;
  accountIDs: string[];
  setAccountIDs: (ids: string[]) => void;
  ready: boolean;
  refreshingISIN: string | null;
  onOpenDetail?: (isin: string) => void;
  onAddInvestment: () => void;
  onEditInvestment: (holding: Holding) => void;
  onDeleteHolding: (holding: Holding) => void;
  onZeroPac: (holding: Holding) => Promise<void>;
  onRefreshInstrument: (isin: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function PACSubtab({
  activeAccounts,
  visibleAccounts,
  activeHoldings,
  visibleHoldings,
  instMap,
  accountMap,
  accountIDs,
  setAccountIDs,
  ready,
  refreshingISIN,
  onOpenDetail,
  onAddInvestment,
  onEditInvestment,
  onDeleteHolding,
  onZeroPac,
  onRefreshInstrument,
  reload,
}: PACSubtabProps) {
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

  const actualBPS = (holding: Holding) => holding.actual_bps;

  return (
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
            <Button disabled={!ready} onClick={onAddInvestment}>Add Investment</Button>
          </Group>
        }
      />

      {mixedCurrencies ? (
        <Text size="sm" c="dimmed">Contributions are shown separately per account below; currencies are not combined.</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
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
            <Text size="xs" c={totalMonthlyAllocatedMinor > 0 ? 'orange' : 'dimmed'} mt={4}>
              {totalMonthlyAllocatedMinor > 0 ? `Fee drag: -${money(totalAnnualFeeDragMinor, currency)}/yr` : 'Based on PAC allocations'}
            </Text>
          </Card>
          <Card withBorder className="stat-card" p="md" radius="md">
            <Text size="xs" c="dimmed">5-Yr Contributions</Text>
            <Text size="xl" fw={800} mt={4}>{totalMonthlyContributionMinor > 0 ? money(totalMonthlyContributionMinor * 60, currency) : '—'}</Text>
            {totalAnnualFeeDragMinor > 0 && (
              <Text size="xs" c="orange" mt={4}>5yr drag: -{money(totalAnnualFeeDragMinor * 5, currency)}</Text>
            )}
            {totalMonthlyContributionMinor === 0 && <Text size="xs" c="dimmed" mt={4}>Set a monthly amount below</Text>}
          </Card>
        </SimpleGrid>
      )}

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
                                    <TableAction label={`Refresh ${item.instrumentName}`} color="blue" disabled={refreshingISIN !== null} onClick={() => void onRefreshInstrument(item.isin ?? '')}>
                                      <IconRefresh size={14} style={refreshingISIN === item.isin ? { animation: 'spin 1s linear infinite' } : undefined} />
                                    </TableAction>
                                  </Tooltip>
                                  <Tooltip label={`Edit ${item.instrumentName}`} position="top" withArrow>
                                    <TableAction label={`Edit ${item.instrumentName}`} onClick={() => onEditInvestment(item.holding)}>
                                      <IconPencil size={14} />
                                    </TableAction>
                                  </Tooltip>
                                  <Tooltip label="Remove from PAC (keeps holding)" position="top" withArrow>
                                    <TableAction label={`Remove ${item.instrumentName} from PAC`} color="gray" onClick={() => void onZeroPac(item.holding)}>
                                      <IconX size={14} />
                                    </TableAction>
                                  </Tooltip>
                                  {item.holding.value_minor === 0 && (
                                    <Tooltip label="Delete holding" position="top" withArrow>
                                      <TableAction label={`Delete ${item.instrumentName}`} color="red" onClick={() => void onDeleteHolding(item.holding)}>
                                        <IconTrash size={14} />
                                      </TableAction>
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
                )}
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
