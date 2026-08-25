import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconRefresh,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconFileCertificate,
  IconTrendingUp,
  IconShieldCheck,
  IconBuildingBank,
} from '@tabler/icons-react';

import { listBtps, refreshBtps, toggleStarBtp, type BtpBond } from '../api';
import { DataTable, type DataColumn } from '../DataTable';
import { SectionHeader } from '../components/SectionHeader';
import { ViewShell } from '../components/ViewShell';
import { Chip } from '../Chip';

const BOND_TYPE_OPTIONS = [
  { value: '', label: 'All Bond Types' },
  { value: 'Fixed', label: 'Fixed (BTP TF Vanilla)' },
  { value: 'ZeroCoupon', label: 'Zero Coupon (CTZ / Strip)' },
  { value: 'Valore', label: 'BTP Valore (Step-Up Retail)' },
  { value: 'Italia', label: 'BTP Italia (Inflation Retail)' },
  { value: 'Inflation', label: 'BTP€i (Institutional Inflation)' },
  { value: 'Floating', label: 'Floating (CCT / Variabile)' },
  { value: 'Futura', label: 'BTP Futura' },
];

function tierColor(tier: string): string {
  switch (tier) {
    case 'S':
      return 'teal';
    case 'A':
      return 'green';
    case 'B':
      return 'blue';
    case 'C':
      return 'yellow';
    case 'D':
      return 'orange';
    default:
      return 'red';
  }
}

export function BtpRankView() {
  const [btps, setBtps] = useState<BtpBond[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');

  // Filters & Sorting
  const [search, setSearch] = useState('');
  const [bondType, setBondType] = useState<string>('');
  const [viewTab, setViewTab] = useState<'all' | 'starred'>('all');
  const [targetYear, setTargetYear] = useState<number | string>('');

  const [sortKey, setSortKey] = useState<string>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchBtps = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const yearNum = typeof targetYear === 'number' ? targetYear : 0;
      let res = await listBtps({
        query: search,
        bondType: bondType || undefined,
        starredOnly: viewTab === 'starred',
        targetMaturityYear: yearNum,
      });

      if (res.btps.length === 0 && !search && !bondType && viewTab === 'all' && !yearNum) {
        console.log('[BtpRankView] Initial BTP cache empty; triggering auto-refresh...');
        await refreshBtps(0);
        res = await listBtps({});
      }

      setBtps(res.btps);
      setLastUpdated(res.lastUpdated);
    } catch (cause) {
      console.error('[BtpRankView] Error fetching BTPs:', cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [search, bondType, viewTab, targetYear]);

  useEffect(() => {
    void fetchBtps();
  }, [fetchBtps]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      const yearNum = typeof targetYear === 'number' ? targetYear : 0;
      console.log('[BtpRankView] Triggering manual refreshBtps (yearNum:', yearNum, ')');
      const result = await refreshBtps(yearNum);
      console.log('[BtpRankView] refreshBtps complete:', result);

      const res = await listBtps({
        query: search,
        bondType: bondType || undefined,
        starredOnly: viewTab === 'starred',
        targetMaturityYear: yearNum,
      });
      setBtps(res.btps);
      setLastUpdated(res.lastUpdated);
      if (res.btps.length === 0) {
        setError('No BTPs loaded. Server returned 0 items.');
      }
    } catch (cause) {
      console.error('[BtpRankView] Refresh error:', cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleStar = async (isin: string, currentStarred: boolean) => {
    try {
      const nextStarred = await toggleStarBtp(isin, !currentStarred);
      setBtps(prev =>
        prev.map(b => (b.isin === isin ? { ...b, is_starred: nextStarred } : b))
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const sortedBtps = useMemo(() => {
    return [...btps].sort((a, b) => {
      let aVal: any = a[sortKey as keyof BtpBond];
      let bVal: any = b[sortKey as keyof BtpBond];

      if (sortKey === 'bond') {
        aVal = a.name;
        bVal = b.name;
      } else if (sortKey === 'type') {
        aVal = a.bond_type;
        bVal = b.bond_type;
      } else if (sortKey === 'expiry') {
        aVal = a.maturity_years;
        bVal = b.maturity_years;
      } else if (sortKey === 'duration') {
        aVal = a.duration_mod;
        bVal = b.duration_mod;
      } else if (sortKey === 'total_return') {
        aVal = a.total_return_net;
        bVal = b.total_return_net;
      }

      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal as string);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const numA = Number(aVal || 0);
      const numB = Number(bVal || 0);
      return sortDir === 'asc' ? numA - numB : numB - numA;
    });
  }, [btps, sortKey, sortDir]);

  const starredCount = useMemo(
    () => btps.filter(b => b.is_starred).length,
    [btps]
  );

  const topYield = useMemo(() => {
    if (btps.length === 0) return 0;
    return Math.max(...btps.map(b => b.ytm_net));
  }, [btps]);

  const topScored = useMemo(() => {
    if (btps.length === 0) return null;
    return [...btps].sort((a, b) => b.score - a.score)[0];
  }, [btps]);

  const columns: DataColumn<BtpBond>[] = [
    {
      key: 'star',
      label: '',
      render: btp => (
        <Tooltip
          label={btp.is_starred ? 'Remove from starred' : 'Star this BTP'}
          withArrow
        >
          <ActionIcon
            variant="subtle"
            color={btp.is_starred ? 'yellow' : 'gray'}
            onClick={() => void handleToggleStar(btp.isin, btp.is_starred)}
          >
            {btp.is_starred ? (
              <IconStarFilled size={16} />
            ) : (
              <IconStar size={16} />
            )}
          </ActionIcon>
        </Tooltip>
      ),
    },
    {
      key: 'bond',
      label: 'Bond & ISIN',
      sortable: true,
      render: btp => (
        <Stack gap={2}>
          <Text fw={700} size="sm">
            {btp.name}
          </Text>
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed" ff="monospace">
              {btp.isin}
            </Text>
            {btp.is_starred && (
              <Badge size="xs" color="yellow" variant="light">
                Starred
              </Badge>
            )}
          </Group>
        </Stack>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      render: btp => <Chip>{btp.bond_type}</Chip>,
    },
    {
      key: 'price',
      label: 'Price',
      sortable: true,
      align: 'right',
      render: btp => (
        <Text fw={650}>€{btp.price > 0 ? btp.price.toFixed(2) : '—'}</Text>
      ),
    },
    {
      key: 'coupon',
      label: 'Coupon',
      sortable: true,
      align: 'right',
      render: btp => (
        <Text size="sm">{btp.coupon > 0 ? `${btp.coupon.toFixed(2)}%` : '0%'}</Text>
      ),
    },
    {
      key: 'expiry',
      label: 'Maturity',
      sortable: true,
      align: 'right',
      render: btp => (
        <Stack gap={1} align="flex-end">
          <Text size="sm" fw={600}>
            {btp.expiry_date}
          </Text>
          <Text size="xs" c="dimmed">
            {btp.maturity_years.toFixed(1)} yrs
          </Text>
        </Stack>
      ),
    },
    {
      key: 'duration',
      label: 'Mod. Duration',
      sortable: true,
      align: 'right',
      render: btp => (
        <Stack gap={1} align="flex-end">
          <Text size="sm">{btp.duration_mod.toFixed(2)}</Text>
          <Text size="xs" c="dimmed">
            {btp.rate_hike_impact.toFixed(1)}% / +1% rate
          </Text>
        </Stack>
      ),
    },
    {
      key: 'ytm_net',
      label: 'Net YTM',
      sortable: true,
      align: 'right',
      render: btp => (
        <Stack gap={1} align="flex-end">
          <Text fw={750} c="teal" size="sm">
            {btp.ytm_net.toFixed(2)}%
          </Text>
          <Text size="xs" c="dimmed">
            Gross {btp.ytm_gross.toFixed(2)}%
          </Text>
        </Stack>
      ),
    },
    {
      key: 'total_return',
      label: 'Total Net Return',
      sortable: true,
      align: 'right',
      render: btp => (
        <Text size="sm" fw={600}>
          {btp.total_return_net.toFixed(1)}%
        </Text>
      ),
    },
    {
      key: 'score',
      label: 'Score & Tier',
      sortable: true,
      align: 'right',
      render: btp => (
        <Group gap={6} justify="end" align="center">
          <Badge color={tierColor(btp.tier_rank)} variant="filled" size="md">
            Tier {btp.tier_rank}
          </Badge>
          <Text fw={800} size="sm">
            {btp.score.toFixed(1)}
          </Text>
        </Group>
      ),
    },
  ];

  return (
    <ViewShell error={error}>
      <SectionHeader
        title="BTP Rank"
        subtitle="Italian Government Bonds (BTP) yield curve analytics, duration risk, net return, and 6-factor composite scoring."
        badge={
          <Badge color="blue" variant="light" leftSection={<IconFileCertificate size={12} />}>
            BTP Analytics Plugin
          </Badge>
        }
        actions={
          <Button
            leftSection={<IconRefresh size={16} />}
            color="blue"
            loading={refreshing}
            onClick={() => void handleRefresh()}
          >
            Refresh BTPs
          </Button>
        }
      />

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card className="metric" p="md" radius="lg">
          <Group justify="space-between" align="start">
            <Box>
              <Text size="xs" c="dimmed">Total Tracked BTPs</Text>
              <Text size="xl" fw={800}>{btps.length}</Text>
            </Box>
            <IconBuildingBank size={24} color="var(--mantine-color-blue-6)" />
          </Group>
          {lastUpdated && (
            <Text size="xs" c="dimmed" mt={4}>Last scraped: {lastUpdated}</Text>
          )}
        </Card>

        <Card className="metric" p="md" radius="lg">
          <Group justify="space-between" align="start">
            <Box>
              <Text size="xs" c="dimmed">Top Net Yield (YTM)</Text>
              <Text size="xl" fw={800} c="teal">{topYield.toFixed(2)}%</Text>
            </Box>
            <IconTrendingUp size={24} color="var(--mantine-color-teal-6)" />
          </Group>
          <Text size="xs" c="dimmed" mt={4}>Italian Sovereign 12.5% Tax Rate</Text>
        </Card>

        <Card className="metric" p="md" radius="lg">
          <Group justify="space-between" align="start">
            <Box>
              <Text size="xs" c="dimmed">Top Rated BTP</Text>
              <Text size="md" fw={750} truncate style={{ maxWidth: 180 }}>
                {topScored ? topScored.name : '—'}
              </Text>
            </Box>
            {topScored && (
              <Badge color={tierColor(topScored.tier_rank)} size="lg" variant="filled">
                {topScored.tier_rank} · {topScored.score.toFixed(1)}
              </Badge>
            )}
          </Group>
          {topScored && (
            <Text size="xs" c="dimmed" mt={4}>Net YTM: {topScored.ytm_net.toFixed(2)}%</Text>
          )}
        </Card>
      </SimpleGrid>

      <Paper p="md" radius="lg" withBorder mt="sm">
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Group gap="sm" wrap="wrap" style={{ flex: 1 }}>
            <TextInput
              placeholder="Search by ISIN or Name..."
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              w={240}
            />
            <Select
              data={BOND_TYPE_OPTIONS}
              value={bondType}
              onChange={val => setBondType(val ?? '')}
              w={220}
              placeholder="Bond Type"
            />
            <NumberInput
              placeholder="Target Year (e.g. 2030)"
              value={targetYear}
              onChange={setTargetYear}
              min={2026}
              max={2075}
              w={180}
            />
          </Group>

          <SegmentedControl
            value={viewTab}
            onChange={val => setViewTab(val as 'all' | 'starred')}
            data={[
              { label: `All BTPs (${btps.length})`, value: 'all' },
              { label: `Starred (${starredCount})`, value: 'starred' },
            ]}
          />
        </Group>
      </Paper>

      <Box mt="md">
        <DataTable
          rows={sortedBtps}
          columns={columns}
          rowKey={b => b.isin}
          minWidth={1100}
          sort={sortKey}
          direction={sortDir}
          onSort={(key, dir) => {
            setSortKey(key);
            setSortDir(dir);
          }}
        />
      </Box>
    </ViewShell>
  );
}
