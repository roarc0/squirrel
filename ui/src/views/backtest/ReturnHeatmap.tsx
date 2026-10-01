import { Table, Text, Tooltip } from '@mantine/core';
import type { BacktestPortfolio } from '../../pb/v1/backtest_pb';
import { pct } from './format';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ReturnHeatmap({ portfolio }: { portfolio: BacktestPortfolio }) {
  const rows = [...portfolio.years].reverse();
  const cell = (value?: number, partial = false, key?: number) => (
    <Table.Td key={key} style={{ padding: 3 }}>
      <Tooltip
        label={
          value === undefined
            ? 'No observations'
            : partial
              ? 'Partial period; excluded from monthly statistics'
              : 'Complete calendar-period return'
        }
      >
        <div
          style={{
            padding: '9px 4px',
            borderRadius: 4,
            textAlign: 'center',
            fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
            background:
              value === undefined
                ? 'var(--mantine-color-default-hover)'
                : `rgba(${value >= 0 ? '44,166,117' : '231,87,100'},${Math.min(0.5, 0.1 + Math.abs(value) * 3)})`,
          }}
        >
          {pct(value)}
          {partial && '*'}
        </div>
      </Tooltip>
    </Table.Td>
  );
  return (
    <>
      <Table.ScrollContainer minWidth={780}>
        <Table horizontalSpacing={4} verticalSpacing={3}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Year</Table.Th>
              {months.map((m) => (
                <Table.Th key={m} ta="center">
                  {m}
                </Table.Th>
              ))}
              <Table.Th ta="center">Year</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((y) => (
              <Table.Tr key={y.year}>
                <Table.Th>{y.year}</Table.Th>
                {months.map((_, i) => {
                  const m = portfolio.months.find((m) => m.year === y.year && m.month === i + 1);
                  return cell(m?.returnValue, m?.partial, i);
                })}
                {cell(y.returnValue, y.partial)}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed" mt="xs">
        * Partial month or year. Calendar returns use the preceding period-end value; deposits are excluded.
      </Text>
    </>
  );
}
