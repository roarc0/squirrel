import { Box, Group, Stack, Tooltip, UnstyledButton } from '@mantine/core';
import { Chip, chipColor } from './Chip';
import { money } from '../utils/format';

export interface AllocationSegment {
  label: string;
  value: number;
  key?: string;
}

export function AllocationBar({
  segments,
  total,
  selectedKey,
  onSelectKey,
}: {
  segments: AllocationSegment[];
  total: number;
  selectedKey?: string | null;
  onSelectKey?: (key: string | null) => void;
}) {
  const visible = segments.filter(segment => segment.value > 0);

  return (
    <Stack gap="xs" mt="sm">
      <Box
        h={14}
        bg="light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))"
        style={{ display: 'flex', overflow: 'hidden', borderRadius: 999 }}
      >
        {visible.map(segment => {
          const itemKey = segment.key ?? segment.label.toLowerCase();
          const isSelected = selectedKey === itemKey;
          const isDimmed = Boolean(selectedKey && !isSelected);
          const pct = total > 0 ? (segment.value / total) * 100 : 0;

          return (
            <Tooltip
              key={segment.label}
              label={`${segment.label}: ${pct.toFixed(1)}% (${money(segment.value, 'EUR')})${onSelectKey ? ' · Click to filter' : ''}`}
              withArrow
            >
              <Box
                bg={`${chipColor(segment.label)}.5`}
                onClick={() => onSelectKey?.(isSelected ? null : itemKey)}
                style={{
                  width: `${pct}%`,
                  cursor: onSelectKey ? 'pointer' : 'default',
                  opacity: isDimmed ? 0.35 : 1,
                  transition: 'opacity 0.2s ease, transform 0.15s ease',
                  transform: isSelected ? 'scaleY(1.2)' : 'scaleY(1)',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Group gap="xs">
        {visible.map(segment => {
          const itemKey = segment.key ?? segment.label.toLowerCase();
          const isSelected = selectedKey === itemKey;
          const pct = total > 0 ? (segment.value / total) * 100 : 0;
          return (
            <UnstyledButton
              key={segment.label}
              disabled={!onSelectKey}
              onClick={() => onSelectKey?.(isSelected ? null : itemKey)}
            >
              <Chip
                colorKey={segment.label}
                variant={isSelected ? 'filled' : 'light'}
                style={{
                  cursor: onSelectKey ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                  boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
                }}
              >
                {`${segment.label} ${pct.toFixed(1)}%`}
              </Chip>
            </UnstyledButton>
          );
        })}
      </Group>
    </Stack>
  );
}
