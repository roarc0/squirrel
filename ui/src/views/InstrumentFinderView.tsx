import { useEffect, useMemo, useState } from 'react';
import { notifications } from '@mantine/notifications';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
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
  Tooltip,
} from '@mantine/core';
import {
  IconArrowsExchange,
  IconBan,
  IconCheck,
  IconColumns,
  IconDeviceFloppy,
  IconExternalLink,
  IconFilter,
  IconFolder,
  IconInfoCircle,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  api,
  instrumentClient,
  type Instrument,
  type InstrumentAlternative,
  type InstrumentType,
} from '../api';
import { Chip, ISINBadge, ReplicationChip, TickerBadge } from '../Chip';
import { CompareModal } from '../CompareModal';
import { Empty } from '../components/Empty';
import { DataTable, TableAction, TableActions, type DataColumn, type SortDirection } from '../DataTable';
import { confirmDelete as legacyConfirmDelete, instrumentLabels, label, percent, relativeDate } from '../utils/format';
import { pageBounds } from '../visual';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { useProfile, getProfile } from '../hooks/useProfile';
import { useQueryParamInt } from '../hooks/useQueryParam';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';
import { FacetFilterSelect, type FacetOption } from '../components/FacetFilterSelect';
import {
  builtInPresets,
  computeInstrumentScore,
  defaultFilters,
  isESG,
  loadCustomPresets,
  loadSavedFilters,
  matchesFilters,
  parseSearchTerms,
  saveCustomPresets,
  saveFilters,
  type FilterPreset,
  type InstrumentFilters,
} from '../utils/rankFilters';

type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

type InstrumentDraft = Omit<Instrument, 'id' | 'ter_bps' | 'fund_size_million' | 'tracking_difference_bps' | 'tracking_error_bps'> & { ter: Numeric; size: Numeric; trackingDifference: Numeric; trackingError: Numeric };
const blankInstrument = (): InstrumentDraft => ({ isin: '', name: '', ticker: '', instrument_type: 'etf', provider: '', index_name: '', investment_focus: '', asset_class: '', strategy: 'broad', currency_hedged: false, starred: false, data_status: 'enriched', distribution: 'accumulating', replication: 'physical_full', domicile: 'IE', fund_currency: 'EUR', ter: 0.2, size: 0, inception_date: '', trackingDifference: '', trackingError: '', ucits: false, source_url: '' });

type InstrumentColumn = 'ticker' | 'isin' | 'type' | 'issuer' | 'assetClass' | 'esg' | 'exposure' | 'policy' | 'replication' | 'ter' | 'size' | 'domicile' | 'currency' | 'inception' | 'tracking' | 'enriched' | 'score';
type EnrichmentMode = 'missing' | 'discover' | 'oldest';
type EnrichmentProgress = { mode: EnrichmentMode; phase: string; current?: string; processed: number; total: number; available?: number; enriched: number; skipped: number; failed: number; done: boolean; error?: string };

const instrumentColumns: { value: InstrumentColumn; label: string }[] = [
  { value: 'ticker', label: 'Ticker' },
  { value: 'isin', label: 'ISIN' },
  { value: 'type', label: 'Type' },
  { value: 'issuer', label: 'Issuer' },
  { value: 'assetClass', label: 'Asset class' },
  { value: 'esg', label: 'ESG / SRI' },
  { value: 'exposure', label: 'Exposure' },
  { value: 'policy', label: 'Policy' },
  { value: 'replication', label: 'Replication' },
  { value: 'ter', label: 'TER' },
  { value: 'size', label: 'Size' },
  { value: 'domicile', label: 'Domicile' },
  { value: 'currency', label: 'Currency' },
  { value: 'inception', label: 'Inception' },
  { value: 'tracking', label: 'Tracking' },
  { value: 'enriched', label: 'Last refreshed' },
  { value: 'score', label: 'Score' },
];

const defaultInstrumentColumns: InstrumentColumn[] = [
  'ticker',
  'type',
  'assetClass',
  'esg',
  'policy',
  'replication',
  'ter',
  'size',
  'enriched',
  'score',
];

function savedInstrumentColumns(): InstrumentColumn[] {
  try {
    const raw = (typeof localStorage !== 'undefined' ? localStorage.getItem('squirrel.instrumentColumns.v7') : null) ||
                (typeof localStorage !== 'undefined' ? localStorage.getItem('squirrel.instrumentColumns.v6') : null) ||
                getProfile().instrument_columns_json;
    if (!raw) return defaultInstrumentColumns;
    const saved = JSON.parse(raw) as string[];
    const valid = saved.filter((value): value is InstrumentColumn => instrumentColumns.some(column => column.value === value));
    if (!valid.length) return defaultInstrumentColumns;
    if (!valid.includes('esg')) {
      const idx = valid.indexOf('assetClass');
      if (idx !== -1) valid.splice(idx + 1, 0, 'esg');
      else valid.push('esg');
    }
    return valid;
  } catch { return defaultInstrumentColumns; }
}

const replicationLabel = (value: Instrument['replication']) => ({ physical_full: 'Physical full', physical_sampling: 'Physical sampling', synthetic: 'Synthetic' })[value] || value;

type CatalogRow = {
  instrument: Instrument;
  score: number | null;
  similarity?: InstrumentAlternative;
};

export function InstrumentFinderView({ instruments, reload, onOpenDetail }: { instruments: Instrument[]; reload: () => Promise<void>; onOpenDetail?: (isin: string) => void }) {
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Instrument>();
  const [error, setError] = useState('');
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [searchResults, setSearchResults] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [notice, setNotice] = useState('');
  const [streamController, setStreamController] = useState<AbortController>();
  const [streamProgress, setStreamProgress] = useState<EnrichmentProgress>();

  const [visibleColumns, setVisibleColumns] = useState<InstrumentColumn[]>(savedInstrumentColumns);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Unified single filter state
  const [filters, setFilters] = useState<InstrumentFilters>(loadSavedFilters);
  const [customPresets, setCustomPresets] = useState<FilterPreset[]>(loadCustomPresets);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [savePresetOpened, setSavePresetOpened] = useState(false);
  const [managePresetsOpened, setManagePresetsOpened] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [starVersion, setStarVersion] = useState(0);

  const [similarity, setSimilarity] = useState(() => (new URLSearchParams(window.location.search).get('similarity') ?? '').toUpperCase());
  const [alternatives, setAlternatives] = useState<InstrumentAlternative[]>([]);
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);

  const [page, setPage] = useQueryParamInt('page', 1);
  const [pageSize, setPageSize] = useQueryParamInt('pageSize', 50);
  const [localSortKey, setLocalSortKey] = useState<string>('');
  const [localSortDir, setLocalSortDir] = useState<SortDirection>('asc');

  const updateFilter = <K extends keyof InstrumentFilters>(key: K, value: InstrumentFilters[K]) => {
    setFilters(curr => {
      const next = { ...curr, [key]: value };
      saveFilters(next);
      return next;
    });
    setPage(1);
  };

  const updateFiltersBatch = (patch: Partial<InstrumentFilters>) => {
    setFilters(curr => {
      const next = { ...curr, ...patch };
      saveFilters(next);
      return next;
    });
    setPage(1);
  };

  const allPresets = useMemo(() => [...builtInPresets, ...customPresets], [customPresets]);
  const activePreset = allPresets.find(p => p.id === activePresetId);
  const isPresetModified = activePreset ? JSON.stringify(activePreset.filters) !== JSON.stringify(filters) : false;

  const handleApplyPreset = (presetId: string | null) => {
    if (!presetId) {
      setActivePresetId('');
      return;
    }
    const found = allPresets.find(p => p.id === presetId);
    if (found) {
      setActivePresetId(found.id);
      setFilters(found.filters);
      saveFilters(found.filters);
      setPage(1);
      notifications.show({
        color: 'teal',
        title: 'Preset applied',
        message: `Applied "${found.name}" filter preset.`,
      });
    }
  };

  const handleUpdateActivePreset = () => {
    if (!activePreset || activePreset.builtIn) return;
    const updated = customPresets.map(p =>
      p.id === activePreset.id ? { ...p, filters: { ...filters } } : p
    );
    setCustomPresets(updated);
    saveCustomPresets(updated);
    notifications.show({
      color: 'teal',
      title: 'Preset updated',
      message: `Updated "${activePreset.name}" with current filter settings.`,
    });
  };

  const handleResetFilters = () => {
    setFilters(defaultFilters);
    saveFilters(defaultFilters);
    setActivePresetId('');
    setPage(1);
  };

  const handleSavePreset = (name: string) => {
    if (!name.trim()) return;
    const trimmed = name.trim();
    const existing = customPresets.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
    const newPreset: FilterPreset = {
      id: existing ? existing.id : `custom-${Date.now()}`,
      name: trimmed,
      builtIn: false,
      filters: { ...filters },
    };
    const updated = [...customPresets.filter(p => p.name.toLowerCase() !== trimmed.toLowerCase()), newPreset];
    setCustomPresets(updated);
    saveCustomPresets(updated);
    setActivePresetId(newPreset.id);
    notifications.show({
      color: 'teal',
      title: 'Preset saved',
      message: `Filter preset "${trimmed}" saved.`,
    });
  };

  const handleDeleteCustomPreset = (presetId: string) => {
    const target = customPresets.find(p => p.id === presetId);
    if (!target) return;
    const updated = customPresets.filter(p => p.id !== presetId);
    setCustomPresets(updated);
    saveCustomPresets(updated);
    if (activePresetId === presetId) {
      setActivePresetId('');
    }
    notifications.show({
      color: 'gray',
      title: 'Preset deleted',
      message: `Filter preset "${target.name}" removed.`,
    });
  };

  const setSimilarityFilter = (isin = '') => {
    const params = new URLSearchParams(window.location.search);
    if (isin) params.set('similarity', isin); else params.delete('similarity');
    window.history.pushState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
    setSimilarity(isin);
    setPage(1);
  };

  const lookup = async (query = lookupQuery) => {
    if (!query.trim()) return;
    setLookingUp(true);
    try {
      const inst = await api<Instrument>('/api/instruments/lookup', { method: 'POST', body: JSON.stringify({ query }) });
      setLookupQuery('');
      setError('');
      await reload();
      notifications.show({ color: 'teal', title: 'Profile refreshed', message: inst?.name ?? query });
    } catch (cause) {
      notifications.show({ color: 'red', title: 'Refresh failed', message: cause instanceof Error ? cause.message : String(cause) });
      setError('');
    } finally {
      setLookingUp(false);
    }
  };

  const search = async () => {
    if (!lookupQuery.trim()) return;
    setSearching(true);
    try {
      const result = await api<Instrument[]>(`/api/instruments/search?q=${encodeURIComponent(lookupQuery)}`);
      setSearchResults(result ?? []);
      setSelected((result ?? []).map(item => item.isin));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSearching(false);
    }
  };

  const importSelected = async () => {
    if (selected.length === 0) return;
    setImporting(true);
    try {
      await api<Instrument[]>('/api/instruments/import', { method: 'POST', body: JSON.stringify({ isins: selected }) });
      setSearchResults([]);
      setSelected([]);
      setLookupQuery('');
      setError('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  const syncCatalog = async () => {
    setSyncing(true);
    try {
      const result = await api<{ saved: number; available: number }>('/api/instruments/catalog/sync', { method: 'POST', body: JSON.stringify({ limit: 4000 }) });
      setNotice(`Saved ${result.saved.toLocaleString()} instruments from ${result.available.toLocaleString()} screener results.`);
      setError('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSyncing(false);
    }
  };

  const enrichCatalog = async () => {
    setEnriching(true);
    try {
      const result = await api<{ enriched: number; failed: number }>('/api/instruments/catalog/enrich', { method: 'POST', body: JSON.stringify({ limit: 20 }) });
      setNotice(`Refreshed ${result.enriched} product profiles${result.failed ? `; ${result.failed} failed and can be retried` : ''}.`);
      setError('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setEnriching(false);
    }
  };

  const streamEnrichment = async (mode: EnrichmentMode) => {
    const controller = new AbortController();
    setStreamController(controller);
    setStreamProgress({ mode, phase: 'loading', processed: 0, total: 0, enriched: 0, skipped: 0, failed: 0, done: false });
    setNotice('');
    setError('');
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
        if (latest.error) setError(latest.error);
      }
      if (latest) setNotice(`Finished: ${latest.enriched} refreshed, ${latest.skipped} skipped, ${latest.failed} failed.`);
      await reload();
    } catch (cause) {
      if (cause instanceof Error && (cause.name === 'AbortError' || cause.message.includes('canceled'))) {
        setNotice('Refresh stopped. Completed profiles were saved; the next run will resume from the remaining or oldest records.');
        await reload();
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
        await reload();
      }
    } finally {
      setStreamController(current => current === controller ? undefined : current);
    }
  };

  const showAlternatives = (instrument: Instrument) => setSimilarityFilter(instrument.isin);

  const star = async (instrument: Instrument) => {
    const nextStarred = !instrument.starred;
    const found = instruments.find(i => i.id === instrument.id);
    if (found) {
      found.starred = nextStarred;
    }
    setStarVersion(v => v + 1);

    try {
      await api(`/api/instruments/${encodeURIComponent(instrument.isin)}/star`, {
        method: 'PUT',
        body: JSON.stringify({ starred: nextStarred }),
      });
    } catch (cause) {
      if (found) {
        found.starred = !nextStarred;
      }
      setStarVersion(v => v + 1);
      notifications.show({
        color: 'red',
        title: 'Failed to update star',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const remove = (instrument: Instrument) => {
    confirmDelete('instrument', `${instrument.ticker || instrument.name} · ${instrument.isin}`, async () => {
      try {
        await api(`/api/instruments/${instrument.id}`, { method: 'DELETE' });
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, 'Remove its holdings first if this instrument is currently owned.');
  };

  const open = (instrument?: Instrument) => { setEditing(instrument); setOpened(true); };

  const refreshedCount = instruments.filter(instrument => instrument.data_status === 'enriched').length;
  const nonUCITSCount = instruments.filter(instrument => !instrument.ucits).length;
  const issuerOptions = useMemo(() => [...new Set(instruments.flatMap(instrument => instrument.provider ? [instrument.provider] : []))].sort(), [instruments]);
  const domicileOptions = useMemo(() => [...new Set(instruments.flatMap(instrument => instrument.domicile ? [instrument.domicile] : []))].sort(), [instruments]);
  const currencyOptions = useMemo(() => [...new Set(instruments.map(instrument => instrument.fund_currency).filter(Boolean))].sort(), [instruments]);
  const standardAssetClasses = ['equity', 'bond', 'commodity', 'real_estate', 'monetary', 'crypto', 'mixed', 'other'];
  const assetClassOptions: FacetOption[] = useMemo(() => Array.from(new Set([...standardAssetClasses, ...instruments.flatMap(instrument => instrument.asset_class ? [instrument.asset_class] : [])])).sort().map(value => ({ value, label: label(value) })), [instruments]);

  const replicationOptions: FacetOption[] = [
    { value: 'physical_full', label: 'Physical full' },
    { value: 'physical_sampling', label: 'Physical sampling' },
    { value: 'synthetic', label: 'Synthetic' },
  ];
  const distributionOptions: FacetOption[] = [
    { value: 'accumulating', label: 'Accumulating' },
    { value: 'distributing', label: 'Distributing' },
  ];
  const strategyOptions: FacetOption[] = [
    { value: 'broad', label: 'Broad / Core' },
    { value: 'esg', label: 'ESG / Screened' },
    { value: 'dividend', label: 'Dividend' },
    { value: 'factor', label: 'Factor' },
  ];

  const presetSelectOptions = [
    {
      group: 'Built-in Presets',
      items: builtInPresets.map(p => ({ value: p.id, label: p.name })),
    },
    ...(customPresets.length > 0 ? [{
      group: 'My Custom Presets',
      items: customPresets.map(p => ({ value: p.id, label: p.name })),
    }] : []),
  ];

  const similarTo = instruments.find(instrument => instrument.isin === similarity);

  const rows: CatalogRow[] = useMemo(() => {
    if (similarity) {
      return alternatives.map(item => ({
        instrument: item.instrument,
        score: computeInstrumentScore(item.instrument),
        similarity: item,
      }));
    }
    return instruments.map(instrument => ({
      instrument,
      score: computeInstrumentScore(instrument),
    }));
  }, [instruments, similarity, alternatives, starVersion]);

  const matchingRows = useMemo(() => {
    if (similarity) return rows;
    return rows.filter(({ instrument }) => matchesFilters(instrument, filters));
  }, [rows, similarity, filters]);

  const activeBadges: { key: string; label: string; color: string; onRemove: () => void }[] = [];
  const { includes: searchIncludes, excludes: searchExcludes } = parseSearchTerms(filters.query, filters.excludeQuery);
  if (searchIncludes.length > 0) {
    activeBadges.push({
      key: 'search-includes',
      label: `Search: "${searchIncludes.join(' ')}"`,
      color: 'blue',
      onRemove: () => {
        const negTerms = filters.query.trim().split(/\s+/).filter(t => (t.startsWith('-') || t.startsWith('!')) && t.length > 1);
        updateFilter('query', negTerms.join(' '));
      },
    });
  }
  if (searchExcludes.length > 0) {
    activeBadges.push({
      key: 'search-excludes',
      label: `Excl words: "${searchExcludes.join(', ')}"`,
      color: 'red',
      onRemove: () => {
        const posTerms = filters.query.trim().split(/\s+/).filter(t => !(t.startsWith('-') || t.startsWith('!')));
        updateFiltersBatch({
          query: posTerms.join(' '),
          excludeQuery: '',
        });
      },
    });
  }

  // Include & Exclude badges
  if (filters.assetClasses.length > 0) {
    activeBadges.push({
      key: 'assetClasses',
      label: `Asset: ${filters.assetClasses.map(label).join(', ')}`,
      color: 'teal',
      onRemove: () => updateFilter('assetClasses', []),
    });
  }
  if (filters.excludeAssetClasses.length > 0) {
    activeBadges.push({
      key: 'excludeAssetClasses',
      label: `Asset: Excl ${filters.excludeAssetClasses.map(label).join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeAssetClasses', []),
    });
  }

  if (filters.distributions.length > 0) {
    activeBadges.push({
      key: 'distributions',
      label: `Policy: ${filters.distributions.map(d => d === 'accumulating' ? 'Acc' : 'Dist').join(', ')}`,
      color: 'indigo',
      onRemove: () => updateFilter('distributions', []),
    });
  }
  if (filters.excludeDistributions.length > 0) {
    activeBadges.push({
      key: 'excludeDistributions',
      label: `Policy: Excl ${filters.excludeDistributions.map(d => d === 'accumulating' ? 'Acc' : 'Dist').join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeDistributions', []),
    });
  }

  if (filters.replications.length > 0) {
    activeBadges.push({
      key: 'replications',
      label: `Replication: ${filters.replications.map(r => r.replace('physical_', 'phys ')).join(', ')}`,
      color: 'cyan',
      onRemove: () => updateFilter('replications', []),
    });
  }
  if (filters.excludeReplications.length > 0) {
    activeBadges.push({
      key: 'excludeReplications',
      label: `Replication: Excl ${filters.excludeReplications.map(r => r.replace('physical_', 'phys ')).join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeReplications', []),
    });
  }

  if (filters.strategies.length > 0) {
    activeBadges.push({
      key: 'strategies',
      label: `Strategy: ${filters.strategies.map(label).join(', ')}`,
      color: 'violet',
      onRemove: () => updateFilter('strategies', []),
    });
  }
  if (filters.excludeStrategies.length > 0) {
    activeBadges.push({
      key: 'excludeStrategies',
      label: `Strategy: Excl ${filters.excludeStrategies.map(label).join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeStrategies', []),
    });
  }

  if (filters.domiciles.length > 0) {
    activeBadges.push({
      key: 'domiciles',
      label: `Domicile: ${filters.domiciles.join(', ')}`,
      color: 'gray',
      onRemove: () => updateFilter('domiciles', []),
    });
  }
  if (filters.excludeDomiciles.length > 0) {
    activeBadges.push({
      key: 'excludeDomiciles',
      label: `Domicile: Excl ${filters.excludeDomiciles.join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeDomiciles', []),
    });
  }

  if (filters.currencies.length > 0) {
    activeBadges.push({
      key: 'currencies',
      label: `Currency: ${filters.currencies.join(', ')}`,
      color: 'grape',
      onRemove: () => updateFilter('currencies', []),
    });
  }
  if (filters.excludeCurrencies.length > 0) {
    activeBadges.push({
      key: 'excludeCurrencies',
      label: `Currency: Excl ${filters.excludeCurrencies.join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeCurrencies', []),
    });
  }

  if (filters.issuers.length > 0) {
    activeBadges.push({
      key: 'issuers',
      label: `Issuer: ${filters.issuers.join(', ')}`,
      color: 'blue',
      onRemove: () => updateFilter('issuers', []),
    });
  }
  if (filters.excludeIssuers.length > 0) {
    activeBadges.push({
      key: 'excludeIssuers',
      label: `Issuer: Excl ${filters.excludeIssuers.join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeIssuers', []),
    });
  }

  if (filters.types.length > 0) {
    activeBadges.push({
      key: 'types',
      label: `Type: ${filters.types.map(t => instrumentLabels[t as InstrumentType] ?? t).join(', ')}`,
      color: 'grape',
      onRemove: () => updateFilter('types', []),
    });
  }
  if (filters.excludeTypes.length > 0) {
    activeBadges.push({
      key: 'excludeTypes',
      label: `Type: Excl ${filters.excludeTypes.map(t => instrumentLabels[t as InstrumentType] ?? t).join(', ')}`,
      color: 'red',
      onRemove: () => updateFilter('excludeTypes', []),
    });
  }

  if (filters.esg) {
    activeBadges.push({
      key: 'esg',
      label: filters.esg === 'esg' ? 'ESG / SRI only' : 'Exclude ESG',
      color: 'teal',
      onRemove: () => updateFilter('esg', ''),
    });
  }
  if (filters.ucits) {
    activeBadges.push({
      key: 'ucits',
      label: filters.ucits === 'true' ? 'UCITS only' : 'Non-UCITS only',
      color: 'green',
      onRemove: () => updateFilter('ucits', ''),
    });
  }
  if (filters.currencyHedged) {
    activeBadges.push({
      key: 'hedged',
      label: filters.currencyHedged === 'hedged' ? 'Hedged only' : 'Unhedged only',
      color: 'violet',
      onRemove: () => updateFilter('currencyHedged', ''),
    });
  }
  if (filters.maxTER !== '') {
    activeBadges.push({
      key: 'maxTER',
      label: `Max TER: ${filters.maxTER}%`,
      color: 'orange',
      onRemove: () => updateFilter('maxTER', ''),
    });
  }
  if (filters.minSize !== '') {
    activeBadges.push({
      key: 'minSize',
      label: `Min size: €${filters.minSize}m`,
      color: 'yellow',
      onRemove: () => updateFilter('minSize', ''),
    });
  }
  if (filters.minAge !== '') {
    activeBadges.push({
      key: 'minAge',
      label: `Min age: ${filters.minAge}y`,
      color: 'pink',
      onRemove: () => updateFilter('minAge', ''),
    });
  }
  if (filters.maxTrackingDiff !== '') {
    activeBadges.push({
      key: 'maxTrackingDiff',
      label: `Max TD: ${filters.maxTrackingDiff}%`,
      color: 'cyan',
      onRemove: () => updateFilter('maxTrackingDiff', ''),
    });
  }
  if (filters.maxTrackingError !== '') {
    activeBadges.push({
      key: 'maxTrackingError',
      label: `Max TE: ${filters.maxTrackingError}%`,
      color: 'teal',
      onRemove: () => updateFilter('maxTrackingError', ''),
    });
  }

  const activeFilterCount = activeBadges.length;

  const getRowSortValue = (row: CatalogRow, key: string): any => {
    const inst = row.instrument;
    switch (key) {
      case 'starred': return inst.starred ? 1 : 0;
      case 'score': return row.score ?? -999999;
      case 'similarity': return row.similarity?.better ? 2 : row.similarity?.match === 'exact_index' ? 1 : 0;
      case 'name': return (inst.name || '').toLowerCase();
      case 'ticker': return (inst.ticker || '').toLowerCase();
      case 'isin': return inst.isin || '';
      case 'type': return inst.instrument_type || '';
      case 'issuer': return (inst.provider || '').toLowerCase();
      case 'asset_class':
      case 'assetClass': return (inst.asset_class || '').toLowerCase();
      case 'esg': return isESG(inst) ? 1 : 0;
      case 'exposure': return (inst.index_name || inst.investment_focus || '').toLowerCase();
      case 'policy': return inst.distribution || '';
      case 'replication': return inst.replication || '';
      case 'ter': return inst.ter_bps;
      case 'size': return inst.fund_size_million;
      case 'domicile': return inst.domicile || '';
      case 'currency': return inst.fund_currency || '';
      case 'inception': return inst.inception_date || '';
      case 'tracking': return inst.tracking_difference_bps ?? 999999;
      case 'enriched': return inst.refreshed_at || '';
      default: return 0;
    }
  };

  const sortedRows = useMemo(() => {
    const list = [...matchingRows];
    if (localSortKey) {
      list.sort((a, b) => {
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
    } else {
      // Starred instruments automatically ordered at top when no column sort is selected
      list.sort((a, b) => (b.instrument.starred ? 1 : 0) - (a.instrument.starred ? 1 : 0));
    }
    return list;
  }, [matchingRows, localSortKey, localSortDir]);

  const bounds = pageBounds(sortedRows.length, page, pageSize);
  const visibleRows = sortedRows.slice(bounds.start, bounds.end);

  const avgTer = useMemo(() => {
    const withTer = matchingRows.filter(r => r.instrument.ter_bps > 0);
    if (!withTer.length) return 0;
    const sum = withTer.reduce((acc, r) => acc + r.instrument.ter_bps, 0);
    return sum / withTer.length / 100;
  }, [matchingRows]);

  const [selectedCompareISINs, setSelectedCompareISINs] = useState<string[]>([]);
  const [compareModalOpened, setCompareModalOpened] = useState(false);
  const selectedCompareInstruments = instruments.filter(i => selectedCompareISINs.includes(i.isin));

  const streamLabel = streamProgress?.mode === 'discover' ? 'Enriching missing profiles' : streamProgress?.mode === 'oldest' ? 'Refreshing oldest profiles first' : 'Refreshing missing profiles';
  const show = (column: InstrumentColumn) => visibleColumns.includes(column);
  const toggleColumn = (column: InstrumentColumn) => {
    setVisibleColumns(current => {
      const next = current.includes(column) ? current.filter(item => item !== column) : [...current, column];
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('squirrel.instrumentColumns.v7', JSON.stringify(next));
        }
      } catch {}
      return next;
    });
  };

  const searchColumns: DataColumn<Instrument>[] = [
    { key: 'select', render: item => <Checkbox aria-label={`Select ${item.name}`} checked={selected.includes(item.isin)} onChange={event => setSelected(current => event.currentTarget.checked ? [...current, item.isin] : current.filter(isin => isin !== item.isin))} /> },
    {
      key: 'instrument',
      label: 'Product',
      render: item => (
        <>
          <Text fw={650}>{item.name}</Text>
          <Group gap={5} mt={3}>
            {item.ticker ? <TickerBadge ticker={item.ticker} /> : null}
            <ISINBadge isin={item.isin} />
            {item.domicile ? <Text size="xs" c="dimmed">{item.domicile}</Text> : null}
          </Group>
        </>
      ),
    },
    { key: 'policy', label: 'Policy', render: item => <Chip>{item.distribution === 'accumulating' ? 'Acc' : 'Dist'}</Chip> },
    { key: 'replication', label: 'Replication', render: item => <ReplicationChip value={item.replication} size="xs" /> },
    { key: 'ter', label: 'TER', render: item => percent(item.ter_bps) },
    { key: 'size', label: 'Size', render: item => `${item.fund_size_million.toLocaleString()}m` },
    { key: 'actions', render: item => <TableActions><TableAction label={`Open ${item.isin} on justETF`} href={item.source_url} disabled={!item.source_url}><IconExternalLink size={14} /></TableAction></TableActions> },
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
    {
      key: 'name',
      label: 'Instrument',
      sortable: true,
      render: item => (
        <Text
          size="sm"
          fw={600}
          lh={1.3}
          style={onOpenDetail ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 } : undefined}
          onClick={onOpenDetail ? () => onOpenDetail(item.instrument.isin) : undefined}
        >
          {item.instrument.name}
        </Text>
      ),
    },
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
    ...(show('ticker') ? [{ key: 'ticker', label: 'Ticker', sortable: true, render: (item: CatalogRow) => <TickerBadge ticker={item.instrument.ticker} /> }] : []),
    ...(show('isin') ? [{ key: 'isin', label: 'ISIN', sortable: true, render: (item: CatalogRow) => <ISINBadge isin={item.instrument.isin} /> }] : []),
    ...(show('type') ? [{ key: 'type', label: 'Type', sortable: true, render: (item: CatalogRow) => <Chip>{instrumentLabels[item.instrument.instrument_type]}</Chip> }] : []),
    ...(show('issuer') ? [{ key: 'issuer', label: 'Issuer', sortable: true, render: (item: CatalogRow) => item.instrument.provider || '—' }] : []),
    ...(show('assetClass') ? [{
      key: 'asset_class',
      label: 'Asset class',
      sortable: true,
      render: (item: CatalogRow) => {
        const val = item.instrument.asset_class;
        if (!val) return <Text c="dimmed">—</Text>;
        return <Chip colorKey={val}>{label(val)}</Chip>;
      },
    }] : []),
    ...(show('esg') ? [{
      key: 'esg',
      label: 'ESG',
      sortable: true,
      render: (item: CatalogRow) => isESG(item.instrument) ? (
        <Badge size="xs" variant="light" color="teal">ESG</Badge>
      ) : (
        <Text c="dimmed" size="xs">—</Text>
      ),
    }] : []),
    ...(show('exposure') ? [{
      key: 'exposure',
      label: 'Exposure',
      sortable: true,
      render: (item: CatalogRow) => (
        <>
          <Text size="sm">{item.instrument.index_name || item.instrument.investment_focus || (item.instrument.data_status === 'enriched' ? 'Exposure details unavailable' : 'Profile not refreshed')}</Text>
          <Group gap={4} mt={4}>
            <Chip size="xs">{item.instrument.data_status === 'enriched' ? 'Refreshed' : 'Awaiting refresh'}</Chip>
            {item.instrument.currency_hedged && <Chip size="xs">Hedged</Chip>}
          </Group>
        </>
      ),
    }] : []),
    ...(show('policy') ? [{
      key: 'policy',
      label: 'Policy',
      sortable: true,
      render: (item: CatalogRow) => {
        const val = item.instrument.distribution;
        if (!val) return <Text c="dimmed">—</Text>;
        return <Chip>{val === 'accumulating' ? 'Acc' : 'Dist'}</Chip>;
      },
    }] : []),
    ...(show('replication') ? [{
      key: 'replication',
      label: 'Replication',
      sortable: true,
      render: (item: CatalogRow) => {
        const val = item.instrument.replication;
        if (!val) return <Text c="dimmed">—</Text>;
        return <ReplicationChip value={val} size="xs" />;
      },
    }] : []),
    ...(show('ter') ? [{ key: 'ter', label: 'TER', sortable: true, render: (item: CatalogRow) => percent(item.instrument.ter_bps) }] : []),
    ...(show('size') ? [{ key: 'size', label: 'Size', sortable: true, render: (item: CatalogRow) => `${item.instrument.fund_size_million.toLocaleString()}m` }] : []),
    ...(show('domicile') ? [{ key: 'domicile', label: 'Domicile', sortable: true, render: (item: CatalogRow) => item.instrument.domicile || '—' }] : []),
    ...(show('currency') ? [{ key: 'currency', label: 'Currency', sortable: true, render: (item: CatalogRow) => item.instrument.fund_currency || '—' }] : []),
    ...(show('inception') ? [{
      key: 'inception',
      label: 'Inception',
      sortable: true,
      render: (item: CatalogRow) => item.instrument.inception_date ? (
        <Tooltip label={`Inception: ${new Date(item.instrument.inception_date).toLocaleDateString(undefined, { dateStyle: 'long' })} (${item.instrument.inception_date})`} withArrow>
          <Text size="sm">{relativeDate(item.instrument.inception_date)}</Text>
        </Tooltip>
      ) : <Text c="dimmed">—</Text>,
    }] : []),
    ...(show('tracking') ? [{ key: 'tracking', label: 'Tracking', sortable: true, render: (item: CatalogRow) => item.instrument.tracking_difference_bps === null && item.instrument.tracking_error_bps === null ? <Text c="dimmed">—</Text> : <Stack gap={1}><Text size="sm">Diff {item.instrument.tracking_difference_bps === null ? '—' : percent(item.instrument.tracking_difference_bps)}</Text><Text size="xs" c="dimmed">Error {item.instrument.tracking_error_bps === null ? '—' : percent(item.instrument.tracking_error_bps)}</Text></Stack> }] : []),
    ...(show('enriched') ? [{
      key: 'enriched',
      label: 'Last refreshed',
      sortable: true,
      render: (item: CatalogRow) => item.instrument.data_status === 'enriched' && item.instrument.refreshed_at ? (
        <Tooltip label={`Refreshed: ${new Date(item.instrument.refreshed_at).toLocaleString()}`} withArrow>
          <Text size="sm">{relativeDate(item.instrument.refreshed_at)}</Text>
        </Tooltip>
      ) : <Text size="sm" c="dimmed">—</Text>,
    }] : []),
    ...(show('score') ? [{
      key: 'score',
      label: 'Score',
      sortable: true,
      render: (item: CatalogRow) => item.score !== null ? (
        <Tooltip label={`Composite ETF score: ${item.score.toFixed(1)} / 100 · based on cost, tracking diff, size, and age`}>
          <Chip size="sm" variant="filled" colorKey="Score">{item.score.toFixed(1)}</Chip>
        </Tooltip>
      ) : <Text c="dimmed" size="xs">—</Text>,
    }] : []),
    { key: 'actions', render: item => <TableActions><TableAction label={`Open ${item.instrument.isin} on justETF`} href={item.instrument.source_url} disabled={!item.instrument.source_url}><IconExternalLink size={14} /></TableAction><TableAction label={item.instrument.ucits && item.instrument.instrument_type === 'etf' ? `Find alternatives for ${item.instrument.isin}` : 'Alternatives are limited to comparable UCITS ETFs'} disabled={item.instrument.instrument_type !== 'etf' || item.instrument.data_status !== 'enriched' || !item.instrument.ucits || item.instrument.asset_class === 'other'} onClick={() => showAlternatives(item.instrument)}><IconArrowsExchange size={14} /></TableAction><TableAction label={`Refresh ${item.instrument.isin}`} disabled={lookingUp} onClick={() => void lookup(item.instrument.isin)}><IconRefresh size={14} /></TableAction><TableAction label={`Edit ${item.instrument.isin}`} onClick={() => open(item.instrument)}><IconPencil size={14} /></TableAction><TableAction label={`Delete ${item.instrument.isin}`} color="red" onClick={() => void remove(item.instrument)}><IconTrash size={14} /></TableAction></TableActions> },
  ];

  const [, setProfileField] = useProfile();
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('squirrel.instrumentColumns.v7', JSON.stringify(visibleColumns));
      }
    } catch {}
    setProfileField({ instrument_columns_json: JSON.stringify(visibleColumns) });
  }, [visibleColumns]);

  useEffect(() => () => streamController?.abort(), [streamController]);

  useEffect(() => {
    if (!similarity) { setAlternatives([]); setLoadingAlternatives(false); return; }
    if (!similarTo) { setAlternatives([]); setLoadingAlternatives(false); setError(`Similarity instrument ${similarity} is not in the local catalog`); return; }
    let active = true; setLoadingAlternatives(true);
    void api<InstrumentAlternative[]>(`/api/instruments/${similarTo.id}/alternatives`).then(result => { if (active) { setAlternatives(result ?? []); setError(''); } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (active) setLoadingAlternatives(false); });
    return () => { active = false; };
  }, [similarity, similarTo?.id]);

  const staleCount = instruments.filter(i => {
    if (i.data_status !== 'enriched' || !i.refreshed_at) return false;
    const parsed = new Date(i.refreshed_at).getTime();
    return Date.now() - parsed > 30 * 24 * 3600 * 1000;
  }).length;
  const enrichedDates = instruments.filter(i => i.data_status === 'enriched').map(i => i.refreshed_at).filter((d): d is string => Boolean(d)).sort();
  const oldestRefreshDate = enrichedDates.length > 0 ? new Date(enrichedDates[0]).toLocaleDateString() : 'None';

  const [catalogToolsOpen, setCatalogToolsOpen] = useState(false);

  return (
    <ViewShell error={error}>
      <SectionHeader
        title="Instrument finder"
        subtitle="Search and filter the catalog of ETFs, ETCs, and other instruments."
        actions={
          <Group gap="sm">
            <Button variant="light" color="gray" onClick={() => setCatalogToolsOpen(v => !v)}>
              {catalogToolsOpen ? 'Hide Catalog Tools ▲' : 'Catalog Tools & Search ▼'}
            </Button>
            <Button onClick={() => open()}>Add instrument</Button>
          </Group>
        }
      />
      {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}

      <Collapse expanded={catalogToolsOpen}>
        <Stack gap="md" mb="md">
          <Paper className="metric" p="lg" radius="lg">
            <Group justify="space-between" align="end" wrap="wrap">
              <Box>
                <Text fw={700}>Local catalog health</Text>
                <Text size="sm" c="dimmed">
                  {instruments.length.toLocaleString()} total · {refreshedCount.toLocaleString()} refreshed · {staleCount.toLocaleString()} stale (&gt;30d) · {nonUCITSCount.toLocaleString()} non-UCITS · Oldest refresh: {oldestRefreshDate}
                </Text>
              </Box>
              <Group wrap="wrap">
                <Button variant="light" loading={syncing} disabled={Boolean(streamController)} onClick={() => void syncCatalog()}>Sync catalog</Button>
                <Button variant="light" disabled={Boolean(streamController)} onClick={() => void streamEnrichment('discover')}>Enrich missing</Button>
                <Button variant="light" loading={enriching} disabled={Boolean(streamController) || refreshedCount === instruments.length} onClick={() => void enrichCatalog()}>Refresh next 20</Button>
                <Button disabled={Boolean(streamController) || instruments.length === 0} onClick={() => void streamEnrichment(refreshedCount < instruments.length ? 'missing' : 'oldest')}>Refresh all</Button>
                {streamController && <Button color="red" variant="light" onClick={() => streamController.abort()}>Stop</Button>}
              </Group>
            </Group>
            <Text size="xs" c="dimmed" mt="xs">Sync pulls ETFs, ETCs, and ETNs from justETF. Missing profiles are refreshed first, including non-UCITS products.</Text>
            {streamProgress && (
              <Box mt="md">
                <Group justify="space-between" mb={5}>
                  <Text size="sm" fw={650}>{streamLabel}</Text>
                  <Text size="sm" c="dimmed">{streamProgress.phase === 'loading' ? 'Loading screener…' : `${streamProgress.processed.toLocaleString()} / ${streamProgress.total.toLocaleString()}`}</Text>
                </Group>
                <Progress value={streamProgress.total ? streamProgress.processed / streamProgress.total * 100 : 0} animated={!streamProgress.done} striped={!streamProgress.done} />
                <Text size="xs" c="dimmed" mt={5}>{streamProgress.current ? `Current ${streamProgress.current} · ` : ''}{streamProgress.enriched} refreshed · {streamProgress.skipped} skipped · {streamProgress.failed} failed</Text>
              </Box>
            )}
          </Paper>
          <Paper className="metric" p="lg" radius="lg">
            <Group align="end" wrap="wrap">
              <TextInput style={{ flex: 1 }} label="Find products on justETF" placeholder="VWCE, SGLD, an ISIN, MSCI World…" value={lookupQuery} onChange={event => setLookupQuery(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void search(); }} />
              <Button variant="light" loading={searching} onClick={() => void search()}>Search many</Button>
              <Button loading={lookingUp} onClick={() => void lookup()}>Load exact</Button>
            </Group>
          </Paper>
        </Stack>
      </Collapse>

      {searchResults.length > 0 && (
        <DataTable
          rows={searchResults}
          columns={searchColumns}
          rowKey={item => item.isin}
          minWidth={850}
          toolbar={
            <Group justify="space-between" mb="sm">
              <Checkbox label={`Select all ${searchResults.length}`} checked={selected.length === searchResults.length} indeterminate={selected.length > 0 && selected.length < searchResults.length} onChange={event => setSelected(event.currentTarget.checked ? searchResults.map(item => item.isin) : [])} />
              <Button loading={importing} disabled={selected.length === 0} onClick={() => void importSelected()}>Import {selected.length} selected</Button>
            </Group>
          }
        />
      )}

      {similarity && (
        <Alert color="blue" title={similarTo ? `Similar to ${similarTo.ticker || similarTo.name}` : `Similarity filter: ${similarity}`} withCloseButton onClose={() => setSimilarityFilter()} mb="sm">
          {loadingAlternatives ? 'Loading comparable instruments…' : `${alternatives.length} comparable instruments · remove this filter to return to the full catalog.`}
        </Alert>
      )}

      {loadingAlternatives ? (
        <Group justify="center" p="xl"><Loader /></Group>
      ) : rows.length === 0 ? (
        <Empty title={similarity ? 'No comparable instruments' : 'No instrument data'} text={similarity ? 'Refresh more comparable profiles, then retry.' : 'Sync the justETF catalog, load one by ticker or ISIN, or add one manually.'} />
      ) : (
        <Stack gap="sm">
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

          <DataTable
            rows={visibleRows}
            columns={catalogColumns}
            rowKey={item => item.instrument.id}
            minWidth={950}
            sort={localSortKey}
            direction={localSortDir}
            onSort={(key, direction) => {
              setLocalSortKey(key);
              setLocalSortDir(direction);
            }}
            toolbar={
              <Stack gap="xs" mb="sm">
                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                  <Group gap="xs" style={{ flex: 1, minWidth: 260, maxWidth: 640 }}>
                    <TextInput
                      style={{ flex: 1, minWidth: 180 }}
                      size="xs"
                      placeholder="Search (e.g. 'msci -usa' to exclude)…"
                      value={filters.query}
                      onChange={e => updateFilter('query', e.currentTarget.value)}
                      leftSection={<IconSearch size={14} style={{ opacity: 0.6 }} />}
                      rightSection={filters.query ? (
                        <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => updateFilter('query', '')} aria-label="Clear search">
                          <IconX size={11} />
                        </ActionIcon>
                      ) : (
                        <Tooltip label='Tip: Type "-word" to exclude words, e.g. "msci -usa"' withArrow>
                          <Box style={{ cursor: 'help', display: 'flex', alignItems: 'center', opacity: 0.4 }}>
                            <IconInfoCircle size={12} />
                          </Box>
                        </Tooltip>
                      )}
                    />
                    <TextInput
                      style={{ width: 190 }}
                      size="xs"
                      placeholder="Exclude words (e.g. usa)…"
                      value={filters.excludeQuery || ''}
                      onChange={e => updateFilter('excludeQuery', e.currentTarget.value)}
                      leftSection={<IconBan size={13} color="var(--mantine-color-red-6)" />}
                      rightSection={filters.excludeQuery ? (
                        <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => updateFilter('excludeQuery', '')} aria-label="Clear excluded words">
                          <IconX size={11} />
                        </ActionIcon>
                      ) : null}
                    />
                  </Group>
                  <Group gap="xs" align="center" wrap="wrap">
                    <Select
                      size="xs"
                      w={180}
                      placeholder="Load preset…"
                      data={presetSelectOptions}
                      value={activePresetId || null}
                      onChange={handleApplyPreset}
                      clearable
                    />

                    {activePreset && !activePreset.builtIn && isPresetModified ? (
                      <Group gap={4}>
                        <Button
                          size="xs"
                          color="teal"
                          variant="filled"
                          leftSection={<IconDeviceFloppy size={14} />}
                          onClick={handleUpdateActivePreset}
                        >
                          Update preset
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => {
                            setPresetNameInput(`${activePreset.name} (Copy)`);
                            setSavePresetOpened(true);
                          }}
                        >
                          Save copy
                        </Button>
                      </Group>
                    ) : (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconDeviceFloppy size={14} />}
                        onClick={() => {
                          setPresetNameInput(activePreset ? `${activePreset.name} (Copy)` : '');
                          setSavePresetOpened(true);
                        }}
                      >
                        Save preset
                      </Button>
                    )}

                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      leftSection={<IconFolder size={14} />}
                      onClick={() => setManagePresetsOpened(true)}
                    >
                      Presets ({customPresets.length})
                    </Button>

                    <Button
                      size="xs"
                      variant={filtersOpen ? 'filled' : 'light'}
                      leftSection={<IconFilter size={14} />}
                      onClick={() => setFiltersOpen(v => !v)}
                    >
                      Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
                    </Button>
                    <Button
                      size="xs"
                      variant={columnsOpen ? 'filled' : 'light'}
                      leftSection={<IconColumns size={14} />}
                      onClick={() => setColumnsOpen(v => !v)}
                    >
                      Columns
                    </Button>
                    {activeFilterCount > 0 && (
                      <Button size="xs" variant="subtle" color="gray" onClick={handleResetFilters}>
                        Reset
                      </Button>
                    )}
                  </Group>
                </Group>

                {activeBadges.length > 0 && (
                  <Group gap="xs" align="center" wrap="wrap">
                    <Text size="xs" c="dimmed">Active filters:</Text>
                    {activeBadges.map(badge => (
                      <Badge
                        key={badge.key}
                        size="sm"
                        variant="light"
                        color={badge.color}
                        style={{ cursor: 'pointer' }}
                        rightSection="✕"
                        onClick={badge.onRemove}
                      >
                        {badge.label}
                      </Badge>
                    ))}
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={handleResetFilters}>
                      Clear all
                    </Button>
                  </Group>
                )}

                <Collapse expanded={filtersOpen}>
                  <Card withBorder padding="sm" radius="md">
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="xs" verticalSpacing="xs">
                      {/* Row 1: Core Classification */}
                      <FacetFilterSelect
                        label="Asset class"
                        placeholder="All classes"
                        options={assetClassOptions}
                        include={filters.assetClasses}
                        exclude={filters.excludeAssetClasses}
                        onChange={(inc, exc) => updateFiltersBatch({ assetClasses: inc, excludeAssetClasses: exc })}
                        searchable
                      />
                      <Select
                        size="xs"
                        label="ESG screening"
                        placeholder="Any"
                        clearable
                        data={[
                          { value: 'esg', label: 'ESG / SRI only' },
                          { value: 'non_esg', label: 'Exclude ESG (Traditional)' },
                        ]}
                        value={filters.esg || null}
                        onChange={val => updateFilter('esg', val ?? '')}
                      />
                      <FacetFilterSelect
                        label="Distribution policy"
                        placeholder="Any (Acc & Dist)"
                        options={distributionOptions}
                        include={filters.distributions}
                        exclude={filters.excludeDistributions}
                        onChange={(inc, exc) => updateFiltersBatch({ distributions: inc, excludeDistributions: exc })}
                      />
                      <FacetFilterSelect
                        label="Replication"
                        placeholder="Any method"
                        options={replicationOptions}
                        include={filters.replications}
                        exclude={filters.excludeReplications}
                        onChange={(inc, exc) => updateFiltersBatch({ replications: inc, excludeReplications: exc })}
                      />

                      {/* Row 2: Attributes & Focus */}
                      <FacetFilterSelect
                        label="Strategy"
                        placeholder="Any strategy"
                        options={strategyOptions}
                        include={filters.strategies}
                        exclude={filters.excludeStrategies}
                        onChange={(inc, exc) => updateFiltersBatch({ strategies: inc, excludeStrategies: exc })}
                      />
                      <FacetFilterSelect
                        label="Issuer / Provider"
                        placeholder="All issuers"
                        options={issuerOptions.map(i => ({ value: i, label: i }))}
                        include={filters.issuers}
                        exclude={filters.excludeIssuers}
                        onChange={(inc, exc) => updateFiltersBatch({ issuers: inc, excludeIssuers: exc })}
                        searchable
                      />
                      <FacetFilterSelect
                        label="Domicile"
                        placeholder="All domiciles"
                        options={domicileOptions.map(d => ({ value: d, label: d }))}
                        include={filters.domiciles}
                        exclude={filters.excludeDomiciles}
                        onChange={(inc, exc) => updateFiltersBatch({ domiciles: inc, excludeDomiciles: exc })}
                        searchable
                      />
                      <FacetFilterSelect
                        label="Fund currency"
                        placeholder="All currencies"
                        options={currencyOptions.map(c => ({ value: c, label: c }))}
                        include={filters.currencies}
                        exclude={filters.excludeCurrencies}
                        onChange={(inc, exc) => updateFiltersBatch({ currencies: inc, excludeCurrencies: exc })}
                        searchable
                      />

                      {/* Row 3: Structure, Regulation & Age */}
                      <Select
                        size="xs"
                        label="Currency hedged"
                        placeholder="Any"
                        clearable
                        data={[
                          { value: 'hedged', label: 'Hedged only' },
                          { value: 'unhedged', label: 'Unhedged only' },
                        ]}
                        value={filters.currencyHedged || null}
                        onChange={val => updateFilter('currencyHedged', val ?? '')}
                      />
                      <Select
                        size="xs"
                        label="UCITS status"
                        placeholder="Any status"
                        clearable
                        data={[
                          { value: 'true', label: 'UCITS only' },
                          { value: 'false', label: 'Non-UCITS only' },
                        ]}
                        value={filters.ucits || null}
                        onChange={val => updateFilter('ucits', val ?? '')}
                      />
                      <FacetFilterSelect
                        label="Instrument type"
                        placeholder="All types"
                        options={Object.entries(instrumentLabels).map(([val, itemLabel]) => ({ value: val, label: itemLabel }))}
                        include={filters.types}
                        exclude={filters.excludeTypes}
                        onChange={(inc, exc) => updateFiltersBatch({ types: inc, excludeTypes: exc })}
                      />
                      <NumberInput
                        size="xs"
                        label="Min age (years)"
                        placeholder="Any"
                        min={0}
                        step={1}
                        value={filters.minAge}
                        onChange={val => updateFilter('minAge', val)}
                      />

                      {/* Row 4: Performance, Size & Tracking */}
                      <NumberInput
                        size="xs"
                        label="Max TER (%)"
                        placeholder="Any"
                        min={0}
                        step={0.05}
                        decimalScale={2}
                        value={filters.maxTER}
                        onChange={val => updateFilter('maxTER', val)}
                      />
                      <NumberInput
                        size="xs"
                        label="Min size (€m)"
                        placeholder="Any"
                        min={0}
                        step={50}
                        value={filters.minSize}
                        onChange={val => updateFilter('minSize', val)}
                      />
                      <NumberInput
                        size="xs"
                        label="Max tracking diff (%)"
                        placeholder="Any"
                        min={0}
                        step={0.05}
                        decimalScale={2}
                        value={filters.maxTrackingDiff}
                        onChange={val => updateFilter('maxTrackingDiff', val)}
                      />
                      <NumberInput
                        size="xs"
                        label="Max tracking error (%)"
                        placeholder="Any"
                        min={0}
                        step={0.05}
                        decimalScale={2}
                        value={filters.maxTrackingError}
                        onChange={val => updateFilter('maxTrackingError', val)}
                      />
                    </SimpleGrid>
                  </Card>
                </Collapse>

                {columnsOpen && (
                  <Card withBorder padding="sm">
                    <Group gap="lg">
                      {instrumentColumns.map(column => (
                        <Checkbox
                          key={column.value}
                          label={column.label}
                          checked={show(column.value)}
                          onChange={() => toggleColumn(column.value)}
                        />
                      ))}
                    </Group>
                  </Card>
                )}

                <Group justify="space-between" align="center" mt={2}>
                  <Text size="xs" c="dimmed">
                    Showing {matchingRows.length ? bounds.start + 1 : 0}–{bounds.end} of {matchingRows.length} instruments
                    {avgTer > 0 ? ` · Avg TER ${avgTer.toFixed(2)}%` : ''}
                  </Text>
                  {activePreset && (
                    <Badge size="xs" variant="outline" color={isPresetModified ? 'yellow' : 'blue'}>
                      Preset: {activePreset.name} {isPresetModified ? '(modified)' : ''}
                    </Badge>
                  )}
                </Group>
              </Stack>
            }
          />

          <Group justify="space-between">
            <Group gap="xs">
              <Text size="sm" c="dimmed">Rows per page</Text>
              <Select size="xs" w={82} aria-label="Rows per page" value={String(pageSize)} data={['10', '25', '50', '100']} onChange={value => setPageSize(Number(value ?? 50))} />
            </Group>
            {bounds.pages > 1 && <Pagination size="sm" total={bounds.pages} value={bounds.current} onChange={setPage} />}
          </Group>
        </Stack>
      )}

      {/* Save Preset Modal */}
      <Modal
        opened={savePresetOpened}
        onClose={() => setSavePresetOpened(false)}
        title="Save Filter Preset"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="Preset name"
            placeholder="e.g. European Equity Core"
            value={presetNameInput}
            onChange={e => setPresetNameInput(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && presetNameInput.trim()) {
                handleSavePreset(presetNameInput);
                setSavePresetOpened(false);
              }
            }}
            autoFocus
          />
          <Text size="xs" c="dimmed">
            Saves current filter criteria ({matchingRows.length} matching instruments). Presets are saved locally and can be recalled anytime.
          </Text>
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setSavePresetOpened(false)}>Cancel</Button>
            <Button
              disabled={!presetNameInput.trim()}
              onClick={() => {
                handleSavePreset(presetNameInput);
                setSavePresetOpened(false);
              }}
            >
              Save preset
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Manage Presets Modal */}
      <Modal
        opened={managePresetsOpened}
        onClose={() => setManagePresetsOpened(false)}
        title="Manage Filter Presets"
        size="md"
      >
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            Presets save your screener filters for quick recall. You can load, overwrite with current filters, or delete presets here.
          </Text>

          {customPresets.length === 0 ? (
            <Paper withBorder p="md" radius="sm" ta="center">
              <Text size="sm" c="dimmed">No custom presets saved yet.</Text>
              <Text size="xs" c="dimmed" mt={4}>Apply your favorite filters and click "Save preset" to create one.</Text>
            </Paper>
          ) : (
            <Stack gap="xs">
              {customPresets.map(preset => {
                const isActive = activePresetId === preset.id;
                return (
                  <Paper key={preset.id} withBorder p="sm" radius="sm">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" align="center">
                          <Text fw={650} size="sm" truncate>{preset.name}</Text>
                          {isActive && <Badge size="xs" color="teal" variant="filled">Active</Badge>}
                        </Group>
                        <Group gap={4} mt={4} wrap="wrap">
                          {preset.filters.assetClasses.length > 0 && (
                            <Badge size="xs" variant="light" color="teal">{preset.filters.assetClasses.join(', ')}</Badge>
                          )}
                          {preset.filters.distributions.length > 0 && (
                            <Badge size="xs" variant="light" color="indigo">{preset.filters.distributions.join(', ')}</Badge>
                          )}
                          {preset.filters.excludeDistributions.length > 0 && (
                            <Badge size="xs" variant="light" color="red">Excl {preset.filters.excludeDistributions.join(', ')}</Badge>
                          )}
                          {preset.filters.maxTER !== '' && (
                            <Badge size="xs" variant="light" color="orange">TER ≤ {preset.filters.maxTER}%</Badge>
                          )}
                          {preset.filters.minSize !== '' && (
                            <Badge size="xs" variant="light" color="yellow">Size ≥ €{preset.filters.minSize}m</Badge>
                          )}
                        </Group>
                      </Box>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            handleApplyPreset(preset.id);
                            setManagePresetsOpened(false);
                          }}
                        >
                          Load
                        </Button>
                        <Tooltip label="Overwrite this preset with what is currently on screen">
                          <Button
                            size="xs"
                            variant="default"
                            onClick={() => {
                              const updated = customPresets.map(p =>
                                p.id === preset.id ? { ...p, filters: { ...filters } } : p
                              );
                              setCustomPresets(updated);
                              saveCustomPresets(updated);
                              setActivePresetId(preset.id);
                              notifications.show({
                                color: 'teal',
                                title: 'Preset updated',
                                message: `Overwrote "${preset.name}" with current filters.`,
                              });
                            }}
                          >
                            Overwrite
                          </Button>
                        </Tooltip>
                        <Tooltip label={`Delete preset "${preset.name}"`}>
                          <ActionIcon
                            size="sm"
                            color="red"
                            variant="subtle"
                            onClick={() => handleDeleteCustomPreset(preset.id)}
                            aria-label={`Delete ${preset.name}`}
                          >
                            <IconTrash size={15} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          )}

          <Divider my="xs" label="Built-in Presets" labelPosition="center" />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            {builtInPresets.map(preset => (
              <Paper key={preset.id} withBorder p="xs" radius="sm" style={{ opacity: 0.9 }}>
                <Group justify="space-between" align="center">
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text size="xs" fw={600} truncate>{preset.name}</Text>
                    <Text size="10px" c="dimmed">Built-in</Text>
                  </Box>
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => {
                      handleApplyPreset(preset.id);
                      setManagePresetsOpened(false);
                    }}
                  >
                    Load
                  </Button>
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
        </Stack>
      </Modal>

      <InstrumentModal key={editing?.id ?? 'new'} opened={opened} close={() => setOpened(false)} instrument={editing} saved={async () => { setOpened(false); await reload(); }} />
      <CompareModal
        opened={compareModalOpened}
        onClose={() => setCompareModalOpened(false)}
        instruments={selectedCompareInstruments}
        onShowAlternatives={showAlternatives}
      />
      {confirmDeleteModal}
    </ViewShell>
  );
}

function InstrumentModal({ opened, close, instrument, saved }: { opened: boolean; close: () => void; instrument?: Instrument; saved: () => Promise<void> }) {
  const [form, setForm] = useState<InstrumentDraft>(() => instrument ? { ...instrument, ter: instrument.ter_bps / 100, size: instrument.fund_size_million, trackingDifference: instrument.tracking_difference_bps === null ? '' : instrument.tracking_difference_bps / 100, trackingError: instrument.tracking_error_bps === null ? '' : instrument.tracking_error_bps / 100 } : blankInstrument());
  const [error, setError] = useState('');
  const save = async () => {
    try {
      await api('/api/instruments', {
        method: 'POST',
        body: JSON.stringify({
          isin: form.isin,
          name: form.name,
          ticker: form.ticker,
          instrument_type: form.instrument_type,
          provider: form.provider,
          index_name: form.index_name,
          investment_focus: form.investment_focus,
          asset_class: form.asset_class,
          strategy: form.strategy,
          currency_hedged: form.currency_hedged,
          data_status: 'enriched',
          distribution: form.distribution,
          replication: form.replication,
          domicile: form.domicile,
          fund_currency: form.fund_currency,
          ter_bps: bps(form.ter),
          fund_size_million: n(form.size),
          inception_date: form.inception_date,
          tracking_difference_bps: form.trackingDifference === '' ? null : bps(form.trackingDifference),
          tracking_error_bps: form.trackingError === '' ? null : bps(form.trackingError),
          ucits: form.ucits,
          source_url: form.source_url,
        }),
      });
      await saved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const set = <K extends keyof InstrumentDraft>(key: K, value: InstrumentDraft[K]) => setForm(current => ({ ...current, [key]: value }));
  return (
    <Modal opened={opened} onClose={close} title={instrument ? 'Edit instrument' : 'Add instrument'} size="xl">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
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
        </SimpleGrid>
        <Text size="xs" c="dimmed">Instrument type describes the legal wrapper; asset class describes what it invests in. The ISIN is the stable key.</Text>
        <Group justify="end">
          <Button onClick={() => void save()}>Save instrument</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
