import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useElementSize } from '@mantine/hooks';
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsExchange,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconRefresh,
  IconStar,
  IconStarFilled,
  IconX,
} from '@tabler/icons-react';
import { lookupInstrument, starInstrument, getInstrumentAlternatives, instrumentClient, type Instrument, type InstrumentAlternative } from '../api';
import { setInstrumentStarredInProfile } from '../hooks/useProfile';
import { chartGeometry, nearestChartIndex } from '../utils/visual';
import { Chip, ISINBadge, ReplicationChip, TickerBadge } from '../components/Chip';
import { instrumentLabels, label, relativeDate } from '../utils/format';
import { computeInstrumentScore, isESG, resolveInstrumentProvider } from '../utils/rankFilters';

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

const DOMICILE_DATA: Record<string, { flag: string; name: string }> = {
  IE: { flag: '🇮🇪', name: 'Ireland' },
  LU: { flag: '🇱🇺', name: 'Luxembourg' },
  DE: { flag: '🇩🇪', name: 'Germany' },
  FR: { flag: '🇫🇷', name: 'France' },
  GB: { flag: '🇬🇧', name: 'United Kingdom' },
  US: { flag: '🇺🇸', name: 'United States' },
  CH: { flag: '🇨🇭', name: 'Switzerland' },
  NL: { flag: '🇳🇱', name: 'Netherlands' },
  SE: { flag: '🇸🇪', name: 'Sweden' },
  IT: { flag: '🇮🇹', name: 'Italy' },
};

function fmtTER(bps: number) { return `${(bps / 100).toFixed(2)}%`; }
function fmtAUM(m: number) { return m >= 1000 ? `€${(m / 1000).toFixed(1)}b` : `€${m}m`; }

export function InstrumentDetailView({
  isin,
  instrument,
  instruments = [],
  onBack,
  onOpenDetail,
  reload,
}: {
  isin: string;
  instrument: Instrument | undefined;
  instruments?: Instrument[];
  onBack: () => void;
  onOpenDetail?: (isin: string) => void;
  reload?: (opts?: { refreshInstruments?: boolean }) => Promise<void>;
}) {
  const [series, setSeries] = useState<PerfPoint[]>([]);
  const [fetchedAt, setFetchedAt] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'refreshing' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const [alternatives, setAlternatives] = useState<InstrumentAlternative[]>([]);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [altsExpanded, setAltsExpanded] = useState(true);

  const score = instrument ? computeInstrumentScore(instrument) : null;

  const handleFetch = async () => {
    setFetching(true);
    setFetchError('');
    try {
      await lookupInstrument(isin);
      notifications.show({ color: 'teal', title: 'Instrument imported', message: `Successfully fetched ${isin} from justETF.` });
      await reload?.({ refreshInstruments: true });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  const [starred, setStarred] = useState(() => Boolean(instrument?.starred));
  useEffect(() => {
    setStarred(Boolean(instrument?.starred));
  }, [instrument?.starred]);

  const toggleStar = async () => {
    if (!instrument) return;
    const next = !starred;
    setStarred(next);
    setInstrumentStarredInProfile(instrument.isin, next);
    try {
      await starInstrument(instrument.isin, next);
      if (reload) void reload({ refreshInstruments: true });
    } catch (cause) {
      setStarred(!next);
      setInstrumentStarredInProfile(instrument.isin, !next);
      notifications.show({
        color: 'red',
        title: 'Failed to update star',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  useEffect(() => {
    if (!instrument?.id || instrument.instrument_type !== 'etf' || !instrument.ucits) {
      setAlternatives([]);
      return;
    }
    let active = true;
    setLoadingAlts(true);
    void getInstrumentAlternatives(instrument.id)
      .then(res => {
        if (active) setAlternatives(res ?? []);
      })
      .catch(() => {
        if (active) setAlternatives([]);
      })
      .finally(() => {
        if (active) setLoadingAlts(false);
      });
    return () => { active = false; };
  }, [instrument?.id, instrument?.instrument_type, instrument?.ucits]);

  const betterAlternatives = useMemo(() => {
    if (!instrument) return [];

    const map = new Map<string, InstrumentAlternative>();
    for (const a of alternatives) {
      map.set(a.instrument.isin, a);
    }

    if (instruments.length > 0) {
      for (const cand of instruments) {
        if (cand.isin === instrument.isin || cand.id === instrument.id) continue;
        if (cand.instrument_type !== 'etf' || !cand.ucits || cand.data_status !== 'enriched') continue;
        if (cand.asset_class !== instrument.asset_class) continue;

        const sameIndex = Boolean(instrument.index_name && cand.index_name && cand.index_name.toLowerCase().trim() === instrument.index_name.toLowerCase().trim());
        const sameFocus = Boolean(instrument.investment_focus && cand.investment_focus && cand.investment_focus.toLowerCase().trim() === instrument.investment_focus.toLowerCase().trim());

        if (sameIndex || sameFocus) {
          if (!map.has(cand.isin)) {
            const matchType = sameIndex ? 'exact_index' : 'same_exposure';
            const candScore = computeInstrumentScore(cand);
            map.set(cand.isin, {
              instrument: cand,
              match: matchType,
              better: Boolean(candScore !== null && score !== null && candScore > score),
              score: candScore ?? 0,
              reasons: [
                sameIndex ? `Tracks same index (${cand.index_name})` : `Same exposure (${cand.investment_focus})`,
                cand.ter_bps < instrument.ter_bps ? `Lower TER (${(cand.ter_bps / 100).toFixed(2)}% vs ${(instrument.ter_bps / 100).toFixed(2)}%)` : '',
                cand.fund_size_million > instrument.fund_size_million ? `Larger fund (€${cand.fund_size_million}m vs €${instrument.fund_size_million}m)` : '',
              ].filter(Boolean),
            });
          }
        }
      }
    }

    const result: {
      alt: InstrumentAlternative;
      inst: Instrument;
      score: number | null;
      scoreDiff: number;
      terSavings: number;
    }[] = [];

    for (const a of map.values()) {
      const altInst = a.instrument;
      const altScore = a.score ?? computeInstrumentScore(altInst);
      const sDiff = altScore !== null && score !== null ? Math.round((altScore - score) * 10) / 10 : (a.better ? 1 : 0);
      const isBetter = (altScore !== null && score !== null && altScore > score) || (score === null && altScore !== null) || a.better;

      if (isBetter) {
        const terDiffBps = (instrument.ter_bps ?? 0) - (altInst.ter_bps ?? 0);
        result.push({
          alt: a,
          inst: altInst,
          score: altScore,
          scoreDiff: sDiff,
          terSavings: terDiffBps / 100,
        });
      }
    }

    result.sort((x, y) => (y.scoreDiff - x.scoreDiff) || (y.terSavings - x.terSavings));
    return result;
  }, [instrument, alternatives, instruments, score]);

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
          <Stack gap="sm" align="flex-start">
            <Group gap="xs">
              <Text fw={700} size="lg">{isin}</Text>
              <Badge color="gray" variant="light">Uncataloged Instrument</Badge>
            </Group>
            <Text size="sm" c="dimmed">
              This instrument is not yet stored in your local catalog. You can fetch and enrich it directly from justETF right now.
            </Text>
            {fetchError && <Alert color="red" title="Fetch failed">{fetchError}</Alert>}
            <Group gap="sm" mt="xs">
              <Button
                color="teal"
                loading={fetching}
                leftSection={<IconRefresh size={16} />}
                onClick={() => void handleFetch()}
              >
                Fetch & Add from justETF
              </Button>
              <Button variant="default" onClick={onBack}>
                Return to Finder
              </Button>
            </Group>
          </Stack>
        </Card>
      </Stack>
    );
  }

  const domicileInfo = instrument.domicile ? DOMICILE_DATA[instrument.domicile] : undefined;
  const domicileText = domicileInfo ? `${domicileInfo.flag} ${domicileInfo.name} (${instrument.domicile})` : (instrument.domicile || '—');

  return (
    <Stack p="md" gap="md">
      {/* Top action bar */}
      <Group justify="space-between" align="center">
        <Button
          variant="subtle"
          size="sm"
          leftSection={<IconArrowLeft size={16} />}
          onClick={onBack}
          px={8}
        >
          Back to finder
        </Button>
        <Group gap="xs">
          {instrument.source_url && (
            <Tooltip label="Open profile on justETF" withArrow>
              <Button
                component="a"
                href={instrument.source_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="default"
                size="xs"
                rightSection={<IconExternalLink size={13} />}
              >
                justETF
              </Button>
            </Tooltip>
          )}
          <Tooltip label={starred ? 'Remove from starred' : 'Star this instrument'} withArrow>
            <ActionIcon
              variant={starred ? 'light' : 'default'}
              color={starred ? 'yellow' : undefined}
              size="md"
              onClick={() => void toggleStar()}
              aria-label={starred ? 'Remove from starred' : 'Star this instrument'}
            >
              {starred ? <IconStarFilled size={16} /> : <IconStar size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={status === 'refreshing' ? 'Refreshing performance…' : 'Refresh performance data'} withArrow>
            <ActionIcon
              variant="default"
              size="md"
              loading={status === 'refreshing'}
              onClick={() => void load(true)}
              aria-label="Refresh performance data"
            >
              <IconRefresh size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Main Header Banner Card with Clickable Chips */}
      <Paper withBorder p="md" radius="md" style={{ backgroundColor: 'var(--mantine-color-body)' }}>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap="sm" align="center" wrap="wrap" style={{ minWidth: 0, flex: 1 }}>
              {instrument.ticker && <TickerBadge ticker={instrument.ticker} size="lg" />}
              <Text fw={700} size="xl" style={{ lineHeight: 1.25 }}>
                {instrument.name}
              </Text>
            </Group>
            {score !== null && (
              <Tooltip label={`Composite ETF Score: ${score.toFixed(1)} / 100 · based on TER, tracking diff, fund size, and history`} withArrow>
                <Badge size="lg" variant="filled" color="grape" style={{ flexShrink: 0, height: 28, fontSize: 13 }}>
                  Score {score.toFixed(1)}
                </Badge>
              </Tooltip>
            )}
          </Group>

          {/* Chips Row: Clickable ISINBadge, Type, Asset Class, Policy, Replication, UCITS, Hedged */}
          <Group gap={6} wrap="wrap" align="center">
            <ISINBadge isin={instrument.isin} size="sm" />
            <Chip size="sm">{instrumentLabels[instrument.instrument_type] || instrument.instrument_type.toUpperCase()}</Chip>
            {instrument.asset_class && (
              <Chip size="sm" colorKey={instrument.asset_class}>
                {label(instrument.asset_class)}
              </Chip>
            )}
            <Chip size="sm" colorKey={instrument.distribution === 'accumulating' ? 'acc' : 'dist'}>
              {instrument.distribution === 'accumulating' ? 'Accumulating (Acc)' : 'Distributing (Dist)'}
            </Chip>
            {instrument.replication && (
              <ReplicationChip value={instrument.replication} size="sm" />
            )}
            {instrument.strategy && (
              <Badge size="sm" variant="light" color="indigo">
                {label(instrument.strategy)}
              </Badge>
            )}
            {isESG(instrument) && (
              <Badge size="sm" variant="light" color="green">
                ESG / SRI Screened
              </Badge>
            )}
            <Badge size="sm" variant="light" color={instrument.ucits ? 'teal' : 'gray'}>
              {instrument.ucits ? 'UCITS Compliant' : 'Non-UCITS'}
            </Badge>
            {instrument.currency_hedged && (
              <Badge size="sm" variant="light" color="blue">
                Hedged
              </Badge>
            )}
            {instrument.refreshed_at && (
              <Tooltip label={`Last refreshed: ${new Date(instrument.refreshed_at).toLocaleString()}`} withArrow>
                <Badge size="sm" variant="outline" color="gray">
                  Refreshed {relativeDate(instrument.refreshed_at)}
                </Badge>
              </Tooltip>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* Hero Key Metrics Strip */}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="sm">
        <Paper withBorder p="xs" radius="sm" ta="center">
          <Text size="11px" c="dimmed" tt="uppercase" fw={600}>TER</Text>
          <Text size="lg" fw={700} c="teal">{fmtTER(instrument.ter_bps)}</Text>
        </Paper>

        <Paper withBorder p="xs" radius="sm" ta="center">
          <Text size="11px" c="dimmed" tt="uppercase" fw={600}>Fund Size</Text>
          <Text size="lg" fw={700}>{fmtAUM(instrument.fund_size_million)}</Text>
        </Paper>

        <Paper withBorder p="xs" radius="sm" ta="center">
          <Text size="11px" c="dimmed" tt="uppercase" fw={600}>Currency</Text>
          <Text size="lg" fw={700}>{instrument.fund_currency}</Text>
        </Paper>

        <Paper withBorder p="xs" radius="sm" ta="center">
          <Text size="11px" c="dimmed" tt="uppercase" fw={600}>Inception</Text>
          {instrument.inception_date ? (
            <Tooltip label={`Incepted: ${instrument.inception_date}`} withArrow>
              <div>
                <Text size="sm" fw={700}>{new Date(`${instrument.inception_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</Text>
                <Text size="10px" c="dimmed">{relativeDate(instrument.inception_date)}</Text>
              </div>
            </Tooltip>
          ) : (
            <Text size="lg" fw={700} c="dimmed">—</Text>
          )}
        </Paper>

        <Paper withBorder p="xs" radius="sm" ta="center">
          <Text size="11px" c="dimmed" tt="uppercase" fw={600}>Domicile</Text>
          <Text size="sm" fw={700}>
            {domicileInfo?.flag ?? '🌐'} {instrument.domicile || '—'}
          </Text>
          {domicileInfo && <Text size="10px" c="dimmed" truncate>{domicileInfo.name}</Text>}
        </Paper>

        <Paper withBorder p="xs" radius="sm" ta="center">
          <Text size="11px" c="dimmed" tt="uppercase" fw={600}>
            {instrument.tracking_difference_bps !== null ? 'Tracking Diff' : 'Replication'}
          </Text>
          {instrument.tracking_difference_bps !== null ? (
            <Text size="lg" fw={700} c={instrument.tracking_difference_bps > 0 ? 'orange' : 'teal'}>
              {(instrument.tracking_difference_bps / 100).toFixed(2)}%
            </Text>
          ) : (
            <Text size="sm" fw={700} tt="capitalize" truncate>
              {instrument.replication ? instrument.replication.replace(/_/g, ' ') : '—'}
            </Text>
          )}
        </Paper>
      </SimpleGrid>

      {/* Expandable Section: Similar ETFs with a Better Score */}
      {instrument.instrument_type === 'etf' && (
        <Card withBorder p={0} radius="md" style={{ overflow: 'hidden' }}>
          <Box
            p="sm"
            style={{
              cursor: 'pointer',
              backgroundColor: 'var(--mantine-color-default-hover)',
              userSelect: 'none',
            }}
            onClick={() => setAltsExpanded(v => !v)}
          >
            <Group justify="space-between" align="center">
              <Group gap="xs" align="center">
                <IconArrowsExchange size={18} color="var(--mantine-color-teal-6)" />
                <Text fw={700} size="sm">Similar ETFs with a Better Score</Text>
                {loadingAlts ? (
                  <Loader size="xs" />
                ) : (
                  <Badge
                    size="sm"
                    variant={betterAlternatives.length > 0 ? 'filled' : 'light'}
                    color={betterAlternatives.length > 0 ? 'teal' : 'gray'}
                  >
                    {betterAlternatives.length} {betterAlternatives.length === 1 ? 'higher-scoring alternative' : 'higher-scoring alternatives'}
                  </Badge>
                )}
              </Group>
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  {altsExpanded ? 'Hide' : 'Show'}
                </Text>
                <ActionIcon variant="subtle" size="sm" color="gray" aria-label="Toggle alternatives table">
                  {altsExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                </ActionIcon>
              </Group>
            </Group>
          </Box>

          <Collapse expanded={altsExpanded}>
            <Divider />
            <Box p="sm">
              {loadingAlts ? (
                <Skeleton height={140} radius="sm" />
              ) : betterAlternatives.length === 0 ? (
                <Stack align="center" py="md" gap="xs">
                  <Text size="sm" c="dimmed">
                    No higher-scoring similar ETFs found in catalog.
                  </Text>
                  <Text size="xs" c="dimmed">
                    {score !== null ? `This ETF currently has the top composite score (${score.toFixed(1)}/100) among comparable funds.` : 'Enrich this ETF to compute composite rankings.'}
                  </Text>
                </Stack>
              ) : (
                <Table.ScrollContainer minWidth={700}>
                  <Table verticalSpacing="xs" striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Alternative ETF</Table.Th>
                        <Table.Th>Score</Table.Th>
                        <Table.Th>TER</Table.Th>
                        <Table.Th>Fund Size</Table.Th>
                        <Table.Th>Policy / Replication</Table.Th>
                        <Table.Th>Why it's Better</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Action</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {betterAlternatives.map(({ alt, inst, score: altScore, scoreDiff, terSavings }) => (
                        <Table.Tr key={inst.isin}>
                          <Table.Td>
                            <Stack gap={2}>
                              <Group gap={6} align="center">
                                {inst.ticker && <TickerBadge ticker={inst.ticker} size="xs" />}
                                <Text
                                  size="sm"
                                  fw={600}
                                  style={{ cursor: onOpenDetail ? 'pointer' : 'default', textDecoration: onOpenDetail ? 'underline' : 'none' }}
                                  onClick={() => onOpenDetail?.(inst.isin)}
                                >
                                  {inst.name}
                                </Text>
                              </Group>
                              <Group gap={4} mt={2}>
                                <ISINBadge isin={inst.isin} size="xs" />
                                {isESG(inst) && <Chip size="xs" colorKey="esg">ESG</Chip>}
                                <Badge size="xs" variant="light" color={alt.match === 'exact_index' ? 'blue' : 'gray'}>
                                  {alt.match === 'exact_index' ? 'Exact Benchmark' : 'Same Exposure'}
                                </Badge>
                              </Group>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} align="center">
                              <Badge size="sm" variant="filled" color="grape">
                                {altScore !== null ? altScore.toFixed(1) : '—'}
                              </Badge>
                              {scoreDiff > 0 && (
                                <Badge size="xs" variant="light" color="teal">
                                  +{scoreDiff.toFixed(1)}
                                </Badge>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={1}>
                              <Text size="sm" fw={600}>{fmtTER(inst.ter_bps)}</Text>
                              {terSavings > 0 ? (
                                <Text size="11px" c="teal" fw={600}>
                                  -{(terSavings).toFixed(2)}% (Saves €{Math.round(terSavings * 100)}/yr per €10k)
                                </Text>
                              ) : terSavings < 0 ? (
                                <Text size="11px" c="dimmed">
                                  +{(-terSavings).toFixed(2)}%
                                </Text>
                              ) : (
                                <Text size="11px" c="dimmed">Same cost</Text>
                              )}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={1}>
                              <Text size="sm" fw={600}>{fmtAUM(inst.fund_size_million)}</Text>
                              {instrument.fund_size_million > 0 && inst.fund_size_million >= instrument.fund_size_million * 1.5 && (
                                <Text size="11px" c="teal" fw={600}>
                                  {(inst.fund_size_million / instrument.fund_size_million).toFixed(1)}x larger
                                </Text>
                              )}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4}>
                              <Chip size="xs" colorKey={inst.distribution === 'accumulating' ? 'acc' : 'dist'}>
                                {inst.distribution === 'accumulating' ? 'Acc' : 'Dist'}
                              </Chip>
                              <ReplicationChip value={inst.replication} size="xs" />
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              {alt.reasons.length > 0 ? (
                                alt.reasons.slice(0, 2).map((r, i) => (
                                  <Text key={i} size="xs" c={r.startsWith('Saves') || r.startsWith('Lower') || r.includes('larger') ? 'teal' : 'dimmed'}>
                                    • {r}
                                  </Text>
                                ))
                              ) : (
                                <Text size="xs" c="teal">• Higher overall composite score</Text>
                              )}
                            </Stack>
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Button
                              size="xs"
                              variant="light"
                              rightSection={<IconArrowRight size={13} />}
                              onClick={() => onOpenDetail?.(inst.isin)}
                            >
                              View ETF
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Box>
          </Collapse>
        </Card>
      )}

      {/* Chart card */}
      <Card withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Historical Performance (EUR, total return incl. dividends)</Text>
        {status === 'error' && series.length > 0 && <Text c="red" size="sm" mb="sm">Refresh failed; showing saved data. {errorMsg}</Text>}
        {status === 'loading' ? (
          <Skeleton height={300} radius="sm" />
        ) : status === 'error' && series.length === 0 ? (
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
        {fetchedAt && status !== 'loading' && series.length > 0 && (
          <Text size="xs" c="dimmed" mt="xs">
            Latest observation {series[series.length - 1].date}
            {' · '}Last fetched {new Date(fetchedAt).toLocaleString()}
            {' · '}{series.length.toLocaleString()} data points
          </Text>
        )}
      </Card>

      {/* Fund Internals & Details in Modern Cards Grid */}
      <Card withBorder p="md" radius="md">
        <Group justify="space-between" align="center" mb="md">
          <Text fw={700} size="md">Fund Internals & Specifications</Text>
          {instrument.data_status === 'enriched' && (
            <Badge size="xs" variant="light" color="teal">Enriched Profile</Badge>
          )}
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          {/* Column 1: Investment Profile & Benchmark */}
          <Stack gap="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">Benchmark & Classification</Text>
            <Divider />

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Tracked Index</Text>
              <Text size="sm" fw={600} ta="right">{instrument.index_name || '—'}</Text>
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Provider / Issuer</Text>
              <Text size="sm" fw={600} ta="right">{resolveInstrumentProvider(instrument) || '—'}</Text>
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Investment Focus</Text>
              <Text size="sm" ta="right">{instrument.investment_focus || '—'}</Text>
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Asset Class</Text>
              {instrument.asset_class ? (
                <Chip size="sm" colorKey={instrument.asset_class}>{label(instrument.asset_class)}</Chip>
              ) : <Text size="sm" c="dimmed">—</Text>}
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Strategy</Text>
              {instrument.strategy ? (
                <Badge size="sm" variant="light" color="indigo">{label(instrument.strategy)}</Badge>
              ) : <Text size="sm" c="dimmed">—</Text>}
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">ESG Screening</Text>
              {isESG(instrument) ? (
                <Badge size="sm" variant="light" color="green">✓ ESG / SRI Screened</Badge>
              ) : (
                <Text size="sm" c="dimmed">Standard / Traditional</Text>
              )}
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Legal Wrapper</Text>
              <Chip size="sm">{instrumentLabels[instrument.instrument_type] || instrument.instrument_type.toUpperCase()}</Chip>
            </Group>
          </Stack>

          {/* Column 2: Mechanics, Structure & Quality */}
          <Stack gap="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">Mechanics, Quality & Structure</Text>
            <Divider />

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Distribution Policy</Text>
              <Group gap="xs">
                <Chip size="sm" colorKey={instrument.distribution === 'accumulating' ? 'acc' : 'dist'}>
                  {instrument.distribution === 'accumulating' ? 'Accumulating (Acc)' : 'Distributing (Dist)'}
                </Chip>
              </Group>
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Replication Method</Text>
              <ReplicationChip value={instrument.replication} size="sm" />
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">UCITS Compliant</Text>
              <Badge size="sm" variant="light" color={instrument.ucits ? 'teal' : 'gray'}>
                {instrument.ucits ? '✓ UCITS Compliant' : '✕ Non-UCITS'}
              </Badge>
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Currency Hedged</Text>
              <Badge size="sm" variant="light" color={instrument.currency_hedged ? 'blue' : 'gray'}>
                {instrument.currency_hedged ? 'Hedged' : 'Unhedged'}
              </Badge>
            </Group>

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">Domicile</Text>
              <Text size="sm" fw={500}>{domicileText}</Text>
            </Group>

            {instrument.tracking_difference_bps !== null && (
              <Group justify="space-between" align="center">
                <Tooltip label="Difference between fund return and index return over 1 year" withArrow>
                  <Text size="sm" c="dimmed" style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                    Tracking Difference (1Y)
                  </Text>
                </Tooltip>
                <Text size="sm" fw={600}>
                  {(instrument.tracking_difference_bps / 100).toFixed(2)}%
                </Text>
              </Group>
            )}

            {instrument.tracking_error_bps !== null && (
              <Group justify="space-between" align="center">
                <Tooltip label="Annualized volatility of excess returns relative to benchmark index" withArrow>
                  <Text size="sm" c="dimmed" style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                    Tracking Error (1Y)
                  </Text>
                </Tooltip>
                <Text size="sm" fw={600}>
                  {(instrument.tracking_error_bps / 100).toFixed(2)}%
                </Text>
              </Group>
            )}
          </Stack>
        </SimpleGrid>
      </Card>
    </Stack>
  );
}
