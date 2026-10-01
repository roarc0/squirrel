import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { Instrument } from '../../api';
import { colors } from './format';
import { sharedHistory } from './historyCoverage';
import { useHistoryCoverage } from './useHistoryCoverage';

export type AllocationRow = { isin: string; weight: number };

export function AllocationEditor({
  rows,
  instruments,
  onChange,
}: {
  rows: AllocationRow[];
  instruments: Instrument[];
  onChange: (rows: AllocationRow[]) => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const { coverage, retry } = useHistoryCoverage(rows.map((row) => row.isin));
  const active = rows.filter((row) => row.weight > 0).map((row) => row.isin);
  const range = sharedHistory(active, coverage);
  const name = (isin: string) => instruments.find((instrument) => instrument.isin === isin)?.name ?? isin;
  const failed = rows.some((row) => coverage[row.isin]?.error);
  return (
    <Stack gap="sm">
      <Select
        label="Add an instrument"
        placeholder="Search by name, ticker or ISIN"
        searchable
        clearable
        value={null}
        limit={30}
        data={instruments
          .filter((i) => !rows.some((r) => r.isin === i.isin))
          .map((i) => ({ value: i.isin, label: `${i.name} · ${i.isin}${i.ticker ? ` · ${i.ticker}` : ''}` }))}
        onChange={(isin) => {
          if (isin) onChange([...rows, { isin, weight: Math.max(0, 100 - total) }]);
        }}
      />
      <Table.ScrollContainer minWidth={740}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Instrument</Table.Th>
              <Table.Th w={240}>Available history</Table.Th>
              <Table.Th w={130}>Weight (%)</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, index) => (
              <Table.Tr
                key={row.isin}
                bg={range?.startLimiters.includes(row.isin) ? 'var(--mantine-color-yellow-light)' : undefined}
              >
                <Table.Td>
                  <Select
                    aria-label={`Replace ${row.isin}`}
                    searchable
                    limit={30}
                    value={row.isin}
                    data={[
                      ...instruments
                        .filter(
                          (instrument) =>
                            instrument.isin === row.isin || !rows.some((r) => r.isin === instrument.isin),
                        )
                        .map((instrument) => ({
                          value: instrument.isin,
                          label: `${instrument.name} · ${instrument.isin}${instrument.ticker ? ` · ${instrument.ticker}` : ''}`,
                        })),
                      ...(!instruments.some((instrument) => instrument.isin === row.isin)
                        ? [{ value: row.isin, label: row.isin }]
                        : []),
                    ]}
                    onChange={(isin) => {
                      if (isin) onChange(rows.map((r, i) => (i === index ? { ...r, isin } : r)));
                    }}
                  />
                </Table.Td>
                <Table.Td>
                  {!coverage[row.isin] ? (
                    <Text size="xs" c="dimmed" role="status">
                      Loading history…
                    </Text>
                  ) : coverage[row.isin].error ? (
                    <Text size="xs" c="red">
                      {coverage[row.isin].error}
                    </Text>
                  ) : (
                    <Stack gap={4}>
                      <Text size="xs">
                        {coverage[row.isin].start} → {coverage[row.isin].end}
                      </Text>
                      <Group gap={4}>
                        {range?.startLimiters.includes(row.isin) && (
                          <Badge size="xs" color="yellow">
                            Limits start
                          </Badge>
                        )}
                        {range?.differentEnds && range.endLimiters.includes(row.isin) && (
                          <Badge size="xs" color="orange">
                            Limits end
                          </Badge>
                        )}
                        {row.weight <= 0 && (
                          <Text size="xs" c="dimmed">
                            0% · excluded from range
                          </Text>
                        )}
                      </Group>
                    </Stack>
                  )}
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    aria-label={`Weight for ${row.isin}`}
                    value={row.weight}
                    min={0}
                    max={100}
                    decimalScale={2}
                    suffix="%"
                    size="xs"
                    onChange={(value) =>
                      onChange(rows.map((r, i) => (i === index ? { ...r, weight: Number(value) } : r)))
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Remove ${row.isin}`}
                    onClick={() => onChange(rows.filter((r) => r.isin !== row.isin))}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {range ? (
        <Alert
          color={range.years > 0 ? 'blue' : 'red'}
          title={
            range.years > 0
              ? `Maximum shared history · ${range.years.toFixed(2)} years`
              : 'No shared backtest period'
          }
        >
          <Text size="sm">
            {range.start} → {range.end}
          </Text>
          <Text size="xs">Start limited by {range.startLimiters.map(name).join(', ')}.</Text>
          {range.differentEnds && (
            <Text size="xs">End limited by {range.endLimiters.map(name).join(', ')}.</Text>
          )}
          <Text size="xs" c="dimmed" mt={4}>
            Based on available history for positive-weight instruments. Custom dates may shorten this range;
            daily completeness is checked when you run.
          </Text>
        </Alert>
      ) : (
        active.length > 0 && (
          <Text size="xs" c="dimmed">
            The maximum shared period will appear once all selected histories are available.
          </Text>
        )
      )}
      {failed && (
        <Button size="xs" variant="subtle" onClick={retry}>
          Retry unavailable histories
        </Button>
      )}
      <Text size="xs" c={total > 100 ? 'red' : 'dimmed'}>
        {total.toFixed(2)}% allocated · {Math.max(0, 100 - total).toFixed(2)}% retained as cash
      </Text>
    </Stack>
  );
}

export function AllocationSummary({ rows }: { rows: { isin: string; name: string; weight: number }[] }) {
  let offset = 0;
  const slices = rows.map((row, i) => {
    const from = offset;
    offset += row.weight;
    return `${colors[i % colors.length]} ${from}% ${offset}%`;
  });
  if (offset < 100) slices.push(`var(--mantine-color-gray-6) ${offset}% 100%`);
  return (
    <Group align="center" gap="xl" wrap="wrap">
      <Box
        w={148}
        h={148}
        style={{
          flexShrink: 0,
          borderRadius: '50%',
          background: `conic-gradient(${slices.join(', ')})`,
          display: 'grid',
          placeItems: 'center',
        }}
        role="img"
        aria-label="Portfolio allocation; weights listed alongside"
      >
        <Box
          w={106}
          h={106}
          bg="var(--mantine-color-body)"
          style={{ borderRadius: '50%', display: 'grid', placeItems: 'center' }}
        >
          <Text ta="center" size="sm" fw={700}>
            {rows.length}
            <br />
            <Text component="span" size="xs" c="dimmed">
              assets
            </Text>
          </Text>
        </Box>
      </Box>
      <Stack gap={5} style={{ flex: 1, minWidth: 200 }}>
        {rows.map((row, i) => (
          <Group
            key={row.isin}
            gap="xs"
            wrap="nowrap"
            p={6}
            bg="var(--mantine-color-default-hover)"
            style={{ borderRadius: 4 }}
          >
            <Box w={7} h={7} bg={colors[i % colors.length]} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text size="xs" style={{ flex: 1 }}>
              {row.name}
            </Text>
            <Text size="xs" fw={700}>
              {row.weight.toFixed(1)}%
            </Text>
          </Group>
        ))}
        {offset < 99.999 && (
          <Group justify="space-between" p={6}>
            <Text size="xs" c="dimmed">
              Cash · 0% interest
            </Text>
            <Text size="xs">{(100 - offset).toFixed(1)}%</Text>
          </Group>
        )}
      </Stack>
    </Group>
  );
}
