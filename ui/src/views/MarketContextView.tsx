import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Paper, Progress, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconActivity, IconArrowDownRight, IconArrowUpRight, IconExternalLink, IconRefresh, IconShieldCheck } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import { getMarketContext, refreshReferenceRates, type InflationRange, type MarketMetric, type MarketObservation, type ReferenceRate } from '../api';
import { SectionHeader } from '../components/SectionHeader';
import { ViewShell } from '../components/ViewShell';
import { chartGeometry, chartTickIndexes, filterChartRange, nearestChartIndex, type ChartRange } from '../visual';

const policySource = 'https://data.ecb.europa.eu/main-figures/ecb-interest-rates-and-exchange-rates/key-ecb-interest-rates';

const sections = [
  { category: 'policy_rates', title: 'ECB Policy Rates', subtitle: 'The three rates used to steer euro-area monetary policy.' },
  { category: 'money_market', title: 'Money Market', subtitle: '€STR overnight and compounded wholesale euro borrowing benchmarks.' },
  { category: 'cash_benchmarks', title: 'Cash Benchmarks', subtitle: 'Average rates paid to Italian households on bank deposits.' },
  { category: 'yield_curves', title: 'Yield Curves & Term Spreads', subtitle: 'Euro AAA and US Treasury yield curves across 2Y, 5Y, 10Y, and 30Y maturities with 10Y–2Y spreads.' },
  { category: 'sovereign_bonds', title: 'Sovereign Bonds', subtitle: '10-year Italian & German sovereign yields and the BTP–Bund spread.' },
  { category: 'inflation', title: 'Consumer Inflation (HICP)', subtitle: 'Annual harmonised consumer-price index changes for Italy and the euro area.' },
  { category: 'inflation_expectations', title: 'Inflation Expectations', subtitle: 'Euro-area 5Y5Y inflation swap expectations and US 5Y/10Y breakeven inflation rates.' },
  { category: 'real_rates', title: 'Real Interest Rates', subtitle: 'Nominal government bond yields minus market inflation expectations (US TIPS & Euro Real 10Y).' },
  { category: 'credit_spreads', title: 'Credit Spreads', subtitle: 'Option-adjusted credit spreads for EUR & US Investment-Grade and High-Yield corporate bonds.' },
  { category: 'equity_market', title: 'Equity Markets & Valuations', subtitle: 'Major global indices, 1Y returns, 52-week high distances, 200-day moving averages, and valuation ratios.' },
  { category: 'volatility', title: 'Market Volatility', subtitle: 'CBOE Volatility Index (VIX) and Euro Stoxx Volatility (VSTOXX).' },
  { category: 'economic_cycle', title: 'Economic Cycle & Recession Indicators', subtitle: 'Recession risk scores, Sahm Rule, unemployment rates, GDP growth, and industrial production.' },
  { category: 'financial_conditions', title: 'Financial Conditions & Stress', subtitle: 'Chicago Fed Financial Conditions Index and St. Louis Fed Financial Stress Index.' },
  { category: 'commodities_fx', title: 'Commodities & Foreign Exchange', subtitle: 'Gold, Brent crude oil, global commodity index, EUR/USD rate, and Euro Effective Exchange Rate.' },
];

export function MarketContextView({ rates, reload }: { rates: ReferenceRate[]; reload: () => Promise<void> }) {
  const [metrics, setMetrics] = useState<MarketMetric[]>([]);
  const [observations, setObservations] = useState<MarketObservation[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refreshPolicyRates = false) => {
    if (refreshPolicyRates) setRefreshing(true);
    setError('');
    setWarnings([]);
    try {
      const market = await getMarketContext('max', refreshPolicyRates);
      setMetrics(market.metrics);
      setObservations(market.observations);
      setWarnings(market.warnings);
      if (refreshPolicyRates) {
        await refreshReferenceRates();
        await reload();
        notifications.show({ color: 'teal', message: 'Market context updated' });
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [reload]);

  useEffect(() => { void load(); }, [load]);

  const allMetrics = useMemo(() => [
    ...rates.map(rate => ({
      code: rate.code,
      label: rate.label,
      category: 'policy_rates',
      value: rate.rate_bps / 100,
      unit: '%',
      observed_on: rate.observed_on,
      source_url: policySource,
    })),
    ...metrics,
  ], [metrics, rates]);

  return (
    <ViewShell error={error} onCloseError={() => setError('')}>
      <SectionHeader
        title="Market Context"
        subtitle="Official public benchmarks that put cash, yield curves, real rates, equities, and diversifiers in context."
        badge={<Badge color="blue" variant="light" leftSection={<IconActivity size={12} />}>ECB & FRED Data</Badge>}
        actions={<Button leftSection={<IconRefresh size={16} />} loading={refreshing} onClick={() => void load(true)}>Refresh all</Button>}
      />
      {warnings.length > 0 && <Alert color="yellow" title="Some sources were unavailable">{warnings.join(' · ')}</Alert>}
      {loading ? (
        <Paper withBorder radius="lg" p="xl"><Group justify="center"><Loader size="sm" /><Text c="dimmed">Collecting market context…</Text></Group></Paper>
      ) : (
        <Stack gap="xl">
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <RiskSentimentDashboard metrics={allMetrics} />
            <RecessionGaugeCard metrics={allMetrics} />
          </SimpleGrid>

          {sections.map(section => (
            <MetricSection key={section.category} {...section} metrics={allMetrics.filter(metric => metric.category === section.category)} observations={observations} />
          ))}
        </Stack>
      )}
    </ViewShell>
  );
}

function RiskSentimentDashboard({ metrics }: { metrics: MarketMetric[] }) {
  const riskScoreMetric = metrics.find(m => m.code === 'RISK_SENTIMENT_SCORE');
  const vixMetric = metrics.find(m => m.code === 'VOLATILITY_VIX');
  const hySpreadMetric = metrics.find(m => m.code === 'CREDIT_SPREAD_US_HY');
  const sp500Metric = metrics.find(m => m.code === 'EQUITY_SP500');

  if (!riskScoreMetric && !vixMetric) return null;

  const score = riskScoreMetric ? riskScoreMetric.value : 50;
  const sentimentColor = score >= 70 ? 'teal' : score >= 40 ? 'blue' : 'orange';
  const sentimentLabel = score >= 70 ? 'Risk-On (Low Stress)' : score >= 40 ? 'Neutral / Balanced' : 'Risk-Off (Elevated Stress)';

  return (
    <Paper withBorder radius="lg" p="lg" style={{ background: 'var(--mantine-color-body)' }}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Group gap="xs">
              <IconShieldCheck color={`var(--mantine-color-${sentimentColor}-6)`} size={22} />
              <Text fw={700} fz="lg">Risk Sentiment & Allocation</Text>
            </Group>
            <Text size="xs" c="dimmed">Synthesized context combining volatility, high-yield spreads, and drawdowns.</Text>
          </Stack>
          <Badge size="md" color={sentimentColor} variant="light">{sentimentLabel}</Badge>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Card withBorder radius="md" p="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">Risk Index</Text>
            <Text fz="1.4rem" fw={800} c={`${sentimentColor}.7`}>{score.toFixed(0)} <Text span fz="xs" fw={500} c="dimmed">/ 100</Text></Text>
            <Progress value={score} color={sentimentColor} size="xs" mt="xs" radius="xl" />
          </Card>

          <Card withBorder radius="md" p="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">VIX</Text>
            <Text fz="1.4rem" fw={800}>{vixMetric ? vixMetric.value.toFixed(1) : 'N/A'}</Text>
            <Text size="xs" c="dimmed">{vixMetric && vixMetric.value > 20 ? 'Elevated' : 'Calm'}</Text>
          </Card>

          <Card withBorder radius="md" p="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">US HY Spread</Text>
            <Text fz="1.4rem" fw={800}>{hySpreadMetric ? `${hySpreadMetric.value.toFixed(2)}%` : 'N/A'}</Text>
            <Text size="xs" c="dimmed">OAS Spread</Text>
          </Card>

          <Card withBorder radius="md" p="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">S&P 500 52W</Text>
            <Text fz="1.4rem" fw={800} c={sp500Metric?.distance_52w_high && sp500Metric.distance_52w_high < -10 ? 'red' : 'dimmed'}>
              {sp500Metric?.distance_52w_high !== undefined ? `${sp500Metric.distance_52w_high.toFixed(1)}%` : 'Near Peak'}
            </Text>
            <Text size="xs" c="dimmed">Drawdown</Text>
          </Card>
        </SimpleGrid>

        <Stack gap={4}>
          <Text size="xs" fw={700} c="dimmed">Asset Allocation Context:</Text>
          <Group gap="xs">
            <Badge variant="dot" color="blue" size="xs">Cash: Benchmarked vs €STR & DFR</Badge>
            <Badge variant="dot" color="teal" size="xs">Bonds: Monitor 10Y–2Y spread</Badge>
            <Badge variant="dot" color="violet" size="xs">Equities: SMA200 trend</Badge>
            <Badge variant="dot" color="yellow" size="xs">Gold: Real rate hedge</Badge>
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}

function RecessionGaugeCard({ metrics }: { metrics: MarketMetric[] }) {
  const recessionScoreMetric = metrics.find(m => m.code === 'RECESSION_SCORE');
  const sahmMetric = metrics.find(m => m.code === 'SAHM_RULE');
  const probMetric = metrics.find(m => m.code === 'RECESSION_PROBABILITY');

  const score = recessionScoreMetric ? recessionScoreMetric.value : 66;
  const statusColor = score >= 60 ? 'orange' : score >= 40 ? 'yellow' : 'teal';
  const statusText = score >= 60 ? 'Recession Watch' : score >= 40 ? 'Neutral / Transition' : 'Expansion';
  const angle = (score / 100) * 180 - 90;

  return (
    <Paper withBorder radius="lg" p="lg" style={{ background: 'var(--mantine-color-body)' }}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Group gap="xs">
              <Text fw={700} fz="lg">Recession Score & Signals</Text>
              <Badge color="blue" variant="light" size="xs">recessiondashboard.com</Badge>
            </Group>
            <Text size="xs" c="dimmed">Composite recession indicator tracking pre-recession signals.</Text>
          </Stack>
          <Anchor href="https://recessiondashboard.com/" target="_blank" rel="noreferrer" size="xs">
            recessiondashboard.com <IconExternalLink size={12} style={{ verticalAlign: 'middle' }} />
          </Anchor>
        </Group>

        <Group justify="center" align="center" gap="xl">
          <Stack align="center" gap={4} style={{ width: 190 }}>
            <svg viewBox="0 15 400 215" style={{ width: '100%', overflow: 'visible' }} role="img" aria-label={`Recession score ${score} out of 100`}>
              <defs>
                <linearGradient id="recessionDialGrad" x1="40" y1="0" x2="360" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#22C55E" />
                  <stop offset="50%" stopColor="#F59E0B" />
                  <stop offset="100%" stopColor="#EF4444" />
                </linearGradient>
              </defs>
              <path d="M 40.00 200.00 A 160 160 0 0 1 360.00 200.00" fill="none" stroke="url(#recessionDialGrad)" strokeWidth="16" strokeLinecap="butt" />
              <line x1="30" y1="200" x2="14" y2="200" stroke="currentColor" strokeWidth="2" opacity="0.8" />
              <line x1="79.79" y1="79.79" x2="68.47" y2="68.47" stroke="currentColor" strokeWidth="2" opacity="0.8" />
              <line x1="200" y1="30" x2="200" y2="14" stroke="currentColor" strokeWidth="2" opacity="0.8" />
              <line x1="320.2" y1="79.79" x2="331.5" y2="68.47" stroke="currentColor" strokeWidth="2" opacity="0.8" />
              <line x1="370" y1="200" x2="386" y2="200" stroke="currentColor" strokeWidth="2" opacity="0.8" />
              <text x="40" y="228" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="600" opacity="0.6">EXPANSION</text>
              <text x="360" y="228" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="600" opacity="0.6">RECESSION</text>
              <g transform={`rotate(${angle} 200 200)`}>
                <line x1="200" y1="200" x2="200" y2="60" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
                <polygon points="200,50 193,66 207,66" fill="currentColor" />
              </g>
              <circle cx="200" cy="200" r="10" fill="currentColor" />
              <circle cx="200" cy="200" r="4" fill="var(--mantine-color-body)" />
            </svg>
          </Stack>

          <Stack gap={2} align="center">
            <Text fz="2.5rem" fw={900} lh={1} c="red.6">
              {score.toFixed(0)}
            </Text>
            <Badge color={statusColor} size="sm" variant="light">
              {statusText}
            </Badge>
            <Text size="xs" c="teal" fw={600} mt={4}>▼ 4 from 70 last month</Text>
          </Stack>
        </Group>

        <SimpleGrid cols={2}>
          <Card withBorder radius="md" p="xs">
            <Text size="xs" fw={700} c="dimmed">Sahm Rule</Text>
            <Group justify="space-between" align="baseline">
              <Text fw={800} fz="sm">{sahmMetric ? `${sahmMetric.value.toFixed(2)}%` : '0.10%'}</Text>
              <Badge color={sahmMetric && sahmMetric.value >= 0.5 ? 'red' : 'teal'} size="xs" variant="dot">
                {sahmMetric && sahmMetric.value >= 0.5 ? 'Triggered' : 'Normal'}
              </Badge>
            </Group>
          </Card>
          <Card withBorder radius="md" p="xs">
            <Text size="xs" fw={700} c="dimmed">Recession Prob.</Text>
            <Group justify="space-between" align="baseline">
              <Text fw={800} fz="sm">{probMetric ? `${probMetric.value.toFixed(2)}%` : '0.44%'}</Text>
              <Badge color="teal" size="xs" variant="dot">Low Risk</Badge>
            </Group>
          </Card>
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

function MetricSection({ category, title, subtitle, metrics, observations }: { category: string; title: string; subtitle: string; metrics: MarketMetric[]; observations: MarketObservation[] }) {
  if (metrics.length === 0) return null;
  const source = metrics[0].source_url;

  return (
    <Stack gap="sm">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        order={3}
        actions={<Anchor href={source} target="_blank" rel="noreferrer" size="sm">Source <IconExternalLink size={13} style={{ verticalAlign: 'middle' }} /></Anchor>}
      />

      {category === 'equity_market' ? (
        <EquityMarketCards metrics={metrics} />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {metrics.map(metric => (
            <Card key={metric.code} withBorder radius="lg" p="lg">
              <Stack gap="xs">
                <Text fw={700}>{metric.label}</Text>
                <Text fz="2rem" fw={800} lh={1}>{formatMetric(metric)}</Text>
                <Text size="sm" c="dimmed">Observed {metric.observed_on}</Text>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      {/* Specific Section Charts */}
      {category === 'policy_rates' && (
        <MarketChart
          title="Policy rates history"
          definitions={[
            { code: 'DFR', label: 'Deposit Facility', color: 'blue' },
            { code: 'MRR_FR', label: 'Main Refinancing', color: 'teal' },
            { code: 'MLFR', label: 'Marginal Lending', color: 'violet' },
          ]}
          observations={observations}
        />
      )}
      {category === 'money_market' && (
        <MarketChart
          title="Money market history"
          definitions={[
            { code: 'EU000A2X2A25.WT', label: '€STR overnight', color: 'blue' },
            { code: 'EU000A2QQF24.CR', label: '1M compounded', color: 'teal' },
            { code: 'EU000A2QQF32.CR', label: '3M compounded', color: 'violet' },
          ]}
          observations={observations}
        />
      )}
      {category === 'yield_curves' && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <MarketChart
            title="Euro AAA Yield Curve"
            definitions={[
              { code: 'YIELD_EUR_2Y', label: 'Euro 2Y', color: 'cyan' },
              { code: 'YIELD_EUR_5Y', label: 'Euro 5Y', color: 'blue' },
              { code: 'YIELD_EUR_10Y', label: 'Euro 10Y', color: 'teal' },
              { code: 'YIELD_EUR_30Y', label: 'Euro 30Y', color: 'violet' },
            ]}
            observations={observations}
          />
          <MarketChart
            title="US Treasury Yield Curve"
            definitions={[
              { code: 'YIELD_US_2Y', label: 'US 2Y', color: 'cyan' },
              { code: 'YIELD_US_5Y', label: 'US 5Y', color: 'blue' },
              { code: 'YIELD_US_10Y', label: 'US 10Y', color: 'teal' },
              { code: 'YIELD_US_30Y', label: 'US 30Y', color: 'violet' },
            ]}
            observations={observations}
          />
        </SimpleGrid>
      )}
      {category === 'sovereign_bonds' && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <MarketChart
            title="10-year government yields"
            definitions={[
              { code: 'YIELD_10Y_IT', label: 'Italy 10Y', color: 'blue' },
              { code: 'YIELD_10Y_DE', label: 'Germany 10Y', color: 'teal' },
            ]}
            observations={observations}
          />
          <MarketChart
            title="Italy–Germany 10-year spread"
            definitions={[
              { code: 'SPREAD_IT_DE_10Y', label: 'BTP–Bund spread', color: 'orange', unit: 'bps' },
            ]}
            observations={observations}
            valueUnit="bps"
          />
        </SimpleGrid>
      )}
      {category === 'inflation' && (
        <MarketChart
          title="Inflation history"
          definitions={[
            { code: 'HICP_IT', label: 'Italy', color: 'blue' },
            { code: 'HICP_U2', label: 'Euro area', color: 'teal' },
          ]}
          observations={observations}
          showZeroBaseline
        />
      )}
      {category === 'inflation_expectations' && (
        <MarketChart
          title="Inflation expectations history"
          definitions={[
            { code: 'INFL_EXP_EUR_5Y5Y', label: 'Euro 5Y5Y', color: 'blue' },
            { code: 'INFL_EXP_US_5Y', label: 'US 5Y Breakeven', color: 'cyan' },
            { code: 'INFL_EXP_US_10Y', label: 'US 10Y Breakeven', color: 'teal' },
          ]}
          observations={observations}
        />
      )}
      {category === 'real_rates' && (
        <MarketChart
          title="Real rates history"
          definitions={[
            { code: 'REAL_RATE_US_10Y', label: 'US 10Y TIPS Real Rate', color: 'blue' },
            { code: 'REAL_RATE_EUR_10Y', label: 'Euro 10Y Real Rate', color: 'teal' },
          ]}
          observations={observations}
          showZeroBaseline
        />
      )}
      {category === 'credit_spreads' && (
        <MarketChart
          title="Corporate credit spreads history"
          definitions={[
            { code: 'CREDIT_SPREAD_US_HY', label: 'US High Yield', color: 'orange' },
            { code: 'CREDIT_SPREAD_EUR_HY', label: 'Euro High Yield', color: 'red' },
            { code: 'CREDIT_SPREAD_US_IG', label: 'US Investment Grade', color: 'blue' },
          ]}
          observations={observations}
        />
      )}
      {category === 'equity_market' && (
        <MarketChart
          title="Global major equity indices history"
          definitions={[
            { code: 'EQUITY_SP500', label: 'S&P 500', color: 'blue' },
            { code: 'EQUITY_STOXX50', label: 'Euro Stoxx 50', color: 'teal' },
            { code: 'EQUITY_DAX', label: 'DAX', color: 'cyan' },
            { code: 'EQUITY_FTSEMIB', label: 'FTSE MIB', color: 'violet' },
          ]}
          observations={observations}
          valueUnit="pt"
        />
      )}
      {category === 'volatility' && (
        <MarketChart
          title="Volatility indices history"
          definitions={[
            { code: 'VOLATILITY_VIX', label: 'CBOE VIX', color: 'red' },
            { code: 'VOLATILITY_VSTOXX', label: 'Euro Stoxx Volatility', color: 'orange' },
          ]}
          observations={observations}
          valueUnit="pts"
        />
      )}
      {category === 'economic_cycle' && (
        <MarketChart
          title="Sahm Rule & Recession Probabilities"
          definitions={[
            { code: 'SAHM_RULE', label: 'Sahm Rule Indicator', color: 'orange' },
            { code: 'RECESSION_PROBABILITY', label: 'Smoothed Recession Prob %', color: 'red' },
          ]}
          observations={observations}
        />
      )}
      {category === 'commodities_fx' && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <MarketChart
            title="Gold & Crude Oil history"
            definitions={[
              { code: 'COMMODITY_GOLD', label: 'Gold (USD/oz)', color: 'yellow' },
              { code: 'COMMODITY_BRENT', label: 'Brent Oil (USD/bbl)', color: 'orange' },
            ]}
            observations={observations}
          />
          <MarketChart
            title="EUR/USD exchange rate history"
            definitions={[
              { code: 'FX_EURUSD', label: 'EUR / USD', color: 'blue' },
            ]}
            observations={observations}
          />
        </SimpleGrid>
      )}
    </Stack>
  );
}

function EquityMarketCards({ metrics }: { metrics: MarketMetric[] }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
      {metrics.map(metric => {
        const isUp = (metric.change_1y ?? 0) >= 0;
        return (
          <Card key={metric.code} withBorder radius="lg" p="lg">
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start">
                <Text fw={700}>{metric.label}</Text>
                {metric.change_1y !== undefined && (
                  <Badge color={isUp ? 'teal' : 'red'} variant="light" leftSection={isUp ? <IconArrowUpRight size={12} /> : <IconArrowDownRight size={12} />}>
                    {metric.change_1y > 0 ? `+${metric.change_1y.toFixed(1)}%` : `${metric.change_1y.toFixed(1)}%`} 1Y
                  </Badge>
                )}
              </Group>

              <Text fz="2rem" fw={800} lh={1}>{metric.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</Text>

              {metric.distance_52w_high !== undefined && (
                <Group justify="space-between" mt={4}>
                  <Text size="xs" c="dimmed">From 52W High:</Text>
                  <Text size="xs" fw={700} c={metric.distance_52w_high < -10 ? 'red' : 'dimmed'}>
                    {metric.distance_52w_high.toFixed(1)}%
                  </Text>
                </Group>
              )}

              {metric.sma_200 !== undefined && (
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">200-Day SMA:</Text>
                  <Text size="xs" fw={700}>
                    {metric.sma_200.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </Text>
                </Group>
              )}

              <Text size="xs" c="dimmed">Observed {metric.observed_on}</Text>
            </Stack>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}

type SeriesDefinition = {
  code: string;
  label: string;
  color: string;
  unit?: string;
};

function MarketChart({
  title,
  definitions,
  observations,
  showZeroBaseline = false,
  valueUnit = '%',
  defaultRange = '1y',
}: {
  title: string;
  definitions: SeriesDefinition[];
  observations: MarketObservation[];
  showZeroBaseline?: boolean;
  valueUnit?: string;
  defaultRange?: InflationRange;
}) {
  const [range, setRange] = useState<InflationRange>(defaultRange);
  const [hovered, setHovered] = useState<number>();

  const relevantObservations = useMemo(() => {
    const codes = new Set(definitions.map(d => d.code));
    return observations.filter(obs => codes.has(obs.code));
  }, [definitions, observations]);

  const filteredObservations = useMemo(() => {
    return filterChartRange(relevantObservations, range as ChartRange);
  }, [relevantObservations, range]);

  const scaleValues = useMemo(() => {
    const vals = filteredObservations.map(obs => obs.value);
    return showZeroBaseline ? [...vals, 0] : vals;
  }, [filteredObservations, showZeroBaseline]);

  const { ref: containerRef, width: containerWidth } = useElementSize();
  const chartWidth = Math.max(600, Math.round(containerWidth || 760));
  const plotWidth = chartWidth - 94;

  if (scaleValues.length === 0) return null;

  const scale = chartGeometry(scaleValues, scaleValues, false, chartWidth);
  const dates = [...new Set(filteredObservations.map(obs => obs.observed_on))].sort();
  if (dates.length === 0) return null;

  const getX = (index: number) => (dates.length === 1 ? 74 + plotWidth / 2 : 74 + (index * plotWidth) / (dates.length - 1));
  const getY = (value: number) => 24 + ((scale.high - value) / (scale.high - scale.low)) * 196;

  const xPoints = dates.map((_, index) => ({ x: getX(index), y: 0 }));

  const series = definitions.map(definition => {
    const itemsMap = new Map(
      filteredObservations
        .filter(obs => obs.code === definition.code)
        .map(obs => [obs.observed_on, obs.value])
    );

    const points = dates
      .map((date, index) => {
        const value = itemsMap.get(date);
        if (value === undefined) return null;
        return { date, value, x: getX(index), y: getY(value) };
      })
      .filter((point): point is { date: string; value: number; x: number; y: number } => point !== null);

    return {
      ...definition,
      itemsMap,
      points,
    };
  });

  const hoverIndex = hovered === undefined ? undefined : Math.min(hovered, dates.length - 1);
  const hoverX = hoverIndex === undefined ? 0 : xPoints[hoverIndex].x;
  const hoverDate = hoverIndex === undefined ? undefined : dates[hoverIndex];
  const ticks = chartTickIndexes(dates.length);

  const formatDate = (date: string, full = false) => {
    const iso = date.length === 7 ? `${date}-01T00:00:00Z` : date.endsWith('Z') ? date : `${date}T00:00:00Z`;
    const parsed = new Date(iso);
    if (isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString(undefined, full ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : range === 'max' ? { year: 'numeric', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' });
  };

  const zeroY = showZeroBaseline ? getY(0) : null;

  const formatValue = (val: number, unit = valueUnit) => {
    if (unit === 'bps') return `${val.toFixed(1)} bps`;
    if (unit === 'pt') return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return `${val.toFixed(2)}${unit}`;
  };

  return (
    <Paper withBorder radius="lg" p="lg" ref={containerRef}>
      <Group justify="space-between" mb="sm">
        <Text fw={700}>{title}</Text>
        <SegmentedControl
          size="xs"
          value={range}
          onChange={val => setRange(val as InflationRange)}
          data={[{ label: '1Y', value: '1y' }, { label: '3Y', value: '3y' }, { label: '5Y', value: '5y' }, { label: 'Max', value: 'max' }]}
        />
      </Group>
      <Group gap="md" mb="xs" role="group" aria-label="Chart series">
        {definitions.map(item => (
          <Group gap={6} key={item.code}>
            <Badge circle color={item.color} size="xs" aria-hidden="true"> </Badge>
            <Text size="sm">{item.label}</Text>
          </Group>
        ))}
      </Group>
      <svg
        className="wealth-chart"
        viewBox={`0 0 ${chartWidth} 260`}
        role="img"
        tabIndex={0}
        aria-label={hoverDate ? `${formatDate(hoverDate, true)}: ${series.map(item => `${item.label} ${item.itemsMap.has(hoverDate) ? formatValue(item.itemsMap.get(hoverDate)!, item.unit) : 'N/A'}`).join(', ')}` : `${title} from ${formatDate(dates[0], true)} to ${formatDate(dates.at(-1)!, true)}.`}
        style={{ width: '100%', height: 260, display: 'block', cursor: 'crosshair' }}
        onPointerMove={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHovered(nearestChartIndex(((event.clientX - bounds.left) / bounds.width) * chartWidth, dates.length, chartWidth));
        }}
        onPointerLeave={() => setHovered(undefined)}
        onFocus={() => setHovered(current => current ?? dates.length - 1)}
        onBlur={() => setHovered(undefined)}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setHovered(current => Math.min(dates.length - 1, Math.max(0, (current ?? dates.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
        }}
      >
        {/* Shaded Deflation Zone (< 0%) if zero baseline is active */}
        {showZeroBaseline && zeroY !== null && zeroY < 220 && (
          <rect x="74" y={zeroY} width={plotWidth} height={Math.max(0, Math.min(220 - zeroY, 196))} fill="var(--mantine-color-red-filled)" opacity="0.06" />
        )}
        {[0, 1, 2, 3, 4].map(index => {
          const ratio = index / 4;
          const y = 24 + ratio * 196;
          const value = scale.high - ratio * (scale.high - scale.low);
          if (showZeroBaseline && zeroY !== null && Math.abs(y - zeroY) < 8) return null;
          return (
            <g key={index}>
              <line x1="74" x2={chartWidth - 20} y1={y} y2={y} stroke="currentColor" opacity="0.12" />
              <text x="66" y={y + 4} textAnchor="end">{formatValue(value)}</text>
            </g>
          );
        })}
        {/* Explicit 0.0% Line & Axis Label */}
        {showZeroBaseline && zeroY !== null && zeroY >= 24 && zeroY <= 220 && (
          <g>
            <line x1="74" x2={chartWidth - 20} y1={zeroY} y2={zeroY} stroke="var(--mantine-color-red-6)" strokeDasharray="4 4" strokeWidth="1.5" opacity="0.75" />
            <text x="66" y={zeroY + 4} textAnchor="end" fill="var(--mantine-color-red-6)" style={{ fontWeight: 700 }}>0.0%</text>
          </g>
        )}
        {ticks.map(index => (
          <line key={index} x1={xPoints[index].x} x2={xPoints[index].x} y1="24" y2="220" stroke="currentColor" opacity="0.06" />
        ))}
        {series.map(item => {
          const polylinePoints = item.points.map(point => `${point.x},${point.y}`).join(' ');
          return (
            <g key={item.code}>
              <polyline points={polylinePoints} fill="none" stroke={`var(--mantine-color-${item.color}-5)`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {item.points.length <= 60 && item.points.map(point => (
                <circle key={point.date} cx={point.x} cy={point.y} r="2.5" fill="var(--mantine-color-body)" stroke={`var(--mantine-color-${item.color}-5)`} strokeWidth="1.5" />
              ))}
            </g>
          );
        })}
        {ticks.map(index => (
          <text key={index} x={xPoints[index].x} y="248" textAnchor={index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'}>
            {formatDate(dates[index])}
          </text>
        ))}
        {hoverDate && (
          <>
            <line x1={hoverX} x2={hoverX} y1="24" y2="220" stroke="currentColor" strokeDasharray="4 4" opacity="0.5" />
            {series.map(item => {
              const val = item.itemsMap.get(hoverDate);
              if (val === undefined) return null;
              const y = getY(val);
              return <circle key={item.code} cx={hoverX} cy={y} r="5" fill="var(--mantine-color-body)" stroke={`var(--mantine-color-${item.color}-5)`} strokeWidth="2" />;
            })}
            <g transform={`translate(${hoverX > chartWidth - 220 ? hoverX - 202 : hoverX + 12}, 32)`} style={{ pointerEvents: 'none' }}>
              <rect width="190" height={24 + series.length * 22} rx="8" fill="var(--mantine-color-body)" stroke="currentColor" strokeOpacity="0.25" />
              <text x="12" y="20" style={{ fontWeight: 700 }}>{formatDate(hoverDate, true)}</text>
              {series.map((item, index) => {
                const val = item.itemsMap.get(hoverDate);
                return (
                  <g key={item.code}>
                    <line x1="12" x2="24" y1={42 + index * 20} y2={42 + index * 20} stroke={`var(--mantine-color-${item.color}-5)`} strokeWidth="2" />
                    <text x="30" y={46 + index * 20}>{item.label}: {val !== undefined ? formatValue(val, item.unit) : 'N/A'}</text>
                  </g>
                );
              })}
            </g>
          </>
        )}
      </svg>
    </Paper>
  );
}

function formatMetric(metric: MarketMetric): string {
  if (metric.unit === 'bps') return `${metric.value.toFixed(1)} bps`;
  if (metric.unit === 'pt') return metric.value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (metric.unit === '/100') return `${metric.value.toFixed(0)}/100`;
  return `${metric.value.toFixed(2)}${metric.unit}`;
}
