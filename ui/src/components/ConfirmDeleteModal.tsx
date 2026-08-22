import { useState } from 'react';
import { Modal, Stack, Text, Group, Button, Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

type Props = {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title?: string;
  kind?: string;
  name?: string;
  consequence?: string;
  loading?: boolean;
};

export function ConfirmDeleteModal({
  opened,
  onClose,
  onConfirm,
  title,
  kind = 'item',
  name = '',
  consequence,
  loading = false,
}: Props) {
  const modalTitle = title || `Delete ${kind}?`;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={750} size="lg" c="red">
          {modalTitle}
        </Text>
      }
      radius="md"
    >
      <Stack gap="md">
        <Alert color="red" icon={<IconAlertTriangle size={20} />} radius="md">
          <Text size="sm" fw={600}>
            Are you sure you want to delete {name ? <Text span fw={800}>“{name}”</Text> : `this ${kind}`}?
          </Text>
          {consequence && (
            <Text size="xs" mt={4}>
              {consequence}
            </Text>
          )}
          <Text size="xs" c="dimmed" mt={4}>
            This action cannot be undone.
          </Text>
        </Alert>

        <Group justify="end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button color="red" onClick={() => void onConfirm()} loading={loading}>
            Delete {kind}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function useConfirmDelete() {
  const [target, setTarget] = useState<{
    kind: string;
    name: string;
    consequence?: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const confirmDelete = (
    kind: string,
    name: string,
    onConfirm: () => Promise<void> | void,
    consequence?: string
  ) => {
    setTarget({ kind, name, consequence, onConfirm });
  };

  const handleConfirm = async () => {
    if (!target) return;
    setLoading(true);
    try {
      await target.onConfirm();
      setTarget(null);
    } finally {
      setLoading(false);
    }
  };

  const modal = target ? (
    <ConfirmDeleteModal
      opened={Boolean(target)}
      onClose={() => setTarget(null)}
      onConfirm={handleConfirm}
      kind={target.kind}
      name={target.name}
      consequence={target.consequence}
      loading={loading}
    />
  ) : null;

  return { confirmDelete, modal };
}
