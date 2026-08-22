import { useState } from 'react';
import { Badge, Box, Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { Diagnostic } from '../api';
import { Empty, label } from '../App';

export function DiagnosticsView({
  diagnostics,
  onOpenSettings,
  onOpenInvest,
}: {
  diagnostics: Diagnostic[];
  onOpenSettings: () => void;
  onOpenInvest: () => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const categories = ['all', 'cash', 'drift', 'cost', 'overlap', 'stale'];

  const filtered = selectedCategory === 'all'
    ? diagnostics
    : diagnostics.filter(d => d.category === selectedCategory);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="start">
        <Box>
          <Title order={2}>Portfolio Diagnostics</Title>
          <Text c="dimmed">Deterministic rule-based observations to keep your portfolio optimized.</Text>
        </Box>
        <Group gap="xs">
          {categories.map(cat => {
            const count = cat === 'all' ? diagnostics.length : diagnostics.filter(d => d.category === cat).length;
            if (cat !== 'all' && count === 0) return null;
            return (
              <Button
                key={cat}
                size="xs"
                variant={selectedCategory === cat ? 'filled' : 'light'}
                color={selectedCategory === cat ? 'teal' : 'gray'}
                onClick={() => setSelectedCategory(cat)}
              >
                {label(cat)} ({count})
              </Button>
            );
          })}
        </Group>
      </Group>

      {diagnostics.length === 0 ? (
        <Empty
          title="All systems optimal"
          text="No diagnostic warnings or allocation issues detected across your portfolio."
        />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {filtered.map(diag => (
            <Card key={diag.id} withBorder radius="lg" p="lg" shadow="xs">
              <Group justify="space-between" align="start" mb="xs">
                <Badge
                  color={diag.severity === 'warning' ? 'orange' : diag.severity === 'alert' ? 'red' : 'blue'}
                  variant="light"
                  size="sm"
                >
                  {diag.category.toUpperCase()} · {diag.severity}
                </Badge>
              </Group>
              <Text fw={700} size="md" mb={4}>{diag.title}</Text>
              <Text size="sm" c="dimmed" mb="md">{diag.message}</Text>
              <Group justify="end">
                {diag.category === 'cash' && (
                  <Button size="xs" variant="light" color="teal" onClick={onOpenSettings}>
                    Configure Emergency Reserve
                  </Button>
                )}
                {diag.category === 'drift' && (
                  <Button size="xs" variant="light" color="teal" onClick={onOpenInvest}>
                    Rebalance Portfolio
                  </Button>
                )}
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
