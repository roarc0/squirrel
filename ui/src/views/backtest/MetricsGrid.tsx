import { Paper, SimpleGrid, Text, Tooltip } from '@mantine/core';
import type { BacktestPortfolio } from '../../pb/v1/backtest_pb';
import { pct, ratio } from './format';

export function MetricsGrid({ portfolio: p }: { portfolio: BacktestPortfolio }) {
  const m = p.metrics;
  const cards = [
    ['CAGR', pct(m?.cagr), 'Annualized time-weighted compound return; needs at least one year.'],
    [
      'Volatility',
      pct(m?.volatility),
      'Sample standard deviation of daily returns, annualized with 365.25 calendar days.',
    ],
    ['Sharpe', ratio(m?.sharpe), 'Annualized mean excess return / volatility. Undefined at zero volatility.'],
    [
      'Sortino',
      ratio(m?.sortino),
      'Annualized mean return above target / downside deviation. Undefined with no downside.',
    ],
    [
      'Calmar',
      ratio(m?.calmar),
      'CAGR / maximum drawdown over this window. Needs one year and a nonzero drawdown.',
    ],
    ['Ulcer index', pct(m?.ulcerIndex), 'Root mean square of percentage drawdowns; not annualized.'],
    ['Max drawdown', pct(p.maxDrawdown), 'Largest peak-to-trough loss in the time-weighted index.'],
    [
      'VaR 95% · monthly',
      pct(p.monthlyVar95),
      `Historical 5th-percentile loss; ${p.completeMonths} full months. Needs 12 months; small samples make tail estimates imprecise.`,
    ],
    [
      'VaR 99% · monthly',
      pct(p.monthlyVar99),
      'Historical 1st-percentile loss, using the same complete-month sample and linear interpolation.',
    ],
    [
      'Positive months',
      pct(p.positiveMonths),
      `Fraction of ${p.completeMonths} complete months with a strictly positive return.`,
    ],
    [
      'Downside deviation',
      pct(m?.downsideDeviation),
      'Annualized root mean squared shortfall below target over all daily returns.',
    ],
    [
      'Investor XIRR',
      pct(p.xirr),
      'Annualized money-weighted return including the timing of your deposits; needs one year.',
    ],
  ];
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
      {cards.map(([label, value, help]) => (
        <Tooltip
          key={label}
          label={help}
          multiline
          w={280}
          withArrow
          events={{ hover: true, focus: true, touch: true }}
        >
          <Paper
            withBorder
            p="sm"
            radius="md"
            tabIndex={0}
            aria-label={`${label}: ${value}. ${help}`}
            style={{ background: 'var(--mantine-color-default-hover)' }}
          >
            <Text size="10px" tt="uppercase" fw={600} c="dimmed">
              {label}
            </Text>
            <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {value}
            </Text>
          </Paper>
        </Tooltip>
      ))}
    </SimpleGrid>
  );
}
