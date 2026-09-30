import { Group, Text } from '@mantine/core';
import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';
import { money } from '../utils/format';
import { performanceMood } from '../utils/visual';

export function PerformanceResult({
  value,
  invested,
  currency,
  mood = false,
}: {
  value: number;
  invested: number;
  currency: string;
  mood?: boolean;
}) {
  if (invested <= 0) return <Text size="sm" c="dimmed">—</Text>;
  const change = value - invested;
  const changePercent = (change / invested) * 100;
  const state = performanceMood(changePercent);
  return (
    <Group gap={4} wrap="nowrap" align="center">
      {mood && <Text title={state.label} size="lg" lh={1}>{state.emoji}</Text>}
      {change >= 0 ? (
        <IconTrendingUp size={14} color="var(--mantine-color-teal-6)" />
      ) : (
        <IconTrendingDown size={14} color="var(--mantine-color-red-6)" />
      )}
      <Text size="sm" fw={700} c={change >= 0 ? 'teal' : 'red'}>
        {change >= 0 ? '+' : ''}{money(change, currency)} · {change >= 0 ? '+' : ''}{changePercent.toFixed(1)}%
      </Text>
    </Group>
  );
}
