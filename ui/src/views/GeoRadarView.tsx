import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Group, Loader, Paper, Progress, SegmentedControl, SimpleGrid, Slider, Stack, Table, Text } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconAlertTriangle, IconGlobe, IconWorldLatitude } from '@tabler/icons-react';

import { getGeoRadar, type GeoRadarResult } from '../api';
import { SectionHeader } from '../components/SectionHeader';
import { ViewShell } from '../components/ViewShell';
import { chipColor } from '../visual';

export function GeoRadarView() {
  const [data, setData] = useState<GeoRadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fxShiftPct, setFxShiftPct] = useState<number>(0);
  const [includeCash, setIncludeCash] = useState<boolean>(false);

  const load = useCallback(async (withCash: boolean) => {
    setError('');
    try {
      const res = await getGeoRadar(withCash);
      setData(res);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(includeCash); }, [load, includeCash]);

  const usdExposure = useMemo(() => {
    if (!data) return null;
    return data.currencies.find(c => c.currency === 'USD' && !c.is_hedged);
  }, [data]);

  const simulatedImpactMinor = useMemo(() => {
    if (!usdExposure) return 0;
    return (usdExposure.value_minor * fxShiftPct) / 100;
  }, [usdExposure, fxShiftPct]);

  return (
    <ViewShell error={error} onCloseError={() => setError('')}>
      <SectionHeader
        title="Geographic & Currency Risk Radar"
        subtitle="Look through your ETFs and holdings to see your real country breakdown, underlying currency exposure, and FX sensitivity."
        badge={
          <Badge color="blue" variant="light" leftSection={<IconWorldLatitude size={12} />}>
            {data ? `EUR/USD ${data.current_eur_usd_rate.toFixed(4)}` : 'Live FX Data'}
          </Badge>
        }
        actions={
          <SegmentedControl
            size="xs"
            value={includeCash ? 'cash' : 'investments'}
            onChange={v => setIncludeCash(v === 'cash')}
            data={[
              { label: 'Investments Only (Default)', value: 'investments' },
              { label: 'Include Cash Accounts', value: 'cash' },
            ]}
          />
        }
      />

      {loading ? (
        <Paper withBorder radius="lg" p="xl">
          <Group justify="center"><Loader size="sm" /><Text c="dimmed">Analyzing portfolio geographic & currency exposure…</Text></Group>
        </Paper>
      ) : !data ? (
        <Alert color="yellow">No portfolio data available for geographic analysis.</Alert>
      ) : (
        <Stack gap="xl">
          {/* Diagnostics Alerts */}
          {data.diagnostics.length > 0 && (
            <Stack gap="xs">
              {data.diagnostics.map(d => (
                <Alert key={d.id} color={d.severity === 'warning' ? 'orange' : 'blue'} title={d.title} icon={<IconAlertTriangle size={16} />}>
                  {d.message}
                </Alert>
              ))}
            </Stack>
          )}

          {/* Currency Exposure & FX Sensitivity Simulator */}
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Group gap="xs">
                    <IconGlobe size={20} color="var(--mantine-color-blue-6)" />
                    <Text fw={700} fz="lg">Underlying Currency Exposure</Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {includeCash ? 'Currency distribution across investments and cash accounts.' : 'Currency distribution across investments only (excluding cash).'}
                  </Text>
                </Stack>
                <Badge size="lg" color="blue" variant="light">
                  {data.currencies.length} Currencies
                </Badge>
              </Group>

              {/* Stacked Progress Bar */}
              <Progress.Root size="xl" radius="md">
                {data.currencies.map(c => (
                  <Progress.Section
                    key={`${c.currency}_${c.is_hedged}`}
                    value={c.percentage}
                    color={chipColor(c.currency || 'other')}
                  >
                    <Progress.Label>{c.currency} ({c.percentage.toFixed(0)}%)</Progress.Label>
                  </Progress.Section>
                ))}
              </Progress.Root>

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                {data.currencies.map(c => (
                  <Card key={`${c.currency}_${c.is_hedged}`} withBorder radius="md" p="md">
                    <Group justify="space-between" align="flex-start">
                      <Text fw={700} fz="md">{c.currency} {c.is_hedged && <Badge size="xs" color="teal">Hedged</Badge>}</Text>
                      <Badge color={chipColor(c.currency || 'other')} variant="light">{c.percentage.toFixed(1)}%</Badge>
                    </Group>
                    <Text fz="1.6rem" fw={800} mt="xs">€{(c.value_minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                    {c.fx_impact_5pct_minor > 0 && (
                      <Text size="xs" c="dimmed" mt={4}>
                        ±5% FX shift: €{(c.fx_impact_5pct_minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </Text>
                    )}
                  </Card>
                ))}
              </SimpleGrid>

              {/* FX Sensitivity Simulator */}
              {usdExposure && usdExposure.value_minor > 0 && (
                <Card withBorder radius="md" p="md" mt="xs">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <IconAdjustmentsHorizontal size={18} color="var(--mantine-color-blue-6)" />
                        <Text fw={700} size="sm">USD / EUR FX Sensitivity Simulator</Text>
                      </Group>
                      <Badge size="lg" color={simulatedImpactMinor > 0 ? 'teal' : simulatedImpactMinor < 0 ? 'red' : 'blue'} variant="light">
                        {simulatedImpactMinor >= 0 ? `+€${(simulatedImpactMinor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `-€${(Math.abs(simulatedImpactMinor) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} ({fxShiftPct > 0 ? `+${fxShiftPct}%` : `${fxShiftPct}%`})
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">Simulate how a shift in the US Dollar against Euro impacts your total wealth in Euros:</Text>
                    <Slider
                      color="blue"
                      value={fxShiftPct}
                      onChange={setFxShiftPct}
                      min={-15}
                      max={15}
                      step={1}
                      marks={[
                        { value: -10, label: '-10% USD' },
                        { value: -5, label: '-5%' },
                        { value: 0, label: 'Current' },
                        { value: 5, label: '+5%' },
                        { value: 10, label: '+10% USD' },
                      ]}
                      mb="sm"
                    />
                  </Stack>
                </Card>
              )}
            </Stack>
          </Paper>

          {/* Geographic Regional Breakdown */}
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Text fw={700} fz="lg">Regional Wealth Breakdown</Text>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                {data.regions.map(r => (
                  <Card key={r.region} withBorder radius="md" p="md">
                    <Group justify="space-between">
                      <Text fw={700}>{r.region}</Text>
                      <Badge color={chipColor(r.region || 'other')} variant="light">{r.percentage.toFixed(1)}%</Badge>
                    </Group>
                    <Text fz="1.6rem" fw={800} mt="xs">€{(r.value_minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                    <Progress value={r.percentage} color={chipColor(r.region || 'other')} size="xs" mt="sm" radius="xl" />
                  </Card>
                ))}
              </SimpleGrid>
            </Stack>
          </Paper>

          {/* Top Country Exposure Table */}
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={700} fz="lg">Top Country Exposures</Text>
                <Badge size="md" color="blue">{data.countries.length} Countries Mapped</Badge>
              </Group>
              <Table highlightOnHover layout="fixed">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Country</Table.Th>
                    <Table.Th>Region</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Portfolio Value</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Share (%)</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.countries.map(c => (
                    <Table.Tr key={c.country_code}>
                      <Table.Td>
                        <Group gap="xs">
                          <Badge color={chipColor(c.country_code || 'other')} size="sm" variant="filled">{c.country_code}</Badge>
                          <Text fw={600}>{c.country_name}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{c.region}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right', fontWeight: 700 }}>
                        €{(c.value_minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Group justify="flex-end" gap="xs">
                          <Text fw={700} size="sm">{c.percentage.toFixed(1)}%</Text>
                          <Progress value={c.percentage} color={chipColor(c.country_code || 'other')} size="xs" style={{ width: 60 }} radius="xl" />
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          </Paper>
        </Stack>
      )}
    </ViewShell>
  );
}
