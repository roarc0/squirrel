import { useState } from 'react';
import { Group, Select, Table, Text, Tooltip } from '@mantine/core';
import type { RunBacktestResponse } from '../../pb/v1/backtest_pb';
import { ratio } from './format';

export function CorrelationMatrix({ result, assetIds }: { result: RunBacktestResponse; assetIds: string[] }) {
  const coverage = result.coverage.filter((c) => assetIds.includes(c.isin));
  const [years, setYears] = useState('0');
  const window = result.correlations.find((c) => c.years === Number(years));
  return (
    <>
      <Group justify="space-between" mb="sm">
        <Text size="sm" c="dimmed">
          Pearson correlation of aligned daily instrument returns · {window?.observations ?? 0} returns
        </Text>
        <Select
          aria-label="Correlation lookback"
          w={130}
          value={years}
          onChange={(v) => setYears(v ?? '0')}
          data={[
            { value: '0', label: 'Full period' },
            ...['1', '3', '5'].map((v) => ({ value: v, label: `${v} years` })),
          ]}
        />
      </Group>
      {!window?.observations ? (
        <Text size="sm" c="dimmed" py="xl" ta="center">
          Not enough history for this lookback. At least 30 daily returns are required.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={Math.max(500, coverage.length * 90 + 180)}>
          <Table withRowBorders={false} horizontalSpacing={3} verticalSpacing={3}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                <>
                  {coverage.map((c) => (
                    <Table.Th key={c.isin} ta="center">
                      <Tooltip label={c.name}>
                        <Text size="10px">{c.isin}</Text>
                      </Tooltip>
                    </Table.Th>
                  ))}
                </>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {coverage.map((a, i) => (
                <Table.Tr key={a.isin}>
                  <Table.Th w={180}>
                    <Text size="xs" lineClamp={2}>
                      {a.name}
                    </Text>
                  </Table.Th>
                  {coverage.map((b, j) => {
                    const pair = window.pairs.find(
                      (p) =>
                        (p.left === a.isin && p.right === b.isin) ||
                        (p.left === b.isin && p.right === a.isin),
                    );
                    const value = pair?.value;
                    return (
                      <Table.Td key={b.isin}>
                        {j > i ? null : (
                          <Tooltip
                            label={`${a.name} / ${b.name}${value === undefined ? ' · undefined for constant returns' : ''}`}
                            multiline
                            w={260}
                          >
                            <div
                              style={{
                                padding: '16px 6px',
                                textAlign: 'center',
                                borderRadius: 5,
                                fontWeight: 700,
                                background:
                                  value === undefined
                                    ? 'var(--mantine-color-default-hover)'
                                    : `rgba(${value > 0 ? '214,119,96' : '53,170,133'},${0.12 + Math.abs(value) * 0.45})`,
                              }}
                            >
                              {ratio(value)}
                            </div>
                          </Tooltip>
                        )}
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        −1 = opposite movements · 0 = no linear relationship · +1 = identical movements. Unchanged weekends
        are retained; this is a trailing-window correlation, not an average of rolling correlations.
      </Text>
    </>
  );
}
