import { Card, Group, Paper, SimpleGrid, Skeleton, Stack } from '@mantine/core';

export function AppSkeleton() {
  return (
    <Stack gap="lg" mt="sm">
      <Group justify="space-between" align="center">
        <Skeleton height={28} width={180} radius="md" />
        <Group gap="xs">
          <Skeleton height={32} width={70} radius="md" />
          <Skeleton height={32} width={60} radius="md" />
          <Skeleton height={32} width={60} radius="md" />
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="metric" p="lg" radius="lg">
            <Skeleton height={14} width="40%" radius="sm" mb="xs" />
            <Skeleton height={28} width="70%" radius="sm" mb="xs" />
            <Skeleton height={12} width="50%" radius="sm" />
          </Card>
        ))}
      </SimpleGrid>

      <Card className="metric" p="lg" radius="lg">
        <Skeleton height={20} width={140} radius="sm" mb="md" />
        <Skeleton height={200} radius="md" />
      </Card>

      <Paper className="metric" radius="lg" p="md">
        <Stack gap="sm">
          <Skeleton height={24} width="30%" radius="sm" />
          <Skeleton height={40} radius="sm" />
          <Skeleton height={40} radius="sm" />
          <Skeleton height={40} radius="sm" />
        </Stack>
      </Paper>
    </Stack>
  );
}
