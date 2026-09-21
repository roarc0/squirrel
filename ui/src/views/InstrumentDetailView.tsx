import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionIcon, Button, Card, Group, Skeleton, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconArrowLeft, IconRefresh, IconX } from '@tabler/icons-react';
import { instrumentClient, type Instrument } from '../api';
import { chartGeometry, nearestChartIndex } from '../visual';

type PerfPoint = { date: string; change_bps: number };
type PeriodKey = '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y' | 'max';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '1m', label: '1M' }, { key: '3m', label: '3M' }, { key: '6m', label: '6M' },
  { key: 'ytd', label: 'YTD' }, { key: '1y', label: '1Y' }, { key: '3y', label: '3Y' },
  { key: '5y', label: '5Y' }, { key: 'max', label: 'MAX' },
];

const PERIOD_MONTHS: Partial<Record<PeriodKey, number>> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60 };

function periodCutoff(key: PeriodKey): Date {
  if (key === 'max') return new Date(0);
  const now = new Date();
  if (key === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const months = PERIOD_MONTHS[key]!;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
}

function findStartIndex(points: PerfPoint[], cutoff: Date): number {
  if (points.length === 0) return 0;
  const t = cutoff.getTime();
  let idx = 0;
  for (let i = 0; i < points.length; i++) {
    if (Date.parse(`${points[i].date}T00:00:00Z`) <= t) idx = i;
    else break;
  }
  return idx;
}

function isPeriodAvailable(points: PerfPoint[], key: PeriodKey): boolean {
  if (key === 'max') return points.length > 0;
  const t = periodCutoff(key).getTime();
  return points.some(p => Date.parse(`${p.date}T00:00:00Z`) <= t);
}

function normalizeFrom(points: PerfPoint[], startIdx: number): number[] {
  if (points.length === 0 || startIdx >= points.length) return [];
  const rawStart = points[startIdx].change_bps / 100;
  const denom = 100 + rawStart;
  if (denom === 0) return points.slice(startIdx).map(() => 0);
  return points.slice(startIdx).map(p => ((p.change_bps / 100) - rawStart) / denom * 100);
}

function formatReturn(points: PerfPoint[], key: PeriodKey): string {
  if (!isPeriodAvailable(points, key)) return '—';
  const vals = normalizeFrom(points, findStartIndex(points, periodCutoff(key)));
  if (vals.length === 0) return '—';
  const v = vals[vals.length - 1];
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function PerformanceChart({ points }: { points: PerfPoint[] }) {
  const [period, setPeriod] = useState<PeriodKey>('max');
  const [customDate, setCustomDate] = useState('');
  const [hovered, setHovered] = useState<number | undefined>();
  const { ref: containerRef, width: containerWidth } = useElementSize();
  const chartWidth = Math.max(400, Math.round(containerWidth || 760));

  // Resolve the cutoff: custom date overrides period
  const cutoff = useMemo(() => {
    if (customDate) {
      const d = new Date(`${customDate}T00:00:00Z`);
      return isNaN(d.getTime()) ? periodCutoff(period) : d;
    }
    return periodCutoff(period);
  }, [customDate, period]);

  const startIdx = useMemo(() => findStartIndex(points, cutoff), [points, cutoff]);
  const slice = useMemo(() => points.slice(startIdx), [points, startIdx]);
  const values = useMemo(() => normalizeFrom(points, startIdx), [points, startIdx]);
  const geo = useMemo(() => chartGeometry(values, values, false, chartWidth), [values, chartWidth]);

  const zeroY = useMemo(() => {
    if (geo.high === geo.low) return 220;
    return Math.min(220, Math.max(24, 24 + ((geo.high - 0) / (geo.high - geo.low)) * 196));
  }, [geo]);

  const polyline = useMemo(() => geo.points.map(p => `${p.x},${p.y}`).join(' '), [geo]);
  const area = useMemo(() => geo.points.length > 1
    ? `${geo.points[0].x},${zeroY} ${polyline} ${geo.points[geo.points.length - 1].x},${zeroY}`
    : '', [geo, zeroY, polyline]);

  const labelIdxs = useMemo(() => slice.length > 0
    ? [0, Math.floor((slice.length - 1) / 2), slice.length - 1].filter((v, i, a) => a.indexOf(v) === i)
    : [], [slice]);

  const hoverIdx = hovered === undefined ? undefined : Math.min(hovered, slice.length - 1);
  const hoverX = hoverIdx !== undefined ? geo.points[hoverIdx]?.x ?? 0 : 0;

  const minDate = points.length > 0 ? points[0].date : '';
  const maxDate = points.length > 0 ? points[points.length - 1].date : '';

  return (
    <Stack gap="sm" ref={containerRef}>
      {/* Period buttons with return % underneath */}
      <Group gap={6} align="flex-end" wrap="nowrap">
        {PERIODS.map(p => {
          const available = isPeriodAvailable(points, p.key);
          const ret = formatReturn(points, p.key);
          const isActive = !customDate && period === p.key;
          const positive = ret.startsWith('+');
          return (
            <Stack key={p.key} gap={2} align="center" style={{ minWidth: 0 }}>
              <Button
                size="compact-xs"
                variant={isActive ? 'filled' : 'subtle'}
                color={isActive ? 'teal' : 'gray'}
                disabled={!available}
                onClick={() => { setPeriod(p.key); setCustomDate(''); }}
                px={8}
              >
                {p.label}
              </Button>
              <Text
                size="xs"
                fw={600}
                c={!available || ret === '—' ? 'dimmed' : positive ? 'teal' : 'red'}
                style={{ lineHeight: 1, fontSize: 10 }}
              >
                {ret}
              </Text>
            </Stack>
          );
        })}
        <Stack gap={2} align="center" style={{ marginLeft: 'auto' }}>
          <Group gap={4} wrap="nowrap">
            <TextInput
              size="xs"
              type="date"
              value={customDate}
              min={minDate}
              max={maxDate}
              onChange={e => setCustomDate(e.currentTarget.value)}
              placeholder="From date"
              styles={{ input: { width: 130, fontSize: 11, height: 24, minHeight: 24, padding: '0 6px' } }}
            />
            {customDate && (
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setCustomDate('')}>
                <IconX size={12} />
              </ActionIcon>
            )}
          </Group>
          <Text size="xs" c="dimmed" style={{ fontSize: 10, lineHeight: 1 }}>
            {customDate ? (() => {
              const vals = normalizeFrom(points, startIdx);
              if (!vals.length) return '—';
              const v = vals[vals.length - 1];
              return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
            })() : 'custom'}
          </Text>
        </Stack>
      </Group>

      {/* SVG chart */}
      {slice.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="xl">No data for this period</Text>
      ) : (
        <svg
          viewBox={`0 0 ${chartWidth} 240`}
          style={{ width: '100%', height: 240, display: 'block', cursor: 'crosshair', overflow: 'visible' }}
          onPointerMove={e => {
            const b = e.currentTarget.getBoundingClientRect();
            setHovered(nearestChartIndex(((e.clientX - b.left) / b.width) * chartWidth, slice.length, chartWidth));
          }}
          onPointerLeave={() => setHovered(undefined)}
        >
          <defs>
            <linearGradient id="perf-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mantine-color-teal-5)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--mantine-color-teal-5)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Grid + y labels */}
          {[0, 1, 2, 3].map(i => {
            const ratio = i / 3;
            const y = 20 + ratio * 180;
            const val = geo.high - ratio * (geo.high - geo.low);
            return (
              <g key={i}>
                <line x1="60" x2={chartWidth - 8} y1={y} y2={y} stroke="currentColor" opacity="0.07" />
                <text x="54" y={y + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.5">
                  {val >= 0 ? '+' : ''}{val.toFixed(1)}%
                </text>
              </g>
            );
          })}
          {/* Zero baseline */}
          {zeroY >= 20 && zeroY <= 200 && (
            <line x1="60" x2={chartWidth - 8} y1={zeroY} y2={zeroY} stroke="currentColor" opacity="0.18" strokeDasharray="3 3" />
          )}
          {/* Gradient fill + line */}
          {area && <polygon points={area} fill="url(#perf-grad)" />}
          {polyline && (
            <polyline points={polyline} fill="none" stroke="var(--mantine-color-teal-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {/* Date axis */}
          {labelIdxs.map(idx => (
            <text key={idx} x={geo.points[idx].x} y="228"
              textAnchor={idx === 0 ? 'start' : idx === slice.length - 1 ? 'end' : 'middle'}
              fontSize="10" fill="currentColor" opacity="0.4">
              {new Date(`${slice[idx].date}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
            </text>
          ))}
          {/* Hover */}
          {hoverIdx !== undefined && geo.points[hoverIdx] && (
            <>
              <line x1={hoverX} x2={hoverX} y1="20" y2="200" stroke="currentColor" strokeDasharray="4 4" opacity="0.3" />
              <circle cx={geo.points[hoverIdx].x} cy={geo.points[hoverIdx].y} r="3.5"
                fill="var(--mantine-color-body)" stroke="var(--mantine-color-teal-5)" strokeWidth="2" />
              <g transform={`translate(${hoverX > chartWidth - 170 ? hoverX - 152 : hoverX + 10} 24)`} style={{ pointerEvents: 'none' }}>
                <rect width="142" height="48" rx="5" fill="var(--mantine-color-body)" stroke="currentColor" strokeOpacity="0.15" />
                <text x="9" y="18" fontSize="10" fontWeight="700" fill="currentColor">
                  {new Date(`${slice[hoverIdx].date}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </text>
                <text x="9" y="36" fontSize="13"
                  fill={values[hoverIdx] >= 0 ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-red-5)'}>
                  {values[hoverIdx] >= 0 ? '+' : ''}{values[hoverIdx].toFixed(2)}%
                </text>
              </g>
            </>
          )}
        </svg>
      )}
    </Stack>
  );
}

const DOMICILE_FLAGS: Record<string, string> = { IE: '🇮🇪', LU: '🇱🇺', DE: '🇩🇪', FR: '🇫🇷', GB: '🇬🇧', US: '🇺🇸', CH: '🇨🇭', NL: '🇳🇱', SE: '🇸🇪' };

function fmtTER(bps: number) { return `${(bps / 100).toFixed(2)}%`; }
function fmtAUM(m: number) { return m >= 1000 ? `€${(m / 1000).toFixed(1)}b` : `€${m}m`; }

export function InstrumentDetailView({
  isin,
  instrument,
  onBack,
}: {
  isin: string;
  instrument: Instrument | undefined;
  onBack: () => void;
}) {
  const [series, setSeries] = useState<PerfPoint[]>([]);
  const [fetchedAt, setFetchedAt] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'refreshing' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async (refresh = false) => {
    setStatus(refresh ? 'refreshing' : 'loading');
    setErrorMsg('');
    try {
      const res = refresh
        ? await instrumentClient.refreshInstrumentPerformance({ isin })
        : await instrumentClient.getInstrumentPerformance({ isin });
      setSeries((res.series ?? []).map((p: { date: string; changeBps: bigint | number | string }) => ({ date: p.date, change_bps: Number(p.changeBps) })));
      setFetchedAt(res.fetchedAt ?? '');
      setStatus('idle');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [isin]);

  useEffect(() => { void load(false); }, [load]);

  if (!instrument) {
    return (
      <Stack p="md" gap="sm">
        <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={14} />} onClick={onBack} w="fit-content">
          Back to finder
        </Button>
        <Card withBorder p="xl" radius="md">
          <Text fw={600}>{isin}</Text>
          <Text size="sm" c="dimmed" mt={4}>
            This instrument is not in your catalog.{' '}
            <Text component="span" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={onBack}>
              Add it →
            </Text>
          </Text>
        </Card>
      </Stack>
    );
  }

  const distLabel = instrument.distribution === 'accumulating' ? 'Acc' : 'Dist';

  return (
    <Stack p="md" gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="sm" align="flex-start" style={{ minWidth: 0 }}>
          <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={14} />} onClick={onBack} px={6} style={{ flexShrink: 0 }}>
            Back
          </Button>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap="xs" align="baseline" wrap="nowrap">
              {instrument.ticker && <Text fw={800} size="xl" ff="monospace" style={{ flexShrink: 0 }}>{instrument.ticker}</Text>}
              <Text fw={600} size="lg" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {instrument.name}
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">{instrument.isin}</Text>
              <Text size="xs" c="dimmed">·</Text>
              <Text size="xs" c="dimmed">{instrument.instrument_type.toUpperCase()}</Text>
              {instrument.ucits && <><Text size="xs" c="dimmed">·</Text><Text size="xs" c="dimmed">UCITS</Text></>}
              <Text size="xs" c="dimmed">·</Text>
              <Text size="xs" c="dimmed">{distLabel}</Text>
            </Group>
          </Stack>
        </Group>
        <Group gap="xs" style={{ flexShrink: 0 }}>
          {instrument.source_url && (
            <Tooltip label="Open on justETF">
              <ActionIcon variant="subtle" size="sm" component="a" href={instrument.source_url} target="_blank" rel="noopener noreferrer">
                ↗
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={status === 'refreshing' ? 'Refreshing…' : 'Refresh performance data'}>
            <ActionIcon variant="subtle" size="sm" loading={status === 'refreshing'} onClick={() => void load(true)}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Key metrics strip */}
      <Group gap="xl">
        <Stack gap={0}><Text size="xs" c="dimmed">TER</Text><Text size="sm" fw={600}>{fmtTER(instrument.ter_bps)}</Text></Stack>
        <Stack gap={0}><Text size="xs" c="dimmed">AUM</Text><Text size="sm" fw={600}>{fmtAUM(instrument.fund_size_million)}</Text></Stack>
        <Stack gap={0}><Text size="xs" c="dimmed">Currency</Text><Text size="sm" fw={600}>{instrument.fund_currency}</Text></Stack>
        {instrument.inception_date && (
          <Stack gap={0}>
            <Text size="xs" c="dimmed">Since</Text>
            <Text size="sm" fw={600}>{new Date(`${instrument.inception_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</Text>
          </Stack>
        )}
        {instrument.domicile && (
          <Stack gap={0}>
            <Text size="xs" c="dimmed">Domicile</Text>
            <Text size="sm" fw={600}>{DOMICILE_FLAGS[instrument.domicile] ?? ''} {instrument.domicile}</Text>
          </Stack>
        )}
        {instrument.replication && (
          <Stack gap={0}>
            <Text size="xs" c="dimmed">Replication</Text>
            <Text size="sm" fw={600} tt="capitalize">{instrument.replication.replace(/_/g, ' / ')}</Text>
          </Stack>
        )}
      </Group>

      {/* Chart card */}
      <Card withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Historical Performance (EUR, total return incl. dividends)</Text>
        {status === 'loading' ? (
          <Skeleton height={300} radius="sm" />
        ) : status === 'error' ? (
          <Stack align="center" py="xl" gap="xs">
            <Text c="red" size="sm">{errorMsg || 'Could not load performance data'}</Text>
            <Button size="xs" variant="light" onClick={() => void load(false)}>Retry</Button>
          </Stack>
        ) : series.length === 0 ? (
          <Stack align="center" py="xl" gap="xs">
            <Text c="dimmed" size="sm">No performance data loaded yet</Text>
            <Button size="xs" variant="light" onClick={() => void load(false)}>Load data</Button>
          </Stack>
        ) : (
          <PerformanceChart points={series} />
        )}
        {fetchedAt && status === 'idle' && series.length > 0 && (
          <Text size="xs" c="dimmed" mt="xs">
            Data as of {new Date(fetchedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            {' · '}{series.length.toLocaleString()} data points
          </Text>
        )}
      </Card>

      {/* Fund details */}
      <Card withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Fund Details</Text>
        <Stack gap="xs">
          {instrument.index_name && <Group justify="space-between"><Text size="sm" c="dimmed">Index</Text><Text size="sm">{instrument.index_name}</Text></Group>}
          {instrument.provider && <Group justify="space-between"><Text size="sm" c="dimmed">Provider</Text><Text size="sm">{instrument.provider}</Text></Group>}
          {instrument.investment_focus && <Group justify="space-between"><Text size="sm" c="dimmed">Focus</Text><Text size="sm">{instrument.investment_focus}</Text></Group>}
          {instrument.asset_class && <Group justify="space-between"><Text size="sm" c="dimmed">Asset Class</Text><Text size="sm" tt="capitalize">{instrument.asset_class}</Text></Group>}
          {instrument.strategy && <Group justify="space-between"><Text size="sm" c="dimmed">Strategy</Text><Text size="sm" tt="capitalize">{instrument.strategy}</Text></Group>}
          {instrument.tracking_difference_bps !== null && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Tracking Diff (1Y)</Text>
              <Text size="sm">{(instrument.tracking_difference_bps! / 100).toFixed(2)}%</Text>
            </Group>
          )}
          {instrument.tracking_error_bps !== null && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Tracking Error (1Y)</Text>
              <Text size="sm">{(instrument.tracking_error_bps! / 100).toFixed(2)}%</Text>
            </Group>
          )}
          <Group justify="space-between"><Text size="sm" c="dimmed">Currency Hedged</Text><Text size="sm">{instrument.currency_hedged ? 'Yes' : 'No'}</Text></Group>
          <Group justify="space-between"><Text size="sm" c="dimmed">UCITS</Text><Text size="sm">{instrument.ucits ? 'Yes' : 'No'}</Text></Group>
        </Stack>
      </Card>
    </Stack>
  );
}
