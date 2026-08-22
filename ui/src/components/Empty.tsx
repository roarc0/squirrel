import { Card, Text } from '@mantine/core';

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <Card className="metric" p="xl" radius="lg">
      <Text fw={700}>{title}</Text>
      <Text size="sm" c="dimmed" mt={4}>
        {text}
      </Text>
    </Card>
  );
}
