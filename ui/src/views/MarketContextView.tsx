import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Paper, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconActivity, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import { getMarketContext, refreshReferenceRates, type InflationRange, type MarketMetric, type MarketObservation, type ReferenceRate } from '../api';
import { SectionHeader } from '../components/SectionHeader';
import { ViewShell } from '../components/ViewShell';
import { chartGeometry, chartTickIndexes, nearestChartIndex } from '../visual';

const policySource = 'https://data.ecb.europa.eu/main-figures/ecb-interest-rates-and-exchange-rates/key-ecb-interest-rates';

const sections = [
  { category: 'policy_rates', title: 'ECB Policy Rates', subtitle: 'The three rates used to steer euro-area monetary policy.' },
  { category: 'money_market', title: 'Money Market', subtitle: '€STR overnight and compounded wholesale euro borrowing benchmarks.' },
  { category: 'inflation', title: 'Inflation', subtitle: 'Annual harmonised consumer-price changes for Italy and the euro area.' },
  { category: 'cash_benchmarks', title: 'Cash Benchmarks', subtitle: 'Average rates paid to Italian households on bank deposits.' },
  { category: 'sovereign_bonds', title: 'Sovereign Bonds', subtitle: 'Monthly 10-year government yields and the Italy–Germany spread.' },
];

export function MarketContextView({ rates, reload }: { rates: ReferenceRate[]; reload: () => Promise<void> }) {
  const [metrics, setMetrics] = useState<MarketMetric[]>([]);
  const [observations, setObservations] = useState<MarketObservation[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRange, setHistoryRange] = useState<InflationRange>('1y');
  const [error, setError] = useState('');

  const load = useCallback(async (inflationRange: InflationRange, refreshPolicyRates = false) => {
    if (refreshPolicyRates) setRefreshing(true);
    setError('');
    setWarnings([]);
    try {
      const market = await getMarketContext(inflationRange);
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

  useEffect(() => { void load('1y'); }, [load]);

  const changeHistoryRange = async (value: string) => {
    const next = value as InflationRange;
    setHistoryLoading(true);
    if (await load(next)) setHistoryRange(next);
    setHistoryLoading(false);
  };

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
        subtitle="Official public benchmarks that put cash, rates, inflation, and bonds in context."
        badge={<Badge color="blue" variant="light" leftSection={<IconActivity size={12} />}>ECB data</Badge>}
        actions={<Button leftSection={<IconRefresh size={16} />} loading={refreshing} onClick={() => void load(historyRange, true)}>Refresh all</Button>}
      />
      {warnings.length > 0 && <Alert color="yellow" title="Some sources were unavailable">{warnings.join(' · ')}</Alert>}
      {loading ? (
        <Paper withBorder radius="lg" p="xl"><Group justify="center"><Loader size="sm" /><Text c="dimmed">Collecting market context…</Text></Group></Paper>
      ) : (
        sections.map(section => (
          <MetricSection key={section.category} {...section} metrics={allMetrics.filter(metric => metric.category === section.category)} observations={observations} historyRange={historyRange} historyLoading={historyLoading} onHistoryRangeChange={value => void changeHistoryRange(value)} />
        ))
      )}
    </ViewShell>
  );
}

function MetricSection({ category, title, subtitle, metrics, observations, historyRange, historyLoading, onHistoryRangeChange }: { category: string; title: string; subtitle: string; metrics: MarketMetric[]; observations: MarketObservation[]; historyRange: InflationRange; historyLoading: boolean; onHistoryRangeChange: (value: string) => void }) {
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
      {category === 'policy_rates' && (
        <MarketChart
          title="Policy rates history"
          definitions={[
            { code: 'DFR', label: 'Deposit Facility', color: 'blue' },
            { code: 'MRR_FR', label: 'Main Refinancing', color: 'teal' },
            { code: 'MLFR', label: 'Marginal Lending', color: 'violet' },
          ]}
          observations={observations}
          range={historyRange}
          loading={historyLoading}
          onRangeChange={onHistoryRangeChange}
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
          range={historyRange}
          loading={historyLoading}
          onRangeChange={onHistoryRangeChange}
        />
      )}
      {category === 'inflation' && (
        <MarketChart
          title="Inflation history"
          definitions={[
            { code: 'HICP_IT', label: 'Italy', color: 'blue' },
            { code: 'HICP_U2', label: 'Euro area', color: 'teal' },
          ]}
          observations={observations}
          range={historyRange}
          loading={historyLoading}
          onRangeChange={onHistoryRangeChange}
          showZeroBaseline
        />
      )}
      {category === 'cash_benchmarks' && (
        <MarketChart
          title="Deposit rates history"
          definitions={[
            { code: 'MIR_L21.A', label: 'Overnight deposits', color: 'cyan' },
            { code: 'MIR_L22.F', label: 'Term deposits (<= 1Y)', color: 'blue' },
          ]}
          observations={observations}
          range={historyRange}
          loading={historyLoading}
          onRangeChange={onHistoryRangeChange}
        />
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
            range={historyRange}
            loading={historyLoading}
            onRangeChange={onHistoryRangeChange}
          />
          <MarketChart
            title="Italy–Germany 10-year spread"
            definitions={[
              { code: 'SPREAD_IT_DE_10Y', label: 'BTP–Bund spread', color: 'orange', unit: 'bps' },
            ]}
            observations={observations}
            range={historyRange}
            loading={historyLoading}
            onRangeChange={onHistoryRangeChange}
            valueUnit="bps"
          />
        </SimpleGrid>
      )}
    </Stack>
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
  range,
  loading,
  onRangeChange,
  showZeroBaseline = false,
  valueUnit = '%',
}: {
  title: string;
  definitions: SeriesDefinition[];
  observations: MarketObservation[];
  range: InflationRange;
  loading: boolean;
  onRangeChange: (value: string) => void;
  showZeroBaseline?: boolean;
  valueUnit?: string;
}) {
  const [hovered, setHovered] = useState<number>();

  const relevantObservations = useMemo(() => {
    const codes = new Set(definitions.map(d => d.code));
    return observations.filter(obs => codes.has(obs.code));
  }, [definitions, observations]);

  const scaleValues = useMemo(() => {
    const vals = relevantObservations.map(obs => obs.value);
    return showZeroBaseline ? [...vals, 0] : vals;
  }, [relevantObservations, showZeroBaseline]);

  if (scaleValues.length === 0) return null;

  const scale = chartGeometry(scaleValues, scaleValues, false);
  const dates = [...new Set(relevantObservations.map(obs => obs.observed_on))].sort();
  if (dates.length === 0) return null;

  const getX = (index: number) => (dates.length === 1 ? 407 : 74 + (index * 666) / (dates.length - 1));
  const getY = (value: number) => 24 + ((scale.high - value) / (scale.high - scale.low)) * 196;

  const xPoints = dates.map((_, index) => ({ x: getX(index), y: 0 }));

  const series = definitions.map(definition => {
    const itemsMap = new Map(
      relevantObservations
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
    return unit === 'bps' ? `${val.toFixed(1)} bps` : `${val.toFixed(2)}${unit}`;
  };

  return (
    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between" mb="sm">
        <Text fw={700}>{title}</Text>
        <Group gap="xs">
          {loading && <Loader size="xs" />}
          <SegmentedControl size="xs" value={range} disabled={loading} onChange={onRangeChange} data={[{ label: '1Y', value: '1y' }, { label: '3Y', value: '3y' }, { label: '5Y', value: '5y' }, { label: 'Max', value: 'max' }]} />
        </Group>
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
        viewBox="0 0 760 260"
        role="img"
        tabIndex={0}
        aria-label={hoverDate ? `${formatDate(hoverDate, true)}: ${series.map(item => `${item.label} ${item.itemsMap.has(hoverDate) ? formatValue(item.itemsMap.get(hoverDate)!, item.unit) : 'N/A'}`).join(', ')}` : `${title} from ${formatDate(dates[0], true)} to ${formatDate(dates.at(-1)!, true)}.`}
        style={{ cursor: 'crosshair' }}
        onPointerMove={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHovered(nearestChartIndex(((event.clientX - bounds.left) / bounds.width) * 760, dates.length));
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
          <rect x="74" y={zeroY} width="666" height={Math.max(0, Math.min(220 - zeroY, 196))} fill="var(--mantine-color-red-filled)" opacity="0.06" />
        )}
        {[0, 1, 2, 3, 4].map(index => {
          const ratio = index / 4;
          const y = 24 + ratio * 196;
          const value = scale.high - ratio * (scale.high - scale.low);
          if (showZeroBaseline && zeroY !== null && Math.abs(y - zeroY) < 8) return null;
          return (
            <g key={index}>
              <line x1="74" x2="740" y1={y} y2={y} stroke="currentColor" opacity="0.12" />
              <text x="66" y={y + 4} textAnchor="end">{formatValue(value)}</text>
            </g>
          );
        })}
        {/* Explicit 0.0% Line & Axis Label */}
        {showZeroBaseline && zeroY !== null && zeroY >= 24 && zeroY <= 220 && (
          <g>
            <line x1="74" x2="740" y1={zeroY} y2={zeroY} stroke="var(--mantine-color-red-6)" strokeDasharray="4 4" strokeWidth="1.5" opacity="0.75" />
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
            <g transform={`translate(${hoverX > 520 ? hoverX - 202 : hoverX + 12}, 32)`} style={{ pointerEvents: 'none' }}>
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
  return metric.unit === 'bps' ? `${metric.value.toFixed(1)} bps` : `${metric.value.toFixed(2)}${metric.unit}`;
}


