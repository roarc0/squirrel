import { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  NumberInput,
  Checkbox,
  TextInput,
  Paper,
  Table,
  Badge,
  Divider,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { updateSituation, type Account, type Holding } from './api';
import { notifications } from '@mantine/notifications';

type Props = {
  opened: boolean;
  onClose: () => void;
  accounts: Account[];
  holdings: Holding[];
  reload: () => Promise<void>;
};

function computeInvestedMinor(valueMinor: number, returnPct: number | ''): number {
  if (valueMinor <= 0) return 0;
  if (returnPct === '' || isNaN(Number(returnPct))) return valueMinor;
  const pct = Number(returnPct);
  const factor = 1 + pct / 100;
  if (factor <= 0.0001) return valueMinor;
  return Math.round(valueMinor / factor);
}

export function UpdateSituationModal({ opened, onClose, accounts, holdings, reload }: Props) {
  const activeAccounts = accounts.filter(a => !a.archived);

  const [accountBalances, setAccountBalances] = useState<Record<number, number>>({});
  const [holdingValues, setHoldingValues] = useState<Record<number, number>>({});
  const [holdingReturns, setHoldingReturns] = useState<Record<number, number | ''>>({});
  const [saveSnapshot, setSaveSnapshot] = useState(true);
  const [observedOn, setObservedOn] = useState(() => new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opened) {
      const initialAccs: Record<number, number> = {};
      activeAccounts.forEach(a => {
        initialAccs[a.id] = a.balance_minor / 100;
      });
      setAccountBalances(initialAccs);

      const initialHoldings: Record<number, number> = {};
      const initialReturns: Record<number, number | ''> = {};
      holdings.forEach(h => {
        initialHoldings[h.id] = h.value_minor / 100;
        if (h.invested_minor > 0 && h.value_minor > 0) {
          const ret = ((h.value_minor - h.invested_minor) / h.invested_minor) * 100;
          initialReturns[h.id] = Math.round(ret * 100) / 100;
        } else if (h.invested_minor > 0 && h.value_minor === 0) {
          initialReturns[h.id] = -100;
        } else {
          initialReturns[h.id] = 0;
        }
      });
      setHoldingValues(initialHoldings);
      setHoldingReturns(initialReturns);

      setSaveSnapshot(true);
      setObservedOn(new Date().toISOString().split('T')[0]);
    }
  }, [opened, accounts, holdings]);

  const prevCash = activeAccounts.reduce((sum, a) => sum + a.balance_minor, 0);
  const newCash = activeAccounts.reduce((sum, a) => sum + Math.round((accountBalances[a.id] ?? 0) * 100), 0);

  const prevHoldings = holdings.reduce((sum, h) => sum + h.value_minor, 0);
  const newHoldings = holdings.reduce((sum, h) => sum + Math.round((holdingValues[h.id] ?? 0) * 100), 0);

  const totalCalculatedInvested = holdings.reduce((sum, h) => {
    const valMinor = Math.round((holdingValues[h.id] ?? 0) * 100);
    const retPct = holdingReturns[h.id] ?? 0;
    return sum + computeInvestedMinor(valMinor, retPct);
  }, 0);
  const totalHoldingPnL = newHoldings - totalCalculatedInvested;

  const prevTotal = prevCash + prevHoldings;
  const newTotal = newCash + newHoldings;
  const diff = newTotal - prevTotal;

  const handleSave = async () => {
    setSaving(true);
    try {
      const accountUpdates = activeAccounts.map(a => ({
        accountId: BigInt(a.id),
        balanceMinor: BigInt(Math.round((accountBalances[a.id] ?? 0) * 100)),
      }));

      const holdingUpdates = holdings.map(h => {
        const valMinor = Math.round((holdingValues[h.id] ?? 0) * 100);
        const retPct = holdingReturns[h.id] ?? 0;
        const invMinor = computeInvestedMinor(valMinor, retPct);
        return {
          holdingId: BigInt(h.id),
          valueMinor: BigInt(valMinor),
          investedMinor: BigInt(invMinor),
        };
      });

      await updateSituation({
        accountUpdates,
        holdingUpdates,
        saveSnapshot,
        observedOn: saveSnapshot ? observedOn : undefined,
      });

      notifications.show({ color: 'teal', title: 'Situation updated', message: saveSnapshot ? 'Values saved and snapshot recorded.' : 'Values updated.' });
      await reload();
      onClose();
    } catch (cause) {
      notifications.show({ color: 'red', title: 'Failed to update situation', message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  };

  const fmt = (valMinor: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(
      valMinor / 100
    );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700} size="lg">Update Portfolio Situation</Text>}
      size="xl"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Quickly update cash balances and current asset values across all accounts in one place.
        </Text>

        <Paper withBorder p="sm" radius="md">
          <Text fw={600} size="sm" mb="xs">Account Cash Balances</Text>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Account</Table.Th>
                <Table.Th>Institution</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Cash Balance</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {activeAccounts.map(acc => (
                <Table.Tr key={acc.id}>
                  <Table.Td>
                    <Text fw={500} size="sm">{acc.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{acc.institution || '—'}</Text>
                  </Table.Td>
                  <Table.Td style={{ width: 180 }}>
                    <NumberInput
                      decimalScale={2}
                      fixedDecimalScale
                      prefix={`${acc.currency === 'EUR' ? '€' : acc.currency} `}
                      value={accountBalances[acc.id] ?? 0}
                      onChange={val => setAccountBalances(prev => ({ ...prev, [acc.id]: Number(val) }))}
                      size="xs"
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>

        {holdings.length > 0 && (
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" align="baseline" mb="xs">
              <Text fw={600} size="sm">Holdings Valuation & Performance</Text>
              <Text size="xs" c="dimmed">Invested basis is calculated as Value / (1 + Return %)</Text>
            </Group>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Holding</Table.Th>
                  <Table.Th>ISIN / Account</Table.Th>
                  <Table.Th style={{ width: 155 }}>Current Value</Table.Th>
                  <Table.Th style={{ width: 145 }}>Gain / Loss %</Table.Th>
                  <Table.Th style={{ textAlign: 'right', width: 170 }}>Calculated Invested</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {holdings.map(h => {
                  const valMinor = Math.round((holdingValues[h.id] ?? 0) * 100);
                  const retPct = holdingReturns[h.id] ?? 0;
                  const invMinor = computeInvestedMinor(valMinor, retPct);
                  const pnlMinor = valMinor - invMinor;
                  const isPositive = pnlMinor > 0;
                  const isNegative = pnlMinor < 0;

                  return (
                    <Table.Tr key={h.id}>
                      <Table.Td>
                        <Text fw={600} size="sm">{h.instrument_name || h.instrument_isin}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">{h.account_name} · {h.instrument_isin}</Text>
                      </Table.Td>
                      <Table.Td>
                        <NumberInput
                          decimalScale={2}
                          fixedDecimalScale
                          min={0}
                          prefix="€ "
                          value={holdingValues[h.id] ?? 0}
                          onChange={val => setHoldingValues(prev => ({ ...prev, [h.id]: Number(val) }))}
                          size="xs"
                        />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput
                          decimalScale={2}
                          placeholder="0.00"
                          suffix="%"
                          value={holdingReturns[h.id] ?? 0}
                          onChange={val => setHoldingReturns(prev => ({ ...prev, [h.id]: val === '' ? '' : Number(val) }))}
                          size="xs"
                          styles={{
                            input: {
                              color: typeof retPct === 'number' && retPct > 0
                                ? 'var(--mantine-color-teal-6)'
                                : typeof retPct === 'number' && retPct < 0
                                ? 'var(--mantine-color-red-6)'
                                : undefined,
                              fontWeight: typeof retPct === 'number' && retPct !== 0 ? 600 : 400,
                            }
                          }}
                          rightSection={
                            <Tooltip label="Toggle gain (+) / loss (-)" withArrow position="top">
                              <ActionIcon
                                size={20}
                                variant="subtle"
                                color={typeof retPct === 'number' && retPct < 0 ? 'red' : 'teal'}
                                onClick={() => {
                                  const cur = holdingReturns[h.id];
                                  if (typeof cur === 'number' && cur !== 0) {
                                    setHoldingReturns(prev => ({ ...prev, [h.id]: -cur }));
                                  }
                                }}
                              >
                                <Text size="xs" fw={700}>±</Text>
                              </ActionIcon>
                            </Tooltip>
                          }
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text fw={650} size="sm">{fmt(invMinor)}</Text>
                        <Text size="xs" c={isPositive ? 'teal' : isNegative ? 'red' : 'dimmed'} fw={500}>
                          {isPositive ? '+' : ''}{fmt(pnlMinor)} ({typeof retPct === 'number' ? `${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%` : '0.00%'})
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Paper>
        )}

        <Paper withBorder p="md" radius="md" bg="var(--mantine-color-body)">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Checkbox
                checked={saveSnapshot}
                onChange={e => setSaveSnapshot(e.currentTarget.checked)}
                label={<Text size="sm" fw={500}>Save dated snapshot with this update</Text>}
              />
              {saveSnapshot && (
                <Group gap="xs" mt={4}>
                  <Text size="xs" c="dimmed">Snapshot Date:</Text>
                  <TextInput
                    size="xs"
                    type="date"
                    value={observedOn}
                    onChange={e => setObservedOn(e.currentTarget.value)}
                    style={{ width: 140 }}
                  />
                </Group>
              )}
            </Stack>

            <Group gap="xl">
              {holdings.length > 0 && (
                <Stack gap={0} align="end">
                  <Text size="xs" c="dimmed">Invested Basis</Text>
                  <Text fw={600} size="sm">{fmt(totalCalculatedInvested)}</Text>
                  <Text size="xs" c={totalHoldingPnL >= 0 ? 'teal' : 'red'} fw={500}>
                    {totalHoldingPnL >= 0 ? '+' : ''}{fmt(totalHoldingPnL)} ({totalCalculatedInvested > 0 ? `${(totalHoldingPnL / totalCalculatedInvested * 100).toFixed(1)}%` : '0%'})
                  </Text>
                </Stack>
              )}
              <Stack gap={0} align="end">
                <Text size="xs" c="dimmed">New Total Assets</Text>
                <Text fw={700} size="lg">{fmt(newTotal)}</Text>
                {diff !== 0 && (
                  <Badge color={diff > 0 ? 'teal' : 'red'} size="sm" variant="light">
                    {diff > 0 ? '+' : ''}{fmt(diff)} vs current
                  </Badge>
                )}
              </Stack>
            </Group>
          </Group>
        </Paper>

        <Divider />

        <Group justify="end">
          <Button variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button color="teal" onClick={handleSave} loading={saving}>
            Save situation
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
