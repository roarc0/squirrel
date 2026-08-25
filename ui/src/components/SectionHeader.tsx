import type { ReactNode } from 'react';
import { Group, Stack, Text, Title } from '@mantine/core';

export function SectionHeader({
  title,
  subtitle,
  actions,
  badge,
  order = 2,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  order?: 2 | 3;
}) {
  return (
    <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
      <Stack gap={2}>
        <Group gap="xs" align="center">
          {typeof title === 'string' ? <Title order={order}>{title}</Title> : title}
          {badge}
        </Group>
        {subtitle && (
          typeof subtitle === 'string' ? (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        )}
      </Stack>
      {actions && <Group gap="xs" align="center">{actions}</Group>}
    </Group>
  );
}
