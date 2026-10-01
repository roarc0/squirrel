import { SimpleGrid, Paper, Text } from '@mantine/core';
import type { BacktestPortfolio } from '../../pb/v1/backtest_pb';
import { AnalysisChart } from './AnalysisChart';
import { colors, pct } from './format';

export function Drawdowns({ portfolio: p }: { portfolio: BacktestPortfolio }) {
  return (
    <>
      <Text size="sm" c="dimmed">
        Loss from the previous peak of the time-weighted index. Deposits do not conceal losses.
      </Text>
      <AnalysisChart
        title="Portfolio drawdowns"
        dates={p.series.map((d) => d.date)}
        lines={[{ name: p.name, color: colors[0], values: p.series.map((d) => -d.drawdown) }]}
      />
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper withBorder p="sm" radius="sm">
          <Text size="xs" c="dimmed">
            Maximum drawdown
          </Text>
          <Text fw={600}>{pct(p.maxDrawdown)}</Text>
        </Paper>
        <Paper withBorder p="sm" radius="sm">
          <Text size="xs" c="dimmed">
            Average drawdown · all observations
          </Text>
          <Text fw={600}>{pct(p.averageDrawdown)}</Text>
        </Paper>
        <Paper withBorder p="sm" radius="sm">
          <Text size="xs" c="dimmed">
            Longest drawdown
          </Text>
          <Text fw={600}>
            {p.longestDrawdownDays} days{p.longestDrawdownUnrecovered ? ' · unrecovered' : ''}
          </Text>
          {p.longestDrawdownStart && (
            <Text size="xs" c="dimmed">
              {p.longestDrawdownStart} → {p.longestDrawdownEnd}
            </Text>
          )}
        </Paper>
      </SimpleGrid>
    </>
  );
}
