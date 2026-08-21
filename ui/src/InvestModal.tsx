import { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  NumberInput,
  Paper,
  Table,
  Badge,
  Alert,
  Divider,
} from '@mantine/core';
import { api, type Holding } from './api';

type Props = {
  opened: boolean;
  onClose: () => void;
  holdings: Holding[];
  reload: () => Promise<void>;
};

type AllocationRow = {
  holding: Holding;
  currentValueMinor: number;
  currentShareBps: number;
  plannedBps: number;
  gapMinor: number;
  suggestedMinor: number;
  newValueMinor: number;
  newShareBps: number;
};

export function InvestModal({ opened, onClose, holdings, reload }: Props) {
  const activeHoldings = holdings.filter(h => h.planned_bps > 0 || h.value_minor > 0);
  const [contribution, setContribution] = useState<number>(1000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const totalCurrentMinor = activeHoldings.reduce((sum, h) => sum + h.value_minor, 0);
  const totalPlannedBps = activeHoldings.reduce((sum, h) => sum + h.planned_bps, 0);

  const contributionMinor = Math.round((contribution || 0) * 100);
  const totalTargetMinor = totalCurrentMinor + contributionMinor;

  // Calculate gaps and suggested investments
  const rows: AllocationRow[] = activeHoldings.map(h => {
    const currentShareBps = totalCurrentMinor > 0 ? Math.round((h.value_minor / totalCurrentMinor) * 10000) : 0;
    // Normalized target bps if sum(planned_bps) != 10000
    const normalizedTargetBps = totalPlannedBps > 0 ? (h.planned_bps / totalPlannedBps) * 10000 : 0;
    const targetMinor = Math.round((totalTargetMinor * normalizedTargetBps) / 10000);
    const gapMinor = Math.max(0, targetMinor - h.value_minor);
    return {
      holding: h,
      currentValueMinor: h.value_minor,
      currentShareBps,
      plannedBps: h.planned_bps,
      gapMinor,
      suggestedMinor: 0,
      newValueMinor: h.value_minor,
      newShareBps: currentShareBps,
    };
  });

  const totalGapMinor = rows.reduce((sum, r) => sum + r.gapMinor, 0);

  // Distribute contribution proportionally according to underweight gaps
  let distributedMinor = 0;
  rows.forEach((r, idx) => {
    if (totalGapMinor > 0 && contributionMinor > 0) {
      if (idx === rows.length - 1) {
        r.suggestedMinor = contributionMinor - distributedMinor;
      } else {
        r.suggestedMinor = Math.round((r.gapMinor / totalGapMinor) * contributionMinor);
        distributedMinor += r.suggestedMinor;
      }
    } else {
      r.suggestedMinor = 0;
    }
    r.newValueMinor = r.currentValueMinor + r.suggestedMinor;
    r.newShareBps = totalTargetMinor > 0 ? Math.round((r.newValueMinor / totalTargetMinor) * 10000) : 0;
  });

  const fmtCurrency = (valMinor: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(
      valMinor / 100
    );

  const fmtPercent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

  const handleApply = async () => {
    setSaving(true);
    setError('');
    try {
      for (const r of rows) {
        if (r.suggestedMinor > 0) {
          const updatedInvested = r.holding.invested_minor + r.suggestedMinor;
          await api(`/api/holdings/${r.holding.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              account_id: r.holding.account_id,
              instrument_id: r.holding.instrument_id,
              value_minor: r.newValueMinor,
              invested_minor: updatedInvested,
              planned_bps: r.holding.planned_bps,
              tax_bps: r.holding.tax_bps,
            }),
          });
        }
      }
      await reload();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700} size="lg">Invest & Rebalance Portfolio</Text>}
      size="xl"
    >
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}

        <Text size="sm" c="dimmed">
          Enter a new contribution amount to automatically distribute it across underweight holdings, bringing your portfolio closer to planned targets without selling.
        </Text>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" align="center">
            <Group gap="md">
              <NumberInput
                label="New Contribution Amount (€)"
                prefix="€ "
                decimalScale={2}
                min={0}
                value={contribution}
                onChange={val => setContribution(Number(val))}
                style={{ width: 220 }}
              />
            </Group>
            <Stack gap={2} align="end">
              <Text size="xs" c="dimmed">Current Portfolio Value</Text>
              <Text fw={700} size="md">{fmtCurrency(totalCurrentMinor)}</Text>
              <Text size="xs" c="dimmed">Target Portfolio Value</Text>
              <Text fw={700} size="lg" c="teal">{fmtCurrency(totalTargetMinor)}</Text>
            </Stack>
          </Group>
        </Paper>

        <Paper withBorder p="sm" radius="md">
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Holding</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Target %</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Current %</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Suggested Investment</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>New %</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(r => (
                <Table.Tr key={r.holding.id}>
                  <Table.Td>
                    <Text fw={500} size="sm">{r.holding.instrument_name || r.holding.instrument_isin}</Text>
                    <Text size="xs" c="dimmed">{r.holding.account_name}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Badge variant="light" color="blue">{fmtPercent(r.plannedBps)}</Badge>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm">{fmtPercent(r.currentShareBps)}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text fw={700} size="sm" c={r.suggestedMinor > 0 ? 'teal' : 'dimmed'}>
                      {r.suggestedMinor > 0 ? `+${fmtCurrency(r.suggestedMinor)}` : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Badge color={Math.abs(r.newShareBps - r.plannedBps) < 200 ? 'teal' : 'gray'}>
                      {fmtPercent(r.newShareBps)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>

        <Divider />

        <Group justify="end">
          <Button variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button color="teal" onClick={handleApply} loading={saving} disabled={contributionMinor <= 0}>
            Apply investments to holdings
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
