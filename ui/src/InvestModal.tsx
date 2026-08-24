import { useState } from 'react';
import {
  Alert,
  Modal,
  Button,
  Group,
  Stack,
  Text,
  NumberInput,
  Paper,
  Table,
  Badge,
  Divider,
  SimpleGrid,
  Card,
  Box,
} from '@mantine/core';
import { api, type Holding } from './api';
import { money, percent } from './utils/format';
import { notifications } from '@mantine/notifications';

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
  effectiveTargetBps: number;
  gapMinor: number;
  suggestedMinor: number;
  newValueMinor: number;
  newShareBps: number;
};

export function InvestModal({ opened, onClose, holdings, reload }: Props) {
  const activeHoldings = holdings.filter(h => !h.account_name?.toLowerCase().includes('archived'));
  const [contribution, setContribution] = useState<number>(1000);
  const [saving, setSaving] = useState(false);

  const totalCurrentMinor = activeHoldings.reduce((sum, h) => sum + h.value_minor, 0);
  const totalPlannedBps = activeHoldings.reduce((sum, h) => sum + (h.planned_bps || 0), 0);
  const totalPacBps = activeHoldings.reduce((sum, h) => sum + (h.pac_bps || 0), 0);

  const isUsingFallbackWeights = totalPlannedBps === 0;

  const contributionMinor = Math.round((contribution || 0) * 100);
  const totalTargetMinor = totalCurrentMinor + contributionMinor;

  // Compute effective target weights for each holding
  const rows: AllocationRow[] = activeHoldings.map(h => {
    let effectiveTargetBps = 0;
    if (totalPlannedBps > 0) {
      effectiveTargetBps = Math.round((h.planned_bps / totalPlannedBps) * 10000);
    } else if (totalPacBps > 0) {
      effectiveTargetBps = Math.round(((h.pac_bps || 0) / totalPacBps) * 10000);
    } else if (activeHoldings.length > 0) {
      effectiveTargetBps = Math.round(10000 / activeHoldings.length);
    }

    const currentShareBps = totalCurrentMinor > 0 ? Math.round((h.value_minor / totalCurrentMinor) * 10000) : 0;
    const targetValueMinor = Math.round((totalTargetMinor * effectiveTargetBps) / 10000);
    const gapMinor = Math.max(0, targetValueMinor - h.value_minor);

    return {
      holding: h,
      currentValueMinor: h.value_minor,
      currentShareBps,
      effectiveTargetBps,
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
    } else if (contributionMinor > 0 && totalGapMinor === 0) {
      // If all holdings are evenly balanced, distribute proportionally to target weights
      r.suggestedMinor = Math.round((r.effectiveTargetBps / 10000) * contributionMinor);
    } else {
      r.suggestedMinor = 0;
    }
    r.newValueMinor = r.currentValueMinor + r.suggestedMinor;
    r.newShareBps = totalTargetMinor > 0 ? Math.round((r.newValueMinor / totalTargetMinor) * 10000) : 0;
  });

  const activeRebalanceCount = rows.filter(r => r.suggestedMinor > 0).length;

  const handleApply = async () => {
    setSaving(true);
    try {
      for (const r of rows) {
        if (r.suggestedMinor > 0) {
          const updatedInvested = r.holding.invested_minor + r.suggestedMinor;
          await api(`/api/holdings/${r.holding.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              ...r.holding,
              value_minor: r.newValueMinor,
              invested_minor: updatedInvested,
            }),
          });
        }
      }
      notifications.show({ color: 'teal', title: 'Rebalance applied', message: `Updated ${activeRebalanceCount} holding${activeRebalanceCount !== 1 ? 's' : ''}.` });
      await reload();
      onClose();
    } catch (cause) {
      notifications.show({ color: 'red', title: 'Rebalance failed', message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  };

  const currency = holdings[0]?.currency ?? 'EUR';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={750} size="lg">⚡ Smart Invest & Portfolio Rebalance</Text>}
      size="xl"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Enter a new cash deposit to automatically distribute it across underweight holdings, bringing your portfolio closer to your target allocation without selling existing positions.
        </Text>

        {isUsingFallbackWeights && (
          <Alert color="blue" variant="light">
            <Text size="xs" fw={600}>
              ℹ️ Planned target weights are not set for these holdings. Using equal weights (or PAC shares) to calculate rebalancing deposits.
            </Text>
          </Alert>
        )}

        <Card className="metric" p="md" radius="lg">
          <Group justify="space-between" align="center">
            <NumberInput
              label="New Cash Contribution"
              prefix="€ "
              decimalScale={2}
              min={0}
              size="md"
              value={contribution}
              onChange={val => setContribution(Number(val || 0))}
              style={{ width: 240 }}
            />
            <SimpleGrid cols={3} spacing="lg">
              <Box ta="right">
                <Text size="xs" c="dimmed">Current Portfolio</Text>
                <Text fw={750} size="md">{money(totalCurrentMinor, currency)}</Text>
              </Box>
              <Box ta="right">
                <Text size="xs" c="dimmed">New Deposit</Text>
                <Text fw={750} size="md" color="teal">+{money(contributionMinor, currency)}</Text>
              </Box>
              <Box ta="right">
                <Text size="xs" c="dimmed">Target Portfolio Value</Text>
                <Text fw={800} size="lg" color="teal">{money(totalTargetMinor, currency)}</Text>
              </Box>
            </SimpleGrid>
          </Group>
        </Card>

        <Paper className="metric" p="sm" radius="lg" style={{ overflowX: 'auto' }}>
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: '38%' }}>Holding / Account</Table.Th>
                <Table.Th style={{ width: '14%', textAlign: 'right' }}>Target %</Table.Th>
                <Table.Th style={{ width: '14%', textAlign: 'right' }}>Current %</Table.Th>
                <Table.Th style={{ width: '20%', textAlign: 'right' }}>Suggested Investment</Table.Th>
                <Table.Th style={{ width: '14%', textAlign: 'right' }}>New %</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(r => {
                const hasDeposit = r.suggestedMinor > 0;
                return (
                  <Table.Tr
                    key={r.holding.id}
                    style={{
                      backgroundColor: hasDeposit ? 'rgba(32, 201, 151, 0.08)' : undefined,
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <Table.Td>
                      <Text fw={700} size="sm">{r.holding.instrument_name || r.holding.instrument_isin}</Text>
                      <Text size="xs" c="dimmed">{r.holding.account_name}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Badge variant="light" color="blue" size="sm">
                        {percent(r.effectiveTargetBps)}
                      </Badge>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm" c="dimmed">{percent(r.currentShareBps)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {hasDeposit ? (
                        <Text fw={800} size="sm" color="teal">
                          +{money(r.suggestedMinor, currency)}
                        </Text>
                      ) : (
                        <Text size="sm" c="dimmed">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Badge
                        color={hasDeposit ? 'teal' : 'gray'}
                        variant={hasDeposit ? 'filled' : 'subtle'}
                        size="sm"
                        style={{ height: 'auto', padding: '3px 8px', whiteSpace: 'nowrap' }}
                      >
                        {percent(r.newShareBps)}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>

        <Divider />

        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed">
            {activeRebalanceCount > 0
              ? `Rebalancing deposit will be distributed across ${activeRebalanceCount} holdings.`
              : 'Enter a contribution amount to see suggested rebalancing deposits.'}
          </Text>
          <Group gap="xs">
            <Button variant="subtle" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button color="teal" onClick={handleApply} loading={saving} disabled={contributionMinor <= 0}>
              Apply investments ({money(contributionMinor, currency)})
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
