import { Badge, Tooltip, Text, type BadgeProps } from '@mantine/core';
import { chipColor } from './visual';
import { copyToClipboard } from './utils/copyToClipboard';

export { chipColor } from './visual';

export function Chip({ children, colorKey, className, ...props }: Omit<BadgeProps, 'children' | 'color'> & { children: string; colorKey?: string }) {
  return <Badge {...props} className={['stable-chip', className].filter(Boolean).join(' ')} color={chipColor(colorKey ?? children)} variant={props.variant ?? 'light'}>{children}</Badge>;
}

export function ISINBadge({ isin, size = 'xs' }: { isin?: string; size?: BadgeProps['size'] }) {
  if (!isin) return <Text size="xs" c="dimmed">—</Text>;
  return (
    <Tooltip label="Click to copy ISIN" withArrow>
      <Badge
        size={size}
        variant="subtle"
        color="gray"
        className="isin-badge"
        onClick={(e) => {
          e.stopPropagation();
          copyToClipboard(isin, 'ISIN');
        }}
      >
        {isin}
      </Badge>
    </Tooltip>
  );
}

export function TickerBadge({ ticker, size = 'sm' }: { ticker?: string; size?: BadgeProps['size'] }) {
  if (!ticker) return <Text size="xs" c="dimmed">—</Text>;
  return (
    <Tooltip label="Click to copy Ticker" withArrow>
      <Badge
        size={size}
        variant="light"
        color="teal"
        className="ticker-badge"
        onClick={(e) => {
          e.stopPropagation();
          copyToClipboard(ticker, 'Ticker');
        }}
      >
        {ticker}
      </Badge>
    </Tooltip>
  );
}

export function replicationCompactLabel(value?: string): string {
  switch (value) {
    case 'physical_full': return 'Phy / Full';
    case 'physical_sampling': return 'Phy / Sampled';
    case 'synthetic': return 'Swap / Syn';
    default: return value || '—';
  }
}

export function replicationFullLabel(value?: string): string {
  switch (value) {
    case 'physical_full': return 'Physical (Full Replication)';
    case 'physical_sampling': return 'Physical (Optimized Sampling)';
    case 'synthetic': return 'Synthetic (Swap-based)';
    default: return value || '—';
  }
}

export function ReplicationChip({ value, size = 'sm' }: { value?: string; size?: BadgeProps['size'] }) {
  if (!value) return <Text size="sm" c="dimmed">—</Text>;
  const compact = replicationCompactLabel(value);
  const fullText = replicationFullLabel(value);
  return (
    <Tooltip label={fullText} withArrow>
      <Chip colorKey={compact} size={size}>
        {compact}
      </Chip>
    </Tooltip>
  );
}
