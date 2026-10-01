import { SimpleGrid, Stack, Group, Text, Progress, Table } from '@mantine/core';
import type { BacktestPortfolio } from '../../pb/v1/backtest_pb';
import { pct } from './format';

export function HoldingPeriods({ portfolio }: { portfolio: BacktestPortfolio }) {
  return (
    <>
      <Text size="sm" c="dimmed" mb="md">
        Overlapping historical holding windows. The nonnegative share describes past outcomes, not a
        probability forecast.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        <div>
          <Text fw={600} size="sm" mb="sm">
            Worst total return
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Holding period</Table.Th>
                <Table.Th>Worst return</Table.Th>
                <Table.Th>Windows</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {portfolio.holdingPeriods.map((h) => (
                <Table.Tr key={h.years}>
                  <Table.Td>{h.years}Y</Table.Td>
                  <Table.Td c={h.worstReturn !== undefined && h.worstReturn < 0 ? 'red' : undefined}>
                    {pct(h.worstReturn)}
                  </Table.Td>
                  <Table.Td>{h.samples || '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Nonnegative outcomes
          </Text>
          {portfolio.holdingPeriods.map((h) => (
            <div key={h.years}>
              <Group justify="space-between" mb={3}>
                <Text size="xs">{h.years} years</Text>
                <Text size="xs">{pct(h.nonnegativeFraction)}</Text>
              </Group>
              {h.nonnegativeFraction !== undefined ? (
                <Progress
                  value={h.nonnegativeFraction * 100}
                  color="blue"
                  aria-label={`${h.years} years: ${pct(h.nonnegativeFraction)} nonnegative`}
                />
              ) : (
                <Text size="xs" c="dimmed">
                  Insufficient history
                </Text>
              )}
            </div>
          ))}
        </Stack>
      </SimpleGrid>
    </>
  );
}
