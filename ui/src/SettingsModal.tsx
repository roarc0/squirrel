import { useState, useEffect } from 'react';
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
  NumberInput,
  Select,
} from '@mantine/core';
import { exportBackup, restoreBackup } from './api';
import { useConfirmDelete } from './components/ConfirmDeleteModal';

type Props = {
  opened: boolean;
  onClose: () => void;
  reload: () => Promise<void>;
};

export function SettingsModal({ opened, onClose, reload }: Props) {
  const [monthlyExpenses, setMonthlyExpenses] = useState<number>(() => {
    try { return Number(localStorage.getItem('squirrel.monthlyExpenses') || 0); } catch { return 0; }
  });
  const [reserveMonths, setReserveMonths] = useState<string>(() => {
    try { return localStorage.getItem('squirrel.reserveMonths') || '6'; } catch { return '6'; }
  });

  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();

  const targetReserve = (monthlyExpenses || 0) * Number(reserveMonths || 6);

  const saveReserveSettings = (exp: number, months: string) => {
    try {
      localStorage.setItem('squirrel.monthlyExpenses', String(exp || 0));
      localStorage.setItem('squirrel.reserveMonths', months);
      void reload();
    } catch { /* preference persistence is optional */ }
  };

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

  const handleRestore = () => {
    if (!file) return;
    confirmDelete(
      'database backup restoration',
      file.name,
      async () => {
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
      },
      'Your existing data will be replaced. If the restore fails, nothing changes.'
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700} size="lg">Settings & Data Preferences</Text>}
      size="lg"
    >
      <Stack gap="md">
        {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
        {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}

        <Paper withBorder p="md" radius="md">
          <Text fw={600} size="sm" mb={4}>Emergency Cash Reserve (3–6 Months)</Text>
          <Text size="xs" c="dimmed" mb="md">
            Specify your estimated monthly living expenses to calculate your target emergency cash buffer. Portfolio diagnostics will notify you if your cash balance falls below or excessively exceeds your target.
          </Text>

          <Group justify="space-between" align="flex-start" wrap="wrap">
            <NumberInput
              label="Monthly Expenses (€)"
              prefix="€ "
              placeholder="e.g. 2,000"
              min={0}
              value={monthlyExpenses || ''}
              onChange={val => {
                const nextExp = Number(val || 0);
                setMonthlyExpenses(nextExp);
                saveReserveSettings(nextExp, reserveMonths);
              }}
              style={{ width: 180 }}
            />
            <Select
              label="Emergency Reserve Buffer"
              value={reserveMonths}
              onChange={val => {
                const nextMonths = val || '6';
                setReserveMonths(nextMonths);
                saveReserveSettings(monthlyExpenses, nextMonths);
              }}
              data={[
                { value: '3', label: '3 Months' },
                { value: '6', label: '6 Months (Recommended)' },
                { value: '9', label: '9 Months' },
                { value: '12', label: '12 Months' },
              ]}
              style={{ width: 220 }}
            />
            <Stack gap={2} align="end" style={{ alignSelf: 'center' }}>
              <Text size="xs" c="dimmed">Target Emergency Reserve</Text>
              <Text fw={750} size="lg" c="teal">
                {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(targetReserve)}
              </Text>
            </Stack>
          </Group>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} size="sm" mb={4}>Export Data Backup</Text>
          <Text size="xs" c="dimmed" mb="md">
            Download a complete timestamped archive (.json) of your portfolio data.
          </Text>
          <Button color="teal" variant="light" onClick={handleExport} loading={exporting}>
            Export Backup (.json)
          </Button>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} size="sm" mb={4}>Restore Database</Text>
          <Text size="xs" c="dimmed" mb="md">
            Upload a previously exported .json backup. Your existing data will be replaced within a transaction — if anything fails, nothing changes.
          </Text>
          <Stack gap="sm">
            <FileInput
              placeholder="Select .json backup file"
              accept=".json"
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
      {confirmDeleteModal}
    </Modal>
  );
}
