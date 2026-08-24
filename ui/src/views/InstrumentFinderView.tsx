import { useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowsExchange,
  IconExternalLink,
  IconPencil,
  IconRefresh,
  IconStar,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react';
import {
  api,
  instrumentClient,
  type Instrument,
  type InstrumentAlternative,
  type InstrumentType,
  type RankedInstrument,
} from '../api';
import { useBackendRows } from '../App';
import { Chip } from '../Chip';
import { CompareModal } from '../CompareModal';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn, type SortDirection } from '../DataTable';
import { confirmDelete as legacyConfirmDelete, instrumentLabels, label, percent } from '../utils/format';
import { matchesExactFilters, pageBounds } from '../visual';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { useProfile, getProfile } from '../hooks/useProfile';
import { useQueryParam, useQueryParamObject } from '../hooks/useQueryParam';

type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

type InstrumentDraft = Omit<Instrument, 'id' | 'ter_bps' | 'fund_size_million' | 'tracking_difference_bps' | 'tracking_error_bps'> & { ter: Numeric; size: Numeric; trackingDifference: Numeric; trackingError: Numeric };
const blankInstrument = (): InstrumentDraft => ({ isin: '', name: '', ticker: '', instrument_type: 'etf', provider: '', index_name: '', investment_focus: '', asset_class: '', strategy: 'broad', currency_hedged: false, starred: false, data_status: 'enriched', distribution: 'accumulating', replication: 'physical_full', domicile: 'IE', fund_currency: 'EUR', ter: 0.2, size: 0, inception_date: '', trackingDifference: '', trackingError: '', ucits: false, source_url: '' });

type InstrumentColumn = 'ticker' | 'isin' | 'type' | 'issuer' | 'assetClass' | 'exposure' | 'policy' | 'replication' | 'ter' | 'size' | 'domicile' | 'currency' | 'inception' | 'tracking' | 'enriched';
type InstrumentFilters = { issuer: string; type: string; assetClass: string; policy: string; replication: string; domicile: string; currency: string; ucits: string };
type EnrichmentMode = 'missing' | 'discover' | 'oldest';
type EnrichmentProgress = { mode: EnrichmentMode; phase: string; current?: string; processed: number; total: number; available?: number; enriched: number; skipped: number; failed: number; done: boolean; error?: string };
const instrumentColumns: { value: InstrumentColumn; label: string }[] = [
  { value: 'ticker', label: 'Ticker' }, { value: 'isin', label: 'ISIN' }, { value: 'type', label: 'Type' }, { value: 'issuer', label: 'Issuer' },
  { value: 'assetClass', label: 'Asset class' }, { value: 'exposure', label: 'Exposure' }, { value: 'policy', label: 'Policy' },
  { value: 'replication', label: 'Replication' }, { value: 'ter', label: 'TER' }, { value: 'size', label: 'Size' }, { value: 'domicile', label: 'Domicile' },
  { value: 'currency', label: 'Currency' }, { value: 'inception', label: 'Inception' }, { value: 'tracking', label: 'Tracking' }, { value: 'enriched', label: 'Last refreshed' },
];
const defaultInstrumentColumns: InstrumentColumn[] = ['ticker', 'isin', 'type', 'issuer', 'exposure', 'policy', 'replication', 'ter', 'size'];

function savedInstrumentColumns(): InstrumentColumn[] {
  // Read from profile cache first, fall back to legacy localStorage
  const profileJson = getProfile().instrument_columns_json;
  const raw = profileJson || localStorage.getItem('loot.instrumentColumns.v2') || localStorage.getItem('port.instrumentColumns.v2');
  try {
    if (!raw) return defaultInstrumentColumns;
    const saved = JSON.parse(raw) as string[];
    const valid = saved.filter((value): value is InstrumentColumn => instrumentColumns.some(column => column.value === value));
    return valid.length ? valid : defaultInstrumentColumns;
  } catch { return defaultInstrumentColumns; }
}

const replicationLabel = (value: Instrument['replication']) => ({ physical_full: 'Physical full', physical_sampling: 'Physical sampling', synthetic: 'Synthetic' })[value];
const productLabel = (instrument: Instrument) => instrument.instrument_type === 'etf' ? `${instrument.ucits ? 'UCITS' : 'Non-UCITS'} ETF` : instrument.instrument_type === 'etc' || instrument.instrument_type === 'etn' ? `Non-UCITS ${instrumentLabels[instrument.instrument_type]}` : instrumentLabels[instrument.instrument_type];
const policyChip = (instrument: Instrument) => <Tooltip label={instrument.distribution === 'accumulating' ? 'Accumulating' : 'Distributing'}><Chip>{instrument.distribution === 'accumulating' ? 'Acc' : 'Dist'}</Chip></Tooltip>;
type CatalogRow = RankedInstrument & { similarity?: InstrumentAlternative };

export function InstrumentFinderView({ instruments, reload }: { instruments: Instrument[]; reload: () => Promise<void> }) {
  const [opened, setOpened] = useState(false); const [editing, setEditing] = useState<Instrument>(); const [ranked, setRanked] = useState<RankedInstrument[]>([]); const [error, setError] = useState('');
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const [lookupQuery, setLookupQuery] = useState(''); const [lookingUp, setLookingUp] = useState(false);
  const [searchResults, setSearchResults] = useState<Instrument[]>([]); const [selected, setSelected] = useState<string[]>([]); const [searching, setSearching] = useState(false); const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false); const [enriching, setEnriching] = useState(false); const [notice, setNotice] = useState(''); const [localQuery, setLocalQuery] = useQueryParam('q');
  const [streamController, setStreamController] = useState<AbortController>(); const [streamProgress, setStreamProgress] = useState<EnrichmentProgress>();
  const [visibleColumns, setVisibleColumns] = useState<InstrumentColumn[]>(savedInstrumentColumns); const [columnsOpen, setColumnsOpen] = useState(false); const [filtersOpenRaw, setFiltersOpen] = useQueryParam('filters');
  const filtersOpen = filtersOpenRaw === '1';
  const [filters, setFilters] = useQueryParamObject('f', { issuer: '', type: '', assetClass: '', policy: '', replication: '', domicile: '', currency: '', ucits: '' } as InstrumentFilters);
  const [similarity, setSimilarity] = useState(() => (new URLSearchParams(window.location.search).get('similarity') ?? '').toUpperCase()); const [alternatives, setAlternatives] = useState<InstrumentAlternative[]>([]); const [loadingAlternatives, setLoadingAlternatives] = useState(false); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(50);
  const [indexQuery, setIndexQuery] = useState('');
  const [distribution, setDistribution] = useState(''); const [replication, setReplication] = useState(''); const [domicile, setDomicile] = useState('');
  const [maxTER, setMaxTER] = useState<Numeric>(''); const [minSize, setMinSize] = useState<Numeric>(100); const [minAge, setMinAge] = useState<Numeric>(3);
  const catalog = useBackendRows('/api/instruments', instruments);
  const setSimilarityFilter = (isin = '') => {
    const params = new URLSearchParams(window.location.search);
    if (isin) params.set('similarity', isin); else params.delete('similarity');
    window.history.pushState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
    setSimilarity(isin); setRanked([]); setPage(1);
  };
  const rank = async () => { try { const result = await api<RankedInstrument[]>('/api/instruments/rank', { method: 'POST', body: JSON.stringify({ index_query: indexQuery, distribution, replications: replication ? [replication] : [], domiciles: domicile ? domicile.split(',').map(value => value.trim().toUpperCase()).filter(Boolean) : [], max_ter_bps: maxTER === '' ? null : bps(maxTER), min_fund_size_million: n(minSize), min_age_years: n(minAge), weights: { cost: 35, tracking_difference: 30, tracking_error: 15, size: 15, age: 5 } }) }); setSimilarityFilter(); setRanked(result ?? []); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const lookup = async (query = lookupQuery) => { if (!query.trim()) return; setLookingUp(true); try { const inst = await api<Instrument>('/api/instruments/lookup', { method: 'POST', body: JSON.stringify({ query }) }); setLookupQuery(''); setRanked([]); setError(''); await reload(); notifications.show({ color: 'teal', title: 'Profile refreshed', message: inst?.name ?? query }); } catch (cause) { notifications.show({ color: 'red', title: 'Refresh failed', message: cause instanceof Error ? cause.message : String(cause) }); setError(''); } finally { setLookingUp(false); } };
  const search = async () => { if (!lookupQuery.trim()) return; setSearching(true); try { const result = await api<Instrument[]>(`/api/instruments/search?q=${encodeURIComponent(lookupQuery)}`); setSearchResults(result ?? []); setSelected((result ?? []).map(item => item.isin)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSearching(false); } };
  const importSelected = async () => { if (selected.length === 0) return; setImporting(true); try { await api<Instrument[]>('/api/instruments/import', { method: 'POST', body: JSON.stringify({ isins: selected }) }); setSearchResults([]); setSelected([]); setLookupQuery(''); setRanked([]); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setImporting(false); } };
  const syncCatalog = async () => { setSyncing(true); try { const result = await api<{ saved: number; available: number }>('/api/instruments/catalog/sync', { method: 'POST', body: JSON.stringify({ limit: 4000 }) }); setNotice(`Saved ${result.saved.toLocaleString()} UCITS ETFs from ${result.available.toLocaleString()} screener results.`); setError(''); setRanked([]); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSyncing(false); } };
  const enrichCatalog = async () => { setEnriching(true); try { const result = await api<{ enriched: number; failed: number }>('/api/instruments/catalog/enrich', { method: 'POST', body: JSON.stringify({ limit: 20 }) }); setNotice(`Refreshed ${result.enriched} product profiles${result.failed ? `; ${result.failed} failed and can be retried` : ''}.`); setError(''); setRanked([]); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setEnriching(false); } };
  const streamEnrichment = async (mode: EnrichmentMode) => {
    const controller = new AbortController(); setStreamController(controller); setStreamProgress({ mode, phase: 'loading', processed: 0, total: 0, enriched: 0, skipped: 0, failed: 0, done: false }); setNotice(''); setError('');
    try {
      let latest: EnrichmentProgress | undefined;
      for await (const res of instrumentClient.streamInstrumentCatalog({ mode }, { signal: controller.signal })) {
        latest = {
          mode: res.mode,
          phase: res.phase,
          current: res.current ?? undefined,
          processed: res.processed,
          total: res.total,
          available: res.available ?? undefined,
          enriched: res.enriched,
          skipped: res.skipped,
          failed: res.failed,
          done: res.done,
          error: res.error ?? undefined,
        };
        setStreamProgress(latest);
        if (latest.error) throw new Error(latest.error);
      }
      if (latest) setNotice(`Finished: ${latest.enriched} refreshed, ${latest.skipped} non-UCITS skipped, ${latest.failed} failed.`);
      setRanked([]); await reload();
    } catch (cause) {
      if (cause instanceof Error && (cause.name === 'AbortError' || cause.message.includes('canceled'))) { setNotice('Refresh stopped. Completed profiles were saved; the next run will resume from the remaining or oldest records.'); setRanked([]); await reload(); }
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setStreamController(current => current === controller ? undefined : current); }
  };
  const showAlternatives = (instrument: Instrument) => setSimilarityFilter(instrument.isin);
  const star = async (instrument: Instrument) => { try { await api(`/api/instruments/${encodeURIComponent(instrument.isin)}/star`, { method: 'PUT', body: JSON.stringify({ starred: !instrument.starred }) }); setRanked([]); setError(''); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const remove = (instrument: Instrument) => {
    confirmDelete('instrument', `${instrument.ticker || instrument.name} · ${instrument.isin}`, async () => {
      try { await api(`/api/instruments/${instrument.id}`, { method: 'DELETE' }); setRanked([]); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }, 'Remove its holdings first if this instrument is currently owned.');
  };
  const open = (instrument?: Instrument) => { setEditing(instrument); setOpened(true); };
  const refreshedCount = instruments.filter(instrument => instrument.data_status === 'enriched').length;
  const rankableCount = instruments.filter(instrument => instrument.instrument_type === 'etf' && instrument.data_status === 'enriched' && instrument.ucits).length;
  const nonUCITSCount = instruments.filter(instrument => !instrument.ucits).length;
  const issuerOptions = [...new Set(instruments.flatMap(instrument => instrument.provider ? [instrument.provider] : []))].sort();
  const domicileOptions = [...new Set(instruments.flatMap(instrument => instrument.domicile ? [instrument.domicile] : []))].sort();
  const currencyOptions = [...new Set(instruments.map(instrument => instrument.fund_currency).filter(Boolean))].sort();
  const similarTo = instruments.find(instrument => instrument.isin === similarity);
  const rows: CatalogRow[] = similarity ? alternatives.map(item => ({ instrument: item.instrument, total: -1, cost: 0, tracking_difference: 0, tracking_error: 0, size: 0, age: 0, similarity: item })) : ranked.length > 0 ? ranked : catalog.rows.map(instrument => ({ instrument, total: -1, cost: 0, tracking_difference: 0, tracking_error: 0, size: 0, age: 0 }));
  const query = localQuery.trim().toLowerCase();
  const matchingRows = rows.filter(({ instrument }) =>
    (!query || [instrument.name, instrument.ticker, instrument.isin, instrument.provider, instrument.index_name, instrument.investment_focus, instrument.asset_class, instrument.instrument_type].some(value => value?.toLowerCase().includes(query))) &&
    matchesExactFilters({ issuer: instrument.provider ?? '', type: instrument.instrument_type, assetClass: instrument.asset_class ?? '', policy: instrument.distribution, replication: instrument.replication, domicile: instrument.domicile ?? '', currency: instrument.fund_currency, ucits: instrument.ucits }, filters));
  const [localSortKey, setLocalSortKey] = useState<string>('');
  const [localSortDir, setLocalSortDir] = useState<SortDirection>('asc');
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const getRowSortValue = (row: CatalogRow, key: string): any => {
    const inst = row.instrument;
    switch (key) {
      case 'starred': return inst.starred ? 1 : 0;
      case 'score': return row.total;
      case 'similarity': return row.similarity?.better ? 2 : row.similarity?.match === 'exact_index' ? 1 : 0;
      case 'name': return (inst.name || '').toLowerCase();
      case 'ticker': return (inst.ticker || '').toLowerCase();
      case 'isin': return inst.isin || '';
      case 'type': return inst.instrument_type || '';
      case 'issuer': return (inst.provider || '').toLowerCase();
      case 'asset_class':
      case 'assetClass': return inst.asset_class || '';
      case 'exposure': return (inst.index_name || inst.investment_focus || '').toLowerCase();
      case 'policy': return inst.distribution || '';
      case 'replication': return inst.replication || '';
      case 'ter': return inst.ter_bps;
      case 'size': return inst.fund_size_million;
      case 'domicile': return inst.domicile || '';
      case 'currency': return inst.fund_currency || '';
      case 'inception': return inst.inception_date || '';
      case 'tracking': return inst.tracking_difference_bps ?? 999999;
      case 'enriched': return inst.enriched_at || '';
      default: return 0;
    }
  };
  const sortedRows = [...matchingRows];
  if ((ranked.length > 0 || similarity) && localSortKey) {
    sortedRows.sort((a, b) => {
      const valA = getRowSortValue(a, localSortKey);
      const valB = getRowSortValue(b, localSortKey);
      let comp = 0;
      if (typeof valA === 'string' && typeof valB === 'string') {
        comp = valA.localeCompare(valB);
      } else {
        comp = (valA ?? 0) < (valB ?? 0) ? -1 : (valA ?? 0) > (valB ?? 0) ? 1 : 0;
      }
      return localSortDir === 'desc' ? -comp : comp;
    });
  }
  const bounds = pageBounds(sortedRows.length, page, pageSize);
  const visibleRows = sortedRows.slice(bounds.start, bounds.end);
  const [selectedCompareISINs, setSelectedCompareISINs] = useState<string[]>([]);
  const [compareModalOpened, setCompareModalOpened] = useState(false);
  const selectedCompareInstruments = instruments.filter(i => selectedCompareISINs.includes(i.isin));

  const streamLabel = streamProgress?.mode === 'discover' ? 'Discovering remaining UCITS ETFs' : streamProgress?.mode === 'oldest' ? 'Refreshing oldest profiles first' : 'Refreshing missing profiles';
  const show = (column: InstrumentColumn) => visibleColumns.includes(column);
  const toggleColumn = (column: InstrumentColumn) => setVisibleColumns(current => current.includes(column) ? current.filter(item => item !== column) : [...current, column]);
  const searchColumns: DataColumn<Instrument>[] = [
    { key: 'select', render: item => <Checkbox aria-label={`Select ${item.name}`} checked={selected.includes(item.isin)} onChange={event => setSelected(current => event.currentTarget.checked ? [...current, item.isin] : current.filter(isin => isin !== item.isin))} /> },
    { key: 'instrument', label: 'Product', render: item => <><Text fw={650}>{item.name}</Text><Group gap={5} mt={3}><Chip size="xs">{productLabel(item)}</Chip><Text size="xs" c="dimmed">{[item.ticker, item.isin, item.domicile].filter(Boolean).join(' · ')}</Text></Group></> },
    { key: 'policy', label: 'Policy', render: item => policyChip(item) },
    { key: 'replication', label: 'Replication', render: item => replicationLabel(item.replication) },
    { key: 'ter', label: 'TER', render: item => percent(item.ter_bps) },
    { key: 'size', label: 'Size', render: item => `${item.fund_size_million.toLocaleString()}m` },
    { key: 'actions', render: item => <TableActions><TableAction label={`Open ${item.isin} on justETF`} href={item.source_url} disabled={!item.source_url}>↗</TableAction></TableActions> },
  ];
  const catalogColumns: DataColumn<CatalogRow>[] = [
    {
      key: 'select_compare',
      render: (item: CatalogRow) => (
        <Checkbox
          aria-label={`Select ${item.instrument.isin} for comparison`}
          checked={selectedCompareISINs.includes(item.instrument.isin)}
          onChange={e => {
            const isin = item.instrument.isin;
            setSelectedCompareISINs(curr =>
              e.currentTarget.checked ? [...curr, isin] : curr.filter(i => i !== isin)
            );
          }}
        />
      ),
    },
    { key: 'starred', sortable: true, render: item => <TableAction label={item.instrument.starred ? `Unstar ${item.instrument.isin}` : `Star ${item.instrument.isin}`} color="yellow" variant={item.instrument.starred ? 'light' : 'subtle'} onClick={() => void star(item.instrument)}>{item.instrument.starred ? <IconStarFilled size={14} /> : <IconStar size={14} />}</TableAction> },
    ...(ranked.length > 0 ? [{ key: 'score', label: 'Score', sortable: true, render: (item: CatalogRow) => <Tooltip label={`Cost ${(item.cost * 100).toFixed(0)} · tracking diff ${(item.tracking_difference * 100).toFixed(0)} · tracking error ${(item.tracking_error * 100).toFixed(0)} · size ${(item.size * 100).toFixed(0)} · age ${(item.age * 100).toFixed(0)}`}><Chip size="lg" variant="filled" colorKey="Score">{item.total.toFixed(1)}</Chip></Tooltip> }] : []),
    ...(similarity ? [{
      key: 'similarity',
      label: 'Peer Group Analysis',
      sortable: true,
      render: (item: CatalogRow) => item.similarity ? (
        <Stack gap={4}>
          <Group gap={4}>
            {item.similarity.better && <Badge color="teal" size="xs" variant="filled">Strictly better</Badge>}
            <Badge color={item.similarity.match === 'exact_index' ? 'blue' : 'gray'} size="xs" variant="light">
              {item.similarity.match === 'exact_index' ? 'Same index' : 'Same exposure'}
            </Badge>
          </Group>
          <Stack gap={2} mt={2}>
            {item.similarity.reasons.map((reason, idx) => (
              <Text key={idx} size="xs" c={reason.startsWith('Saves') ? 'teal' : reason.startsWith('Higher TER') ? 'red' : 'dimmed'} fw={reason.startsWith('Saves') ? 600 : 400}>
                • {reason}
              </Text>
            ))}
          </Stack>
        </Stack>
      ) : '—',
    }] : []),
    { key: 'name', label: 'Instrument', sortable: true, render: item => <><Text fw={650}>{item.instrument.name}</Text><Chip size="xs" mt={3}>{productLabel(item.instrument)}</Chip></> },
    ...(show('ticker') ? [{ key: 'ticker', label: 'Ticker', sortable: true, render: (item: RankedInstrument) => <Text fw={650}>{item.instrument.ticker || '—'}</Text> }] : []),
    ...(show('isin') ? [{ key: 'isin', label: 'ISIN', sortable: true, render: (item: RankedInstrument) => <Text size="sm" ff="monospace">{item.instrument.isin}</Text> }] : []),
    ...(show('type') ? [{ key: 'type', label: 'Type', sortable: true, render: (item: RankedInstrument) => <Chip>{instrumentLabels[item.instrument.instrument_type]}</Chip> }] : []),
    ...(show('issuer') ? [{ key: 'issuer', label: 'Issuer', sortable: true, render: (item: RankedInstrument) => item.instrument.provider || '—' }] : []),
    ...(show('assetClass') ? [{ key: 'asset_class', label: 'Asset class', sortable: true, render: (item: RankedInstrument) => item.instrument.asset_class ? <Chip>{label(item.instrument.asset_class)}</Chip> : '—' }] : []),
    ...(show('exposure') ? [{ key: 'exposure', label: 'Exposure', sortable: true, render: (item: RankedInstrument) => <><Text size="sm">{item.instrument.index_name || item.instrument.investment_focus || 'Profile not refreshed'}</Text><Group gap={4} mt={4}><Chip size="xs">{item.instrument.data_status === 'enriched' ? 'Refreshed' : 'Awaiting refresh'}</Chip>{item.instrument.asset_class && <Chip size="xs">{label(item.instrument.asset_class)}</Chip>}{item.instrument.currency_hedged && <Chip size="xs">Hedged</Chip>}</Group></> }] : []),
    ...(show('policy') ? [{ key: 'policy', label: 'Policy', sortable: true, render: (item: RankedInstrument) => policyChip(item.instrument) }] : []),
    ...(show('replication') ? [{ key: 'replication', label: 'Replication', sortable: true, render: (item: RankedInstrument) => <Text size="sm">{replicationLabel(item.instrument.replication)}</Text> }] : []),
    ...(show('ter') ? [{ key: 'ter', label: 'TER', sortable: true, render: (item: RankedInstrument) => percent(item.instrument.ter_bps) }] : []),
    ...(show('size') ? [{ key: 'size', label: 'Size', sortable: true, render: (item: RankedInstrument) => `${item.instrument.fund_size_million.toLocaleString()}m` }] : []),
    ...(show('domicile') ? [{ key: 'domicile', label: 'Domicile', sortable: true, render: (item: RankedInstrument) => item.instrument.domicile || '—' }] : []),
    ...(show('currency') ? [{ key: 'currency', label: 'Currency', sortable: true, render: (item: RankedInstrument) => item.instrument.fund_currency || '—' }] : []),
    ...(show('inception') ? [{ key: 'inception', label: 'Inception', sortable: true, render: (item: RankedInstrument) => item.instrument.inception_date || '—' }] : []),
    ...(show('tracking') ? [{ key: 'tracking', label: 'Tracking', sortable: true, render: (item: RankedInstrument) => item.instrument.tracking_difference_bps === null && item.instrument.tracking_error_bps === null ? <Text c="dimmed">—</Text> : <Stack gap={1}><Text size="sm">Diff {item.instrument.tracking_difference_bps === null ? '—' : percent(item.instrument.tracking_difference_bps)}</Text><Text size="xs" c="dimmed">Error {item.instrument.tracking_error_bps === null ? '—' : percent(item.instrument.tracking_error_bps)}</Text></Stack> }] : []),
    ...(show('enriched') ? [{ key: 'enriched', label: 'Last refreshed', sortable: true, render: (item: RankedInstrument) => <Text size="sm" c={item.instrument.enriched_at ? undefined : 'dimmed'}>{item.instrument.enriched_at ? new Date(item.instrument.enriched_at).toLocaleString() : '—'}</Text> }] : []),
    { key: 'actions', render: item => <TableActions><TableAction label={`Open ${item.instrument.isin} on justETF`} href={item.instrument.source_url} disabled={!item.instrument.source_url}><IconExternalLink size={14} /></TableAction><TableAction label={item.instrument.ucits && item.instrument.instrument_type === 'etf' ? `Find alternatives for ${item.instrument.isin}` : 'Alternatives are limited to comparable UCITS ETFs'} disabled={item.instrument.instrument_type !== 'etf' || item.instrument.data_status !== 'enriched' || !item.instrument.ucits || item.instrument.asset_class === 'other'} onClick={() => showAlternatives(item.instrument)}><IconArrowsExchange size={14} /></TableAction><TableAction label={`Refresh ${item.instrument.isin}`} disabled={lookingUp} onClick={() => void lookup(item.instrument.isin)}><IconRefresh size={14} /></TableAction><TableAction label={`Edit ${item.instrument.isin}`} onClick={() => open(item.instrument)}><IconPencil size={14} /></TableAction><TableAction label={`Delete ${item.instrument.isin}`} color="red" onClick={() => void remove(item.instrument)}><IconTrash size={14} /></TableAction></TableActions> },
  ];
  const [, setProfileField] = useProfile();
  useEffect(() => {
    setProfileField({ instrument_columns_json: JSON.stringify(visibleColumns) });
  }, [visibleColumns]);
  useEffect(() => () => streamController?.abort(), [streamController]);
  useEffect(() => { setPage(1); }, [localQuery, filters, similarity, ranked, catalog.sort, catalog.direction, pageSize]);
  useEffect(() => {
    if (!similarity) { setAlternatives([]); setLoadingAlternatives(false); return; }
    if (!similarTo) { setAlternatives([]); setLoadingAlternatives(false); setError(`Similarity instrument ${similarity} is not in the local catalog`); return; }
    let active = true; setLoadingAlternatives(true);
    void api<InstrumentAlternative[]>(`/api/instruments/${similarTo.id}/alternatives`).then(result => { if (active) { setAlternatives(result ?? []); setError(''); } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (active) setLoadingAlternatives(false); });
    return () => { active = false; };
  }, [similarity, similarTo?.id]);
  const staleCount = instruments.filter(i => {
    if (i.data_status !== 'enriched' || !i.enriched_at) return false;
    const parsed = new Date(i.enriched_at).getTime();
    return Date.now() - parsed > 30 * 24 * 3600 * 1000;
  }).length;
  const enrichedDates = instruments.map(i => i.enriched_at).filter((d): d is string => Boolean(d)).sort();
  const oldestRefreshDate = enrichedDates.length > 0 ? new Date(enrichedDates[0]).toLocaleDateString() : 'None';

  const [catalogToolsOpen, setCatalogToolsOpen] = useState(false);

  return <Stack gap="lg"><Group justify="space-between"><Box><Title order={2}>Instrument finder</Title><Text c="dimmed">Store investments of any type locally. justETF lookup and comparison remain focused on exchange-traded products.</Text></Box><Group gap="sm"><Button variant="light" color="gray" onClick={() => setCatalogToolsOpen(v => !v)}>{catalogToolsOpen ? 'Hide Catalog Tools ▲' : 'Catalog Tools & Search ▼'}</Button><Button onClick={() => open()}>Add instrument</Button></Group></Group>
    {(error || catalog.sortError) && <Alert color="red">{error || catalog.sortError}</Alert>}{notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
    <Collapse expanded={catalogToolsOpen}>
      <Stack gap="md">
        <Paper className="metric" p="lg" radius="lg"><Group justify="space-between" align="end" wrap="wrap"><Box><Text fw={700}>Local catalog health</Text><Text size="sm" c="dimmed">{instruments.length.toLocaleString()} total · {refreshedCount.toLocaleString()} refreshed · {staleCount.toLocaleString()} stale (&gt;30d) · {nonUCITSCount.toLocaleString()} non-UCITS · Oldest refresh: {oldestRefreshDate}</Text></Box><Group wrap="wrap"><Button variant="light" loading={syncing} disabled={Boolean(streamController)} onClick={() => void syncCatalog()}>Sync catalog</Button><Button variant="light" disabled={Boolean(streamController)} onClick={() => void streamEnrichment('discover')}>Discover remaining UCITS</Button><Button variant="light" loading={enriching} disabled={Boolean(streamController) || refreshedCount === instruments.length} onClick={() => void enrichCatalog()}>Refresh next 20</Button><Button disabled={Boolean(streamController) || instruments.length === 0} onClick={() => void streamEnrichment(refreshedCount < instruments.length ? 'missing' : 'oldest')}>Refresh all</Button>{streamController && <Button color="red" variant="light" onClick={() => streamController.abort()}>Stop</Button>}</Group></Group><Text size="xs" c="dimmed" mt="xs">Bulk sync and discovery stay UCITS-only; exact ticker/ISIN loads may add non-UCITS instruments. Refresh is rate-limited; after missing profiles are complete, the next run starts from the oldest.</Text>
          {streamProgress && <Box mt="md"><Group justify="space-between" mb={5}><Text size="sm" fw={650}>{streamLabel}</Text><Text size="sm" c="dimmed">{streamProgress.phase === 'loading' ? 'Loading screener…' : `${streamProgress.processed.toLocaleString()} / ${streamProgress.total.toLocaleString()}`}</Text></Group><Progress value={streamProgress.total ? streamProgress.processed / streamProgress.total * 100 : 0} animated={!streamProgress.done} striped={!streamProgress.done} /><Text size="xs" c="dimmed" mt={5}>{streamProgress.current ? `Current ${streamProgress.current} · ` : ''}{streamProgress.enriched} refreshed · {streamProgress.skipped} non-UCITS skipped · {streamProgress.failed} failed</Text></Box>}
        </Paper>
        <Paper className="metric" p="lg" radius="lg"><Group align="end" wrap="wrap"><TextInput style={{ flex: 1 }} label="Find products on justETF" placeholder="VWCE, SGLD, an ISIN, MSCI World…" value={lookupQuery} onChange={event => setLookupQuery(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void search(); }} /><Button variant="light" loading={searching} onClick={() => void search()}>Search many</Button><Button loading={lookingUp} onClick={() => void lookup()}>Load exact</Button></Group><Text size="xs" c="dimmed" mt="xs">Search and exact load accept UCITS ETFs and non-UCITS ETCs/ETNs. Non-UCITS products are clearly marked and excluded from ETF ranking.</Text></Paper>
      </Stack>
    </Collapse>
    {searchResults.length > 0 && <DataTable rows={searchResults} columns={searchColumns} rowKey={item => item.isin} minWidth={850} toolbar={<Group justify="space-between" mb="sm"><Checkbox label={`Select all ${searchResults.length}`} checked={selected.length === searchResults.length} indeterminate={selected.length > 0 && selected.length < searchResults.length} onChange={event => setSelected(event.currentTarget.checked ? searchResults.map(item => item.isin) : [])} /><Button loading={importing} disabled={selected.length === 0} onClick={() => void importSelected()}>Import {selected.length} selected</Button></Group>} />}
    <Paper className="metric" p="lg" radius="lg"><SimpleGrid cols={{ base: 1, sm: 2, lg: 6 }}>
      <TextInput label="Index contains" placeholder="MSCI World" value={indexQuery} onChange={e => setIndexQuery(e.currentTarget.value)} />
      <Select label="Distribution" value={distribution} data={[{ value: '', label: 'Any' }, { value: 'accumulating', label: 'Accumulating' }, { value: 'distributing', label: 'Distributing' }]} onChange={value => setDistribution(value ?? '')} />
      <Select label="Replication" value={replication} data={[{ value: '', label: 'Any' }, { value: 'physical_full', label: 'Physical full' }, { value: 'physical_sampling', label: 'Physical sampling' }, { value: 'synthetic', label: 'Synthetic' }]} onChange={value => setReplication(value ?? '')} />
      <TextInput label="Domiciles" placeholder="IE, LU" value={domicile} onChange={e => setDomicile(e.currentTarget.value)} />
      <NumberInput label="Max TER (%)" placeholder="Any" min={0} decimalScale={2} value={maxTER} onChange={setMaxTER} />
      <NumberInput label="Min size (€m)" min={0} value={minSize} onChange={setMinSize} />
      <NumberInput label="Min age (years)" min={0} value={minAge} onChange={setMinAge} />
    </SimpleGrid><Button mt="md" onClick={() => void rank()}>Rank {rankableCount} refreshed UCITS ETFs</Button></Paper>
    {similarity && <Alert color="blue" title={similarTo ? `Similar to ${similarTo.ticker || similarTo.name}` : `Similarity filter: ${similarity}`} withCloseButton onClose={() => setSimilarityFilter()}>{loadingAlternatives ? 'Loading comparable instruments…' : `${alternatives.length} comparable instruments · remove this filter to return to the full catalog.`}</Alert>}
    {loadingAlternatives ? <Group justify="center" p="xl"><Loader /></Group> : rows.length === 0 ? <Empty title={similarity ? 'No comparable instruments' : 'No instrument data'} text={similarity ? 'Refresh more comparable profiles, then retry.' : 'Sync the justETF catalog, load one by ticker or ISIN, or add one manually.'} /> : <Stack gap="sm">
      {selectedCompareISINs.length > 0 && (
        <Paper p="sm" radius="lg" className="metric">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Badge color="teal" size="md" variant="filled">{selectedCompareISINs.length} Selected</Badge>
              <Text fw={600} size="sm">Select 2 to 5 instruments to compare side-by-side</Text>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                color="teal"
                disabled={selectedCompareISINs.length < 2 || selectedCompareISINs.length > 5}
                onClick={() => setCompareModalOpened(true)}
              >
                Compare {selectedCompareISINs.length} Selected Side-by-Side
              </Button>
              <Button size="xs" variant="default" onClick={() => setSelectedCompareISINs([])}>
                Clear Selection
              </Button>
            </Group>
          </Group>
        </Paper>
      )}
      <DataTable rows={visibleRows} columns={catalogColumns} rowKey={item => item.instrument.id} minWidth={950} sort={ranked.length > 0 || similarity ? localSortKey : catalog.sort} direction={ranked.length > 0 || similarity ? localSortDir : catalog.direction} onSort={(key, direction) => {
        if (ranked.length > 0 || similarity) {
          setLocalSortKey(key);
          setLocalSortDir(direction);
        } else {
          void catalog.sortRows(key, direction);
        }
      }} toolbar={<>
        <Group justify="space-between" mb="sm">
          <TextInput style={{ flex: 1, maxWidth: 440 }} placeholder="Search name, ticker, ISIN, issuer, index…" value={localQuery} onChange={event => setLocalQuery(event.currentTarget.value)} />
          <Group>
            <Text size="sm" c="dimmed">
              Showing {matchingRows.length ? bounds.start + 1 : 0}–{bounds.end} of {matchingRows.length}
              {matchingRows.some(r => r.instrument.ter_bps > 0)
                ? ` · Avg TER ${(matchingRows.filter(r => r.instrument.ter_bps > 0).reduce((sum, r) => sum + r.instrument.ter_bps, 0) / Math.max(1, matchingRows.filter(r => r.instrument.ter_bps > 0).length) / 100).toFixed(2)}%`
                : ''}
            </Text>
            <Button size="xs" variant="light" onClick={() => setFiltersOpen(filtersOpen ? '' : '1')}>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</Button>
            <Button size="xs" variant="light" onClick={() => setColumnsOpen(current => !current)}>Columns</Button>
          </Group>
        </Group>
        {filtersOpen && <Card withBorder padding="sm" mb="sm"><SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Select size="xs" searchable clearable label="Issuer" placeholder="All issuers" value={filters.issuer || null} data={issuerOptions} onChange={value => setFilters(current => ({ ...current, issuer: value === null ? '' : String(value) }))} />
          <Select size="xs" clearable label="Instrument type" placeholder="All types" value={filters.type || null} data={Object.entries(instrumentLabels).map(([value, itemLabel]) => ({ value, label: itemLabel }))} onChange={value => setFilters(current => ({ ...current, type: value ?? '' }))} />
          <Select size="xs" clearable label="Asset class" placeholder="All classes" value={filters.assetClass || null} data={[...new Set(instruments.flatMap(instrument => instrument.asset_class ? [instrument.asset_class] : []))].sort().map(value => ({ value, label: label(value) }))} onChange={value => setFilters(current => ({ ...current, assetClass: value === null ? '' : String(value) }))} />
          <Select size="xs" clearable label="Policy" placeholder="Any policy" value={filters.policy || null} data={[{ value: 'accumulating', label: 'Accumulating' }, { value: 'distributing', label: 'Distributing' }]} onChange={value => setFilters(current => ({ ...current, policy: value ?? '' }))} />
          <Select size="xs" clearable label="Replication" placeholder="Any method" value={filters.replication || null} data={[{ value: 'physical_full', label: 'Physical full' }, { value: 'physical_sampling', label: 'Physical sampling' }, { value: 'synthetic', label: 'Synthetic' }]} onChange={value => setFilters(current => ({ ...current, replication: value ?? '' }))} />
          <Select size="xs" searchable clearable label="Domicile" placeholder="All domiciles" value={filters.domicile || null} data={domicileOptions} onChange={value => setFilters(current => ({ ...current, domicile: value === null ? '' : String(value) }))} />
          <Select size="xs" searchable clearable label="Fund currency" placeholder="All currencies" value={filters.currency || null} data={currencyOptions} onChange={value => setFilters(current => ({ ...current, currency: value === null ? '' : String(value) }))} />
          <Select size="xs" clearable label="UCITS" placeholder="Any status" value={filters.ucits || null} data={[{ value: 'true', label: 'UCITS' }, { value: 'false', label: 'Non-UCITS' }]} onChange={value => setFilters(current => ({ ...current, ucits: value ?? '' }))} />
        </SimpleGrid>{activeFilterCount > 0 && <Button size="xs" variant="subtle" mt="xs" onClick={() => setFilters({ issuer: '', type: '', assetClass: '', policy: '', replication: '', domicile: '', currency: '', ucits: '' })}>Clear filters</Button>}</Card>}
        {columnsOpen && <Card withBorder padding="sm" mb="sm"><Group gap="lg">{instrumentColumns.map(column => <Checkbox key={column.value} label={column.label} checked={show(column.value)} onChange={() => toggleColumn(column.value)} />)}</Group></Card>}
      </>} />
      <Group justify="space-between"><Group gap="xs"><Text size="sm" c="dimmed">Rows per page</Text><Select size="xs" w={82} aria-label="Rows per page" value={String(pageSize)} data={['10', '25', '50', '100']} onChange={value => setPageSize(Number(value ?? 50))} /></Group>{bounds.pages > 1 && <Pagination size="sm" total={bounds.pages} value={bounds.current} onChange={setPage} />}</Group>
    </Stack>}
    <InstrumentModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} instrument={editing} saved={async () => { setOpened(false); setRanked([]); await reload(); }} />
    <CompareModal
      opened={compareModalOpened}
      onClose={() => setCompareModalOpened(false)}
      instruments={selectedCompareInstruments}
      onShowAlternatives={showAlternatives}
    />
    {confirmDeleteModal}
  </Stack>;
}

function InstrumentModal({ opened, close, instrument, saved }: { opened: boolean; close: () => void; instrument?: Instrument; saved: () => Promise<void> }) {
  const [form, setForm] = useState<InstrumentDraft>(() => instrument ? { ...instrument, ter: instrument.ter_bps / 100, size: instrument.fund_size_million, trackingDifference: instrument.tracking_difference_bps === null ? '' : instrument.tracking_difference_bps / 100, trackingError: instrument.tracking_error_bps === null ? '' : instrument.tracking_error_bps / 100 } : blankInstrument());
  const [error, setError] = useState('');
  const save = async () => { try { await api('/api/instruments', { method: 'POST', body: JSON.stringify({ isin: form.isin, name: form.name, ticker: form.ticker, instrument_type: form.instrument_type, provider: form.provider, index_name: form.index_name, investment_focus: form.investment_focus, asset_class: form.asset_class, strategy: form.strategy, currency_hedged: form.currency_hedged, data_status: 'enriched', distribution: form.distribution, replication: form.replication, domicile: form.domicile, fund_currency: form.fund_currency, ter_bps: bps(form.ter), fund_size_million: n(form.size), inception_date: form.inception_date, tracking_difference_bps: form.trackingDifference === '' ? null : bps(form.trackingDifference), tracking_error_bps: form.trackingError === '' ? null : bps(form.trackingError), ucits: form.ucits, source_url: form.source_url }) }); await saved(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const set = <K extends keyof InstrumentDraft>(key: K, value: InstrumentDraft[K]) => setForm(current => ({ ...current, [key]: value }));
  return <Modal opened={opened} onClose={close} title={instrument ? 'Edit instrument' : 'Add instrument'} size="xl"><Stack>{error && <Alert color="red">{error}</Alert>}<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
    <TextInput required label="ISIN" value={form.isin} onChange={e => set('isin', e.currentTarget.value.toUpperCase())} />
    <TextInput required label="Name" value={form.name} onChange={e => set('name', e.currentTarget.value)} />
    <TextInput label="Ticker" value={form.ticker} onChange={e => set('ticker', e.currentTarget.value)} />
    <Select label="Instrument type" value={form.instrument_type} data={Object.entries(instrumentLabels).map(([value, label]) => ({ value, label }))} onChange={value => set('instrument_type', (value ?? 'other') as InstrumentType)} />
    <TextInput label="Issuer" value={form.provider} onChange={e => set('provider', e.currentTarget.value)} />
    <TextInput label="Tracked index" value={form.index_name} onChange={e => set('index_name', e.currentTarget.value)} />
    <TextInput label="Investment focus" placeholder="Equity, World" value={form.investment_focus} onChange={e => set('investment_focus', e.currentTarget.value)} />
    <Select label="Asset class" value={form.asset_class} data={[{ value: '', label: 'Unknown' }, { value: 'equity', label: 'Equity' }, { value: 'bond', label: 'Bond' }, { value: 'commodity', label: 'Commodity' }, { value: 'monetary', label: 'Monetary' }, { value: 'real_estate', label: 'Real estate' }, { value: 'crypto', label: 'Crypto' }, { value: 'mixed', label: 'Mixed' }, { value: 'other', label: 'Other' }]} onChange={value => set('asset_class', value ?? '')} />
    <Select label="Strategy" value={form.strategy} data={[{ value: 'broad', label: 'Broad' }, { value: 'esg', label: 'ESG / screened' }, { value: 'dividend', label: 'Dividend' }, { value: 'factor', label: 'Factor' }]} onChange={value => set('strategy', value ?? 'broad')} />
    <TextInput label="Domicile" maxLength={2} value={form.domicile} onChange={e => set('domicile', e.currentTarget.value.toUpperCase())} />
    <Select label="Distribution" value={form.distribution} data={[{ value: 'accumulating', label: 'Accumulating' }, { value: 'distributing', label: 'Distributing' }]} onChange={value => set('distribution', (value ?? 'accumulating') as InstrumentDraft['distribution'])} />
    <Select label="Replication" value={form.replication} data={[{ value: 'physical_full', label: 'Physical full' }, { value: 'physical_sampling', label: 'Physical sampling' }, { value: 'synthetic', label: 'Synthetic' }]} onChange={value => set('replication', (value ?? 'physical_full') as InstrumentDraft['replication'])} />
    <TextInput label="Fund currency" maxLength={3} value={form.fund_currency} onChange={e => set('fund_currency', e.currentTarget.value.toUpperCase())} />
    <NumberInput label="TER (%)" min={0} decimalScale={3} value={form.ter} onChange={value => set('ter', value)} />
    <NumberInput label="Fund size (million)" min={0} value={form.size} onChange={value => set('size', value)} />
    <TextInput type="date" label="Inception date" value={form.inception_date} onChange={e => set('inception_date', e.currentTarget.value)} />
    <Checkbox label="UCITS compliant" checked={form.ucits} onChange={event => set('ucits', event.currentTarget.checked)} />
    <Checkbox label="Currency hedged" checked={form.currency_hedged} onChange={event => set('currency_hedged', event.currentTarget.checked)} />
    <NumberInput label="Tracking difference (%)" decimalScale={3} value={form.trackingDifference} onChange={value => set('trackingDifference', value)} />
    <NumberInput label="Tracking error (%)" min={0} decimalScale={3} value={form.trackingError} onChange={value => set('trackingError', value)} />
    <TextInput label="Source URL" type="url" value={form.source_url} onChange={e => set('source_url', e.currentTarget.value)} />
  </SimpleGrid><Text size="xs" c="dimmed">Instrument type describes the legal wrapper; asset class describes what it invests in. The ISIN is the stable key.</Text><Group justify="end"><Button onClick={() => void save()}>Save instrument</Button></Group></Stack></Modal>;
}
