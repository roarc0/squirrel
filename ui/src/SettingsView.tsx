import { useState } from 'react';
import {
  Button,
  Divider,
  FileInput,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Alert,
  Title,
  Badge,
} from '@mantine/core';
import { exportBackup, restoreBackup } from './api';
import { useConfirmDelete } from './components/ConfirmDeleteModal';
import { useProfile, isProfileLoaded } from './hooks/useProfile';
import { money } from './utils/format';

export function SettingsView({ reload }: { reload: () => Promise<void> }) {
  const [profile, setProfile] = useProfile();
  const loaded = isProfileLoaded();

  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();

  const monthlyExpenses = Math.round(profile.monthly_expenses_minor / 100);
  const reserveTarget = monthlyExpenses * profile.reserve_months;
  const emergencyGoal = Math.round(profile.emergency_goal_minor / 100);
  const fireExpenses = Math.round(profile.fire_expenses_minor / 100);

  const handleExport = async () => {
    setExporting(true); setError(''); setNotice('');
    try {
      const { data, filename } = await exportBackup();
      const blob = new Blob([new Uint8Array(data)], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click();
      document.body.removeChild(link); URL.revokeObjectURL(url);
      setNotice(`Backup ${filename} downloaded.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setExporting(false); }
  };

  const handleRestore = () => {
    if (!file) return;
    confirmDelete('database backup restoration', file.name, async () => {
      setRestoring(true); setError(''); setNotice('');
      try {
        const buffer = await file.arrayBuffer();
        const res = await restoreBackup(new Uint8Array(buffer));
        setNotice(res.message); setFile(null);
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally { setRestoring(false); }
    }, 'Your existing data will be replaced. If the restore fails, nothing changes.');
  };

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="center">
        <Title order={2}>Settings</Title>
        {loaded && <Badge variant="dot" color="teal" size="sm">Synced to your account</Badge>}
      </Group>

      {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Left column — Financial preferences */}
        <Stack gap="lg">
          <Paper withBorder p="lg" radius="md">
            <Text fw={600} mb={4}>Monthly Budget</Text>
            <Text size="xs" c="dimmed" mb="lg">
              Your estimated monthly living expenses. Used to calculate the emergency cash reserve target shown in the Overview.
            </Text>
            <Stack gap="md">
              <NumberInput
                label="Monthly Expenses"
                prefix="€ "
                placeholder="e.g. 2,000"
                min={0}
                value={monthlyExpenses || ''}
                onChange={val => setProfile({ monthly_expenses_minor: Number(val || 0) * 100 })}
              />
              <Select
                label="Reserve Buffer Target"
                value={String(profile.reserve_months)}
                onChange={val => setProfile({ reserve_months: Number(val || 6) })}
                data={[
                  { value: '3', label: '3 Months' },
                  { value: '6', label: '6 Months (Recommended)' },
                  { value: '9', label: '9 Months' },
                  { value: '12', label: '12 Months' },
                ]}
              />
              {reserveTarget > 0 && (
                <Group justify="space-between" pt="xs">
                  <Text size="sm" c="dimmed">Reserve Target</Text>
                  <Text fw={700} c="teal" size="lg">{money(reserveTarget * 100, 'EUR')}</Text>
                </Group>
              )}
            </Stack>
          </Paper>

          <Paper withBorder p="lg" radius="md">
            <Text fw={600} mb={4}>Portfolio Goals</Text>
            <Text size="xs" c="dimmed" mb="lg">
              Goals used in the Overview dashboard widgets. The emergency goal is the cash balance target; the FIRE number drives the financial freedom calculator.
            </Text>
            <Stack gap="md">
              <Switch
                label="Show FIRE Target Calculator"
                description="Display financial independence & 4% rule calculator in Overview"
                checked={profile.show_fire_calculator}
                onChange={event => setProfile({ show_fire_calculator: event.currentTarget.checked })}
              />
              <NumberInput
                label="Emergency Cash Goal"
                prefix="€ "
                placeholder="e.g. 10,000"
                min={0}
                value={emergencyGoal || ''}
                onChange={val => setProfile({ emergency_goal_minor: Number(val || 0) * 100 })}
              />
              <NumberInput
                label="Annual Expenses (FIRE)"
                prefix="€ "
                description="Your target annual spending for the 4% rule calculator"
                placeholder="e.g. 24,000"
                min={0}
                value={fireExpenses || ''}
                onChange={val => setProfile({ fire_expenses_minor: Number(val || 0) * 100 })}
              />
            </Stack>
          </Paper>
        </Stack>

        {/* Right column — Data management */}
        <Stack gap="lg">
          <Paper withBorder p="lg" radius="md">
            <Text fw={600} mb={4}>Export Data Backup</Text>
            <Text size="xs" c="dimmed" mb="lg">
              Download a complete timestamped archive (.json) of your portfolio data.
            </Text>
            <Button color="teal" variant="light" onClick={handleExport} loading={exporting}>
              Export Backup (.json)
            </Button>
          </Paper>

          <Paper withBorder p="lg" radius="md">
            <Text fw={600} mb={4}>Restore Database</Text>
            <Text size="xs" c="dimmed" mb="lg">
              Upload a previously exported .json backup. Your existing data will be replaced within a transaction — if anything fails, nothing changes.
            </Text>
            <Stack gap="sm">
              <FileInput
                placeholder="Select .json backup file"
                accept=".json"
                value={file}
                onChange={setFile}
                size="sm"
              />
              <Group justify="flex-end">
                <Button color="red" variant="filled" onClick={handleRestore} disabled={!file} loading={restoring}>
                  Restore Backup
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Stack>
      </SimpleGrid>

      <Divider />
      {confirmDeleteModal}
    </Stack>
  );
}
