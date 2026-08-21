import { useState } from 'react';
import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  Paper,
  Alert,
  Divider,
  FileInput,
  ThemeIcon,
} from '@mantine/core';
import { exportBackup, restoreBackup } from './api';

type Props = {
  opened: boolean;
  onClose: () => void;
  reload: () => Promise<void>;
};

export function SettingsModal({ opened, onClose, reload }: Props) {
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const { data, filename } = await exportBackup();
      const blob = new Blob([new Uint8Array(data)], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotice(`Backup ${filename} downloaded successfully.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };

  const handleRestore = async () => {
    if (!file) return;
    const confirm = window.confirm(
      'Are you sure you want to restore this backup?\n\nAn automatic rollback copy will be saved before replacing your data.'
    );
    if (!confirm) return;

    setRestoring(true);
    setError('');
    setNotice('');
    try {
      const buffer = await file.arrayBuffer();
      const fileBytes = new Uint8Array(buffer);
      const res = await restoreBackup(fileBytes);
      setNotice(res.message);
      setFile(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700} size="lg">Settings & Data Protection</Text>}
      size="lg"
    >
      <Stack gap="md">
        {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
        {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}

        <Paper withBorder p="md" radius="md">
          <Text fw={600} size="sm" mb={4}>Export Data Backup</Text>
          <Text size="xs" c="dimmed" mb="md">
            Download a complete timestamped archive (.tar.gz) of your SQLite database and application state.
          </Text>
          <Button color="teal" variant="light" onClick={handleExport} loading={exporting}>
            Export Backup (.tar.gz)
          </Button>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} size="sm" mb={4}>Restore Database</Text>
          <Text size="xs" c="dimmed" mb="md">
            Upload a previously exported backup archive. The archive will be validated for integrity before restoring, and an automatic rollback copy will be saved first.
          </Text>
          <Stack gap="sm">
            <FileInput
              placeholder="Select .tar.gz backup file"
              accept=".tar.gz,.gz"
              value={file}
              onChange={setFile}
              size="xs"
            />
            <Group justify="end">
              <Button
                color="red"
                variant="filled"
                onClick={handleRestore}
                disabled={!file}
                loading={restoring}
              >
                Restore Backup
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Divider />

        <Group justify="end">
          <Button variant="subtle" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
