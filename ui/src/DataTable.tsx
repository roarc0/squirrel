import type { CSSProperties, ReactNode } from 'react';
import { ActionIcon, Group, Paper, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';

export type SortDirection = 'asc' | 'desc';

export type DataColumn<T> = {
  key: string;
  label?: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
};

export function DataTable<T>({ rows, columns, rowKey, minWidth = 800, toolbar, sort, direction = 'asc', onSort, rowStyle, rowClassName }: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string | number;
  minWidth?: number;
  toolbar?: ReactNode;
  sort?: string;
  direction?: SortDirection;
  onSort?: (key: string, direction: SortDirection) => void;
  rowStyle?: (row: T) => CSSProperties | undefined;
  rowClassName?: (row: T) => string | undefined;
}) {
  return (
    <Paper className="data-table-card" radius="md" withBorder style={{ padding: 0 }}>
      {toolbar && <div style={{ padding: '8px 12px', borderBottom: '1px solid light-dark(#cbd5e1, #334155)' }}>{toolbar}</div>}
      <Table.ScrollContainer minWidth={minWidth}>
        <Table tabularNums verticalSpacing="sm" horizontalSpacing="md" highlightOnHover className="data-table">
          <Table.Thead>
            <Table.Tr>
              {columns.map(column => (
                <Table.Th key={column.key} style={{ textAlign: column.align ?? 'left', whiteSpace: 'nowrap' }}>
                  {column.sortable && onSort ? (
                    <UnstyledButton
                      onClick={() => onSort(column.key, sort === column.key && direction === 'asc' ? 'desc' : 'asc')}
                    >
                      <Group gap={3} display="inline-flex" align="center">
                        <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                          {column.label}
                        </Text>
                        {sort === column.key ? (
                          direction === 'asc' ? <IconArrowUp size={12} color="var(--mantine-color-teal-6)" /> : <IconArrowDown size={12} color="var(--mantine-color-teal-6)" />
                        ) : null}
                      </Group>
                    </UnstyledButton>
                  ) : (
                    <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                      {column.label}
                    </Text>
                  )}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(row => {
              const rStyle = rowStyle?.(row);
              const rClass = rowClassName?.(row);
              return (
                <Table.Tr key={rowKey(row)} style={rStyle} className={rClass}>
                  {columns.map((column, colIdx) => (
                    <Table.Td
                      key={column.key}
                      style={{
                        textAlign: column.align ?? 'left',
                        width: column.key === 'actions' ? '1%' : undefined,
                        whiteSpace: column.key === 'actions' || column.align === 'right' ? 'nowrap' : undefined,
                        ...(rStyle?.backgroundColor ? { backgroundColor: rStyle.backgroundColor } : {}),
                        ...(colIdx === 0 && rStyle?.borderLeft ? { borderLeft: rStyle.borderLeft } : {}),
                      }}
                    >
                      {column.render(row)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

export function TableActions({ children }: { children: ReactNode }) {
  return (
    <Group gap={3} justify="end" wrap="nowrap" className="table-actions" style={{ width: 'max-content', minWidth: 'max-content', marginLeft: 'auto' }}>
      {children}
    </Group>
  );
}

export function TableAction({ label, children, color, disabled, href, onClick, variant = 'light' }: {
  label: string;
  children: ReactNode;
  color?: string;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  variant?: 'light' | 'subtle';
}) {
  if (href && !disabled) {
    return (
      <Tooltip label={label}>
        <ActionIcon component="a" href={href} target="_blank" rel="noreferrer" aria-label={label} size="xs" color={color} variant={variant}>
          {children}
        </ActionIcon>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={label}>
      <ActionIcon aria-label={label} size="xs" color={color} variant={variant} disabled={disabled} onClick={onClick}>
        {children}
      </ActionIcon>
    </Tooltip>
  );
}
