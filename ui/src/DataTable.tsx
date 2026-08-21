import type { CSSProperties, ReactNode } from 'react';
import { ActionIcon, Group, Paper, Table, Tooltip, UnstyledButton } from '@mantine/core';

export type SortDirection = 'asc' | 'desc';

export type DataColumn<T> = {
  key: string;
  label?: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
};

export function DataTable<T>({ rows, columns, rowKey, minWidth = 800, toolbar, sort, direction = 'asc', onSort, rowStyle }: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string | number;
  minWidth?: number;
  toolbar?: ReactNode;
  sort?: string;
  direction?: SortDirection;
  onSort?: (key: string, direction: SortDirection) => void;
  rowStyle?: (row: T) => CSSProperties | undefined;
}) {
  return <Paper className="metric" radius="lg" p="md">
    {toolbar}
    <Table.ScrollContainer minWidth={minWidth}><Table tabularNums verticalSpacing="sm" horizontalSpacing="xs">
      <Table.Thead><Table.Tr>{columns.map(column => <Table.Th key={column.key}>
        {column.sortable && onSort ? <UnstyledButton fw={650} onClick={() => onSort(column.key, sort === column.key && direction === 'asc' ? 'desc' : 'asc')}>
          {column.label} {sort === column.key ? direction === 'asc' ? '↑' : '↓' : ''}
        </UnstyledButton> : column.label}
      </Table.Th>)}</Table.Tr></Table.Thead>
      <Table.Tbody>{rows.map(row => <Table.Tr key={rowKey(row)} style={rowStyle?.(row)}>{columns.map(column => <Table.Td key={column.key}>{column.render(row)}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
    </Table></Table.ScrollContainer>
  </Paper>;
}

export function TableActions({ children }: { children: ReactNode }) {
  return (
    <Group gap={3} justify="end" wrap="wrap" style={{ width: 56, minWidth: 56, marginLeft: 'auto' }}>
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
  if (href && !disabled) return <Tooltip label={label}><ActionIcon component="a" href={href} target="_blank" rel="noreferrer" aria-label={label} size="xs" color={color} variant={variant}>{children}</ActionIcon></Tooltip>;
  return <Tooltip label={label}><ActionIcon aria-label={label} size="xs" color={color} variant={variant} disabled={disabled} onClick={onClick}>{children}</ActionIcon></Tooltip>;
}
