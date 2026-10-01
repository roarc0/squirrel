import { useState } from 'react';
import {
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
import { IconCheck, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import type { Instrument } from '../../api';
import { colors, eur } from './format';
import { sharedHistory } from './historyCoverage';
import { useHistoryCoverage } from './useHistoryCoverage';
import { portfolioShares, pacWeight, type DraftPlan, type AllocationRow } from './draft';
import { ISINBadge, TickerBadge } from '../../components/Chip';
import { TableAction, TableActions } from '../../components/DataTable';

function InlineWeight({
  weight,
  share,
  label,
  onChange,
}: {
  weight: number;
  share: number;
  label: string;
  onChange: (weight: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>(0);
  const displayed = Number((weight * share).toFixed(2));
  const save = () => {
    if (Number(value) !== displayed) onChange(pacWeight(Number(value), share));
    setEditing(false);
  };
  return (
    <Group gap={4} wrap="nowrap" justify="end">
      {editing ? (
        <>
          <NumberInput
            aria-label={label}
            size="xs"
            w={90}
            min={0}
            max={share * 100}
            decimalScale={2}
            suffix="%"
            hideControls
            autoFocus
            value={value}
            onChange={setValue}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') setEditing(false);
            }}
          />
          <TableAction label={`Apply ${label}`} color="teal" onClick={save}>
            <IconCheck size={12} />
          </TableAction>
          <TableAction label={`Cancel ${label}`} color="gray" onClick={() => setEditing(false)}>
            <IconX size={12} />
          </TableAction>
        </>
      ) : (
        <>
          <Badge color="teal" size="sm" variant="light">{displayed.toFixed(2)}%</Badge>
          <TableAction
            label={`Edit ${label}`}
            color="gray"
            variant="subtle"
            disabled={share === 0}
            onClick={() => {
              setValue(displayed);
              setEditing(true);
            }}
          >
            <IconPencil size={12} />
          </TableAction>
        </>
      )}
    </Group>
  );
}

export function AllocationEditor({
  plans,
  instruments,
  onChange,
}: {
  plans: DraftPlan[];
  instruments: Instrument[];
  onChange: (plans: DraftPlan[]) => void;
}) {
  const [editingInstrument, setEditingInstrument] = useState<string | null>(null);
  const shares = portfolioShares(plans);
  const allocated = plans.reduce(
    (sum, plan) => sum + (shares.get(plan.id) ?? 0) * plan.allocations.reduce((n, row) => n + row.weight, 0),
    0,
  );
  const monthlyAllocated = plans.reduce(
    (sum, plan) => sum + plan.monthly * plan.allocations.reduce((n, row) => n + row.weight, 0) / 100,
    0,
  );
  const [addTo, setAddTo] = useState<string | null>(null);
  const target = plans.find((plan) => plan.id === addTo) ?? plans[0];
  const rows = plans.flatMap((plan) => plan.allocations);
  const { coverage, retry } = useHistoryCoverage(rows.map((row) => row.isin));
  const active = [...new Set(rows.filter((row) => row.weight > 0).map((row) => row.isin))];
  const range = sharedHistory(active, coverage);
  const name = (isin: string) => instruments.find((instrument) => instrument.isin === isin)?.name ?? isin;
  const failed = rows.some((row) => coverage[row.isin]?.error);
  const setRows = (id: string, allocations: AllocationRow[]) =>
    onChange(plans.map((plan) => (plan.id === id ? { ...plan, allocations } : plan)));
  const options = (plan: DraftPlan, selected?: string) =>
    instruments
      .filter(
        (instrument) =>
          instrument.isin === selected || !plan.allocations.some((row) => row.isin === instrument.isin),
      )
      .map((instrument) => ({
        value: instrument.isin,
        label: `${instrument.name} · ${instrument.isin}${instrument.ticker ? ` · ${instrument.ticker}` : ''}`,
      }));
  return (
    <Stack gap="sm">
      <Group align="end">
        {plans.length > 1 && (
          <Select
            label="Add to PAC"
            value={target?.id ?? null}
            onChange={setAddTo}
            data={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
            w={190}
          />
        )}
        <Select
          label="Add an instrument"
          placeholder="Search by name, ticker or ISIN"
          searchable
          clearable
          value={null}
          limit={30}
          style={{ flex: 1 }}
          disabled={!target}
          data={target ? options(target) : []}
          onChange={(isin) => {
            if (isin && target)
              setRows(target.id, [
                ...target.allocations,
                {
                  isin,
                  weight: Math.max(0, 100 - target.allocations.reduce((sum, row) => sum + row.weight, 0)),
                },
              ]);
          }}
        />
      </Group>
      <Table.ScrollContainer minWidth={plans.length > 1 ? 900 : 740}>
        <Table tabularNums verticalSpacing="xs" horizontalSpacing="xs" highlightOnHover className="data-table compact">
          <Table.Thead>
            <Table.Tr>
              {plans.length > 1 && <Table.Th w={130}>PAC</Table.Th>}
              <Table.Th>Instrument</Table.Th>
              <Table.Th w={240}>Available history</Table.Th>
              <Table.Th w={180} style={{ textAlign: 'right' }}>Portfolio weight</Table.Th>
              <Table.Th w={110} style={{ textAlign: 'right' }}>Monthly</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {plans.flatMap((plan) =>
              plan.allocations.map((row, index) => (
                <Table.Tr
                  key={`${plan.id}:${row.isin}`}
                  bg={
                    row.weight > 0 && range?.startLimiters.includes(row.isin)
                      ? 'var(--mantine-color-yellow-light)'
                      : undefined
                  }
                >
                  {plans.length > 1 && (
                    <Table.Td>
                      <Text size="xs">{plan.name}</Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    {editingInstrument === `${plan.id}:${row.isin}` ? (
                      <Group gap={4} wrap="nowrap">
                        <Select
                          style={{ flex: 1 }}
                          autoFocus
                          size="xs"
                          onKeyDown={(event) => { if (event.key === 'Escape') setEditingInstrument(null); }}
                          aria-label={`Replace ${row.isin} in ${plan.name}`}
                          searchable
                          limit={30}
                          value={row.isin}
                          data={[
                            ...options(plan, row.isin),
                            ...(!instruments.some((instrument) => instrument.isin === row.isin)
                              ? [{ value: row.isin, label: row.isin }]
                              : []),
                          ]}
                          onChange={(isin) => {
                            if (isin) {
                              setRows(
                                plan.id,
                                plan.allocations.map((r, i) => (i === index ? { ...r, isin } : r)),
                              );
                              setEditingInstrument(null);
                            }
                          }}
                        />
                        <TableAction label="Cancel instrument replacement" color="gray" onClick={() => setEditingInstrument(null)}><IconX size={12} /></TableAction>
                      </Group>
                    ) : (
                      <Group gap="xs" wrap="nowrap" justify="space-between">
                        <Stack gap={2}>
                          <Text size="xs" fw={600} lh={1.3}>{name(row.isin)}</Text>
                          <Group gap={6}>
                            <TickerBadge ticker={instruments.find((instrument) => instrument.isin === row.isin)?.ticker} />
                            <ISINBadge isin={row.isin} />
                          </Group>
                        </Stack>
                        <TableAction label={`Replace ${row.isin} in ${plan.name}`} color="gray" variant="subtle"
                          onClick={() => setEditingInstrument(`${plan.id}:${row.isin}`)}><IconPencil size={12} /></TableAction>
                      </Group>
                    )}
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
                          {row.weight > 0 && range?.startLimiters.includes(row.isin) && (
                            <Badge size="xs" color="yellow">
                              Limits start
                            </Badge>
                          )}
                          {row.weight > 0 && range?.differentEnds && range.endLimiters.includes(row.isin) && (
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
                    <InlineWeight
                      key={`${plan.id}:${row.isin}:${shares.get(plan.id)}`}
                      label={`Portfolio weight for ${row.isin} in ${plan.name}`}
                      weight={row.weight}
                      share={shares.get(plan.id) ?? 0}
                      onChange={(weight) => setRows(plan.id, plan.allocations.map((r, i) => i === index ? { ...r, weight } : r))}
                    />
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="xs">{eur(plan.monthly * row.weight / 100)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <TableActions>
                      <TableAction label={`Remove ${row.isin} from ${plan.name}`} color="gray"
                        onClick={() => setRows(plan.id, plan.allocations.filter((_, i) => i !== index))}>
                        <IconTrash size={14} />
                      </TableAction>
                    </TableActions>
                  </Table.Td>
                </Table.Tr>
              )),
            )}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td colSpan={plans.length > 1 ? 3 : 2}>
                <Text size="xs" fw={600}>Total allocated{allocated < 100 - 0.005 ? ` · ${(100 - allocated).toFixed(2)}% cash` : ''}</Text>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={700} c={allocated > 100.005 ? 'red' : undefined}>{allocated.toFixed(2)}%</Text></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600}>{eur(monthlyAllocated)}</Text></Table.Td>
              <Table.Td />
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
      <Group align="start">
        {plans.map((plan) => {
          const total = plan.allocations.reduce((sum, row) => sum + row.weight, 0);
          return (
            <Stack key={plan.id} gap={4}>
              <NumberInput
                label={`${plan.name} · monthly (€)`}
                value={plan.monthly}
                min={0}
                max={1e10}
                decimalScale={2}
                onChange={(value) =>
                  onChange(plans.map((p) => (p.id === plan.id ? { ...p, monthly: Number(value) } : p)))
                }
              />
              <Text size="xs" c={total > 100 ? 'red' : 'dimmed'}>
                {total.toFixed(2)}% allocated · {Math.max(0, 100 - total).toFixed(2)}% cash
              </Text>
            </Stack>
          );
        })}
      </Group>
      {plans.length > 1 && (
        <Text size="xs" c="dimmed">
          Portfolio weights are scaled by each PAC’s monthly budget (equally when all budgets are zero).
          Editing a weight changes that PAC’s allocation; unallocated weight remains cash. Deposits and rebalancing stay separate.
        </Text>
      )}
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
            Based on positive-weight instruments. Custom dates may shorten this range; daily completeness is
            checked when you run.
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
