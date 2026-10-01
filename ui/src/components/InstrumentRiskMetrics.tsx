import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Paper, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { instrumentClient } from '../api';
import type { GetInstrumentRiskMetricsResponse } from '../pb/v1/instrument_pb';

// The parent keys this panel by instrument, actual chart bounds and refresh time,
// so a previous window's values are never displayed beneath a new selection.
export function InstrumentRiskMetrics({ isin, startDate, endDate }: {
  isin: string;
  startDate: string;
  endDate: string;
}) {
  const [result, setResult] = useState<GetInstrumentRiskMetricsResponse>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult(undefined);
    setError('');
    void instrumentClient.getInstrumentRiskMetrics({ isin, startDate, endDate }, { signal: controller.signal })
      .then(value => { if (active) setResult(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; controller.abort(); };
  }, [isin, startDate, endDate, attempt]);

  const m = result?.metrics;
  const cards = [
    { title: 'Volatility', value: m?.volatility, percent: true, detail: 'Annualized variation in daily returns' },
    { title: 'Sharpe ratio', value: m?.sharpe, detail: 'Excess return per unit of volatility', missing: 'Undefined when volatility is zero' },
    { title: 'Sortino ratio', value: m?.sortino, detail: 'Return above target per unit of downside risk', missing: 'Undefined when downside deviation is zero' },
    { title: 'Calmar ratio', value: m?.calmar, detail: 'CAGR divided by maximum drawdown', missing: 'Needs ≥1 year and a nonzero drawdown' },
    { title: 'Max drawdown', value: m?.maxDrawdown, percent: true, detail: 'Largest peak-to-trough loss in this window' },
    { title: 'Ulcer index', value: m?.ulcerIndex, percent: true, detail: 'Root mean square of drawdowns' },
    { title: 'Downside deviation', value: m?.downsideDeviation, percent: true, detail: 'Annualized shortfall below the target' },
    { title: 'Annualized return', value: m?.cagr, percent: true, detail: 'Compounded annual growth rate (CAGR)', missing: 'Needs at least one year of history' },
  ];

  return (
    <Stack gap="sm" mt="sm" pt="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Group justify="space-between" gap="xs">
        <Text fw={600}>Risk &amp; return</Text>
        <Badge variant="light" color="gray">Selected chart period</Badge>
      </Group>
      {error ? (
        <Alert color="red" title="Could not calculate risk metrics">
          <Text size="sm">{error}</Text>
          <Button size="compact-xs" variant="light" mt="xs" onClick={() => setAttempt(v => v + 1)}>Retry</Button>
        </Alert>
      ) : !result ? (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" aria-label="Loading risk metrics" aria-busy="true">
          {cards.map(card => <Skeleton key={card.title} height={112} radius="sm" />)}
        </SimpleGrid>
      ) : (
        <>
          <Text size="xs" c="dimmed">
            {result.startDate && `${result.startDate} – ${result.endDate} · `}
            {result.pointCount.toLocaleString()} observations · {result.currency} total return, dividends included
          </Text>
          {result.note && <Alert color="gray" variant="light">{result.note}</Alert>}
          {m && (
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
              {cards.map(card => (
                <Paper key={card.title} withBorder radius="sm" p="sm">
                  <Text size="xs" c="dimmed" fw={600}>{card.title}</Text>
                  <Text size="xl" fw={700} my={4} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {card.value === undefined || !Number.isFinite(card.value)
                      ? '—'
                      : `${(card.value * (card.percent ? 100 : 1)).toFixed(2)}${card.percent ? '%' : ''}`}
                  </Text>
                  <Text size="xs" c="dimmed" lh={1.4}>
                    {card.value === undefined ? card.missing : card.detail}
                  </Text>
                </Paper>
              ))}
            </SimpleGrid>
          )}
          <Text size="xs" c="dimmed">
            Risk-free rate {(result.riskFreeRate * 100).toFixed(1)}% · Target return {(result.targetReturn * 100).toFixed(1)}% per year (assumptions)
            {' · '}Calendar-day sampling, {result.periodsPerYear} periods/year
          </Text>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>How these are calculated</summary>
            <Text size="xs" c="dimmed" mt="xs">
              Simple daily returns from the saved justETF series, including unchanged weekends.
              Volatility uses sample standard deviation. Sharpe uses the arithmetic mean excess return;
              Sortino uses the mean return above target and squared shortfalls averaged over all returns.
              Both use square-root annualization, an estimate rather than a forecast.
              CAGR uses actual elapsed time. Calmar uses this selected window (traditionally three years).
              Drawdowns start at the first observation in this window; losses are shown as positive percentages.
              Ulcer index is not annualized. Missing dates or fewer than 30 daily returns make metrics unavailable.
              Ratios with a zero denominator are shown as a dash. These describe the instrument, before your personal taxes or trading costs.
            </Text>
          </details>
        </>
      )}
    </Stack>
  );
}
