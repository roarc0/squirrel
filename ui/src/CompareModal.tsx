import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  Paper,
  Table,
  Badge,
  Divider,
} from '@mantine/core';
import { type Instrument } from './api';
import { Chip, ISINBadge, ReplicationChip, TickerBadge } from './Chip';

type Props = {
  opened: boolean;
  onClose: () => void;
  instruments: Instrument[];
  onShowAlternatives?: (instrument: Instrument) => void;
};

export function CompareModal({ opened, onClose, instruments, onShowAlternatives }: Props) {
  if (instruments.length === 0) return null;

  const percent = (valBps: number | null | undefined) =>
    valBps === undefined || valBps === null || !Number.isFinite(valBps)
      ? '—'
      : `${(valBps / 100).toFixed(2)}%`;

  // Determine best metrics (lowest TER, largest size, lowest tracking diff, lowest tracking error)
  const minTER = Math.min(...instruments.map(i => i.ter_bps ?? 9999));
  const maxSize = Math.max(...instruments.map(i => i.fund_size_million ?? 0));
  const validDiffs = instruments.map(i => i.tracking_difference_bps).filter((v): v is number => v !== null);
  const minDiff = validDiffs.length > 0 ? Math.min(...validDiffs) : null;
  const validErrors = instruments.map(i => i.tracking_error_bps).filter((v): v is number => v !== null);
  const minError = validErrors.length > 0 ? Math.min(...validErrors) : null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700} size="lg">Side-by-Side Instrument Comparison</Text>}
      size="calc(100vw - 80px)"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Comparing {instruments.length} selected exchange-traded instruments side-by-side. Best-in-class values are highlighted in green.
        </Text>

        <Paper withBorder radius="md" style={{ overflowX: 'auto' }}>
          <Table verticalSpacing="sm" horizontalSpacing="md" striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 180, minWidth: 160 }}>Metric</Table.Th>
                {instruments.map(inst => (
                  <Table.Th key={inst.id} style={{ minWidth: 240 }}>
                    <Stack gap={2}>
                      <Text fw={700} size="sm">{inst.name}</Text>
                      <Group gap={4} align="center">
                        {inst.ticker && <TickerBadge ticker={inst.ticker} />}
                        <ISINBadge isin={inst.isin} />
                      </Group>
                    </Stack>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td fw={600}>Total Expense Ratio (TER)</Table.Td>
                {instruments.map(inst => {
                  const isBest = inst.ter_bps > 0 && inst.ter_bps === minTER;
                  return (
                    <Table.Td key={inst.id}>
                      <Group gap="xs">
                        <Text fw={700} size="sm" c={isBest ? 'teal' : undefined}>
                          {percent(inst.ter_bps)}
                        </Text>
                        {isBest && <Badge color="teal" size="xs">Lowest TER</Badge>}
                      </Group>
                    </Table.Td>
                  );
                })}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Fund Size</Table.Td>
                {instruments.map(inst => {
                  const isBest = inst.fund_size_million > 0 && inst.fund_size_million === maxSize;
                  return (
                    <Table.Td key={inst.id}>
                      <Group gap="xs">
                        <Text fw={650} size="sm">
                          {inst.fund_size_million > 0 ? `€${inst.fund_size_million.toLocaleString()}m` : '—'}
                        </Text>
                        {isBest && <Badge color="teal" size="xs">Largest Fund</Badge>}
                      </Group>
                    </Table.Td>
                  );
                })}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Tracking Difference</Table.Td>
                {instruments.map(inst => {
                  const isBest = minDiff !== null && inst.tracking_difference_bps === minDiff;
                  return (
                    <Table.Td key={inst.id}>
                      <Group gap="xs">
                        <Text size="sm">{percent(inst.tracking_difference_bps)}</Text>
                        {isBest && <Badge color="teal" size="xs">Best Tracking</Badge>}
                      </Group>
                    </Table.Td>
                  );
                })}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Tracking Error</Table.Td>
                {instruments.map(inst => {
                  const isBest = minError !== null && inst.tracking_error_bps === minError;
                  return (
                    <Table.Td key={inst.id}>
                      <Group gap="xs">
                        <Text size="sm">{percent(inst.tracking_error_bps)}</Text>
                        {isBest && <Badge color="teal" size="xs">Lowest Error</Badge>}
                      </Group>
                    </Table.Td>
                  );
                })}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Asset Class & Exposure</Table.Td>
                {instruments.map(inst => (
                  <Table.Td key={inst.id}>
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>{inst.index_name || inst.investment_focus || '—'}</Text>
                      {inst.asset_class && <Chip size="xs">{inst.asset_class}</Chip>}
                    </Stack>
                  </Table.Td>
                ))}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Distribution Policy</Table.Td>
                {instruments.map(inst => (
                  <Table.Td key={inst.id}>
                    <Chip size="xs">{inst.distribution || '—'}</Chip>
                  </Table.Td>
                ))}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Replication Method</Table.Td>
                {instruments.map(inst => (
                  <Table.Td key={inst.id}>
                    <ReplicationChip value={inst.replication} />
                  </Table.Td>
                ))}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Domicile & Currency</Table.Td>
                {instruments.map(inst => (
                  <Table.Td key={inst.id}>
                    <Text size="sm">{[inst.domicile, inst.fund_currency].filter(Boolean).join(' · ') || '—'}</Text>
                  </Table.Td>
                ))}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Inception Date</Table.Td>
                {instruments.map(inst => (
                  <Table.Td key={inst.id}>
                    <Text size="sm">{inst.inception_date || '—'}</Text>
                  </Table.Td>
                ))}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Provider / Issuer</Table.Td>
                {instruments.map(inst => (
                  <Table.Td key={inst.id}>
                    <Text size="sm" fw={500}>{inst.provider || '—'}</Text>
                  </Table.Td>
                ))}
              </Table.Tr>

              <Table.Tr>
                <Table.Td fw={600}>Actions</Table.Td>
                {instruments.map(inst => (
                  <Table.Td key={inst.id}>
                    <Group gap="xs">
                      {inst.source_url && (
                        <Button
                          component="a"
                          href={inst.source_url}
                          target="_blank"
                          rel="noreferrer"
                          size="xs"
                          variant="light"
                        >
                          justETF ↗
                        </Button>
                      )}
                      {onShowAlternatives && inst.ucits && inst.instrument_type === 'etf' && (
                        <Button
                          size="xs"
                          variant="subtle"
                          color="blue"
                          onClick={() => {
                            onClose();
                            onShowAlternatives(inst);
                          }}
                        >
                          Find Peer Alternatives ≈
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                ))}
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Paper>

        <Divider />

        <Group justify="end">
          <Button variant="subtle" onClick={onClose}>
            Close Matrix
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
