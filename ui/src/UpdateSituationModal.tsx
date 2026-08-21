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
  Alert,
  Divider,
} from '@mantine/core';
import { updateSituation, type Account, type Holding } from './api';

type Props = {
  opened: boolean;
  onClose: () => void;
  accounts: Account[];
  holdings: Holding[];
  reload: () => Promise<void>;
};

export function UpdateSituationModal({ opened, onClose, accounts, holdings, reload }: Props) {
  const activeAccounts = accounts.filter(a => !a.archived);

  const [accountBalances, setAccountBalances] = useState<Record<number, number>>({});
  const [holdingValues, setHoldingValues] = useState<Record<number, number>>({});
  const [saveSnapshot, setSaveSnapshot] = useState(true);
  const [observedOn, setObservedOn] = useState(() => new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (opened) {
      const initialAccs: Record<number, number> = {};
      activeAccounts.forEach(a => {
        initialAccs[a.id] = a.balance_minor / 100;
      });
      setAccountBalances(initialAccs);

      const initialHoldings: Record<number, number> = {};
      holdings.forEach(h => {
        initialHoldings[h.id] = h.value_minor / 100;
      });
      setHoldingValues(initialHoldings);

      setSaveSnapshot(true);
      setObservedOn(new Date().toISOString().split('T')[0]);
      setError('');
    }
  }, [opened, accounts, holdings]);

  const prevCash = activeAccounts.reduce((sum, a) => sum + a.balance_minor, 0);
  const newCash = activeAccounts.reduce((sum, a) => sum + Math.round((accountBalances[a.id] ?? 0) * 100), 0);

  const prevHoldings = holdings.reduce((sum, h) => sum + h.value_minor, 0);
  const newHoldings = holdings.reduce((sum, h) => sum + Math.round((holdingValues[h.id] ?? 0) * 100), 0);

  const prevTotal = prevCash + prevHoldings;
  const newTotal = newCash + newHoldings;
  const diff = newTotal - prevTotal;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const accountUpdates = activeAccounts.map(a => ({
        accountId: BigInt(a.id),
        balanceMinor: BigInt(Math.round((accountBalances[a.id] ?? 0) * 100)),
      }));

      const holdingUpdates = holdings.map(h => ({
        holdingId: BigInt(h.id),
        valueMinor: BigInt(Math.round((holdingValues[h.id] ?? 0) * 100)),
      }));

      await updateSituation({
        accountUpdates,
        holdingUpdates,
        saveSnapshot,
        observedOn: saveSnapshot ? observedOn : undefined,
      });

      await reload();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
        {error && <Alert color="red">{error}</Alert>}

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
            <Text fw={600} size="sm" mb="xs">Holding Current Values</Text>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Holding</Table.Th>
                  <Table.Th>ISIN / Account</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Current Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {holdings.map(h => (
                  <Table.Tr key={h.id}>
                    <Table.Td>
                      <Text fw={500} size="sm">{h.instrument_name || h.instrument_isin}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{h.account_name} · {h.instrument_isin}</Text>
                    </Table.Td>
                    <Table.Td style={{ width: 180 }}>
                      <NumberInput
                        decimalScale={2}
                        fixedDecimalScale
                        prefix="€ "
                        value={holdingValues[h.id] ?? 0}
                        onChange={val => setHoldingValues(prev => ({ ...prev, [h.id]: Number(val) }))}
                        size="xs"
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
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

            <Group gap="md">
              <Stack gap={0} align="end">
                <Text size="xs" c="dimmed">New Total Assets</Text>
                <Text fw={700} size="lg">{fmt(newTotal)}</Text>
              </Stack>
              {diff !== 0 && (
                <Badge color={diff > 0 ? 'teal' : 'red'} size="lg">
                  {diff > 0 ? '+' : ''}{fmt(diff)}
                </Badge>
              )}
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
