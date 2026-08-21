import { Badge, type BadgeProps } from '@mantine/core';
import { chipColor } from './visual';

export { chipColor } from './visual';

export function Chip({ children, colorKey, className, ...props }: Omit<BadgeProps, 'children' | 'color'> & { children: string; colorKey?: string }) {
  return <Badge {...props} className={['stable-chip', className].filter(Boolean).join(' ')} color={chipColor(colorKey ?? children)} variant={props.variant ?? 'light'}>{children}</Badge>;
}
