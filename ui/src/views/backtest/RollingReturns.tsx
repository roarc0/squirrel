import { useState } from 'react';
import { Group, Select, Text } from '@mantine/core';
import type { BacktestPortfolio } from '../../pb/v1/backtest_pb';
import { AnalysisChart } from './AnalysisChart';
import { colors } from './format';

export function RollingReturns({ portfolio }: { portfolio: BacktestPortfolio }) {
  const [years, setYears] = useState('1');
  const points = portfolio.rolling.find((r) => r.years === Number(years))?.points ?? [];
  return (
    <>
      <Group justify="space-between" mb="sm">
        <Text size="sm" c="dimmed">
          Annualized return for every trailing calendar window.
        </Text>
        <Select
          aria-label="Rolling return window"
          w={100}
          value={years}
          onChange={(v) => setYears(v ?? '1')}
          data={['1', '3', '5'].map((v) => ({ value: v, label: `${v}Y` }))}
        />
      </Group>
      <AnalysisChart
        title="Rolling annualized returns"
        dates={points.map((p) => p.date)}
        lines={[{ name: portfolio.name, color: colors[0], values: points.map((p) => p.returnValue) }]}
      />
    </>
  );
}
