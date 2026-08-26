import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  FileInput,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAdjustments,
  IconBuildingBank,
  IconCoins,
  IconDatabase,
  IconDownload,
  IconEyeOff,
  IconFileCertificate,
  IconFlame,
  IconInfoCircle,
  IconPlug,
  IconShieldCheck,
  IconSparkles,
  IconUpload,
  IconUserCheck,
} from '@tabler/icons-react';

import { exportBackup, restoreBackup } from './api';
import { useConfirmDelete } from './components/ConfirmDeleteModal';
import { useProfile, isProfileLoaded } from './hooks/useProfile';
import { money } from './utils/format';
import { ViewShell } from './components/ViewShell';
import { SectionHeader } from './components/SectionHeader';

const CURRENCY_OPTIONS = [
  { value: 'EUR', label: 'EUR (€) — Euro' },
  { value: 'USD', label: 'USD ($) — US Dollar' },
  { value: 'ILS', label: 'ILS (₪) — Israeli New Shekel' },
  { value: 'GBP', label: 'GBP (£) — British Pound' },
  { value: 'CHF', label: 'CHF (Fr) — Swiss Franc' },
  { value: 'CAD', label: 'CAD ($) — Canadian Dollar' },
  { value: 'AUD', label: 'AUD ($) — Australian Dollar' },
  { value: 'JPY', label: 'JPY (¥) — Japanese Yen' },
  { value: 'CUSTOM', label: '✍️ Custom Currency (Code / Symbol)' },
];

export function SettingsView({ reload }: { reload: () => Promise<void> }) {
  const [profile, setProfile] = useProfile();
  const loaded = isProfileLoaded();

  const isKnownCurrency = CURRENCY_OPTIONS.some(c => c.value === profile.preferred_currency && c.value !== 'CUSTOM');
  const selectedCurrencyValue = isKnownCurrency ? profile.preferred_currency : 'CUSTOM';
  const [customCurrencyInput, setCustomCurrencyInput] = useState(
    isKnownCurrency ? '' : profile.preferred_currency
  );

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
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const { data, filename } = await exportBackup();
      const blob = new Blob([new Uint8Array(data)], { type: 'application/json' });
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
    confirmDelete('database backup restoration', file.name, async () => {
      setRestoring(true);
      setError('');
      setNotice('');
      try {
        const buffer = await file.arrayBuffer();
        const res = await restoreBackup(new Uint8Array(buffer));
        setNotice(res.message);
        setFile(null);
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setRestoring(false);
      }
    }, 'Your existing data will be replaced. If the restore fails, nothing changes.');
  };

  return (
    <ViewShell error={error} onCloseError={() => setError('')}>
      <SectionHeader
        title="Settings & Preferences"
        subtitle="Manage display currency, optional feature plugins, financial goals, and database backups."
        badge={
          loaded ? (
            <Badge variant="dot" color="teal" size="sm">
              Synced to your profile
            </Badge>
          ) : undefined
        }
      />
      {notice && (
        <Alert color="teal" withCloseButton onClose={() => setNotice('')} mb="md">
          {notice}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Left Column: General & Plugins */}
        <Stack gap="lg">
          {/* Section 0: Investor Profile & AI Consulting Context */}
          <Paper withBorder p="lg" radius="md">
            <Group justify="space-between" align="center" mb="xs">
              <Group gap="xs">
                <IconUserCheck size={20} color="var(--mantine-color-teal-6)" />
                <Text fw={700} size="md">
                  Investor Profile & AI Consulting Context
                </Text>
              </Group>
              <Badge color="teal" variant="light">
                AI Personalization
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mb="md">
              State your personal situation, age, sex, risk exposure/tolerance, investment objectives, and time horizon. The AI Consultant uses this information to deliver tailored portfolio advice.
            </Text>
            <Stack gap="md">
              <Textarea
                label="Investor Description & Profile"
                description="Include age, sex, investment objectives, risk tolerance, time horizon, monthly contribution goal, or tax constraints."
                placeholder="e.g. 34yo male, moderate-high risk exposure tolerance, 20-year horizon. Objective: long-term capital growth via low-cost index ETFs, €500/mo PAC, emergency fund secured."
                minRows={3}
                maxRows={8}
                autosize
                value={profile.user_description || ''}
                onChange={e => setProfile({ user_description: e.currentTarget.value })}
              />
              <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                <Text size="xs">
                  <strong>Financial Advice Disclaimer:</strong> All suggestions and recommendations provided by the AI Consultant are for analytical purposes only and do NOT constitute formal financial advice. Always evaluate recommendations with a grain of salt and consult a certified financial advisor before investing.
                </Text>
              </Alert>
            </Stack>
          </Paper>

          {/* Section 1: Regional & Display Preferences */}
          <Paper withBorder p="lg" radius="md">
            <Group gap="xs" mb="xs">
              <IconCoins size={20} color="var(--mantine-color-teal-6)" />
              <Text fw={700} size="md">
                Regional & Display Preferences
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="lg">
              Set default display currency and privacy options across all accounts and dashboards.
            </Text>
            <Stack gap="md">
              <Select
                label="Preferred Display Currency"
                description="Default currency symbol used for portfolio totals & reports"
                value={selectedCurrencyValue || 'EUR'}
                onChange={val => {
                  if (val === 'CUSTOM') {
                    const next = customCurrencyInput || 'BTC';
                    setProfile({ preferred_currency: next });
                  } else {
                    setProfile({ preferred_currency: val || 'EUR' });
                  }
                }}
                data={CURRENCY_OPTIONS}
              />
              {(selectedCurrencyValue === 'CUSTOM' || !isKnownCurrency) && (
                <TextInput
                  label="Custom Currency Code / Symbol"
                  description="Enter any custom currency code or symbol (e.g. BTC, SEK, NOK, AED, ₿)"
                  placeholder="e.g. BTC, SEK, or ₿"
                  value={customCurrencyInput}
                  onChange={e => {
                    const val = e.currentTarget.value.trim().toUpperCase();
                    setCustomCurrencyInput(val);
                    setProfile({ preferred_currency: val || 'EUR' });
                  }}
                />
              )}
              <Switch
                label="Privacy Mode (Hide Balances)"
                description="Mask all balance amounts with asterisks across the application"
                checked={profile.hide_balances}
                onChange={event => setProfile({ hide_balances: event.currentTarget.checked })}
              />
            </Stack>
          </Paper>

          {/* Section 2: Plugins & Feature Modules */}
          <Paper withBorder p="lg" radius="md">
            <Group justify="space-between" align="center" mb="xs">
              <Group gap="xs">
                <IconPlug size={20} color="var(--mantine-color-blue-6)" />
                <Text fw={700} size="md">
                  Plugins & Optional Modules
                </Text>
              </Group>
              <Badge color="blue" variant="light">
                Feature Toggles
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mb="lg">
              Enable or disable specialized analytical modules and tools.
            </Text>
            <Stack gap="md">
              <Card withBorder p="md" radius="sm">
                <Group justify="space-between" align="start" mb="xs">
                  <Box style={{ flex: 1 }}>
                    <Group gap="xs" mb={4}>
                      <IconFileCertificate size={16} color="var(--mantine-color-blue-6)" />
                      <Text fw={650} size="sm">
                        Italian BTP Ranks Plugin
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Enables the BTP Rank tab with yield curve analytics, Macaulay/Modified duration, and 6-factor composite bond rankings.
                    </Text>
                  </Box>
                  <Switch
                    checked={profile.enable_btp_ranks}
                    onChange={event => setProfile({ enable_btp_ranks: event.currentTarget.checked })}
                  />
                </Group>
                {profile.enable_btp_ranks && (
                  <Group justify="flex-end" mt="xs">
                    <Button
                      size="xs"
                      variant="light"
                      color="blue"
                      component="a"
                      href="?tab=btp"
                    >
                      Open BTP Rank Tab →
                    </Button>
                  </Group>
                )}
              </Card>

              <Card withBorder p="md" radius="sm">
                <Group justify="space-between" align="start">
                  <Box style={{ flex: 1 }}>
                    <Group gap="xs" mb={4}>
                      <IconFlame size={16} color="var(--mantine-color-orange-6)" />
                      <Text fw={650} size="sm">
                        FIRE Freedom Calculator
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Displays the 4% Safe Withdrawal Rate (SWR) financial independence calculator on the Overview dashboard.
                    </Text>
                  </Box>
                  <Switch
                    checked={profile.show_fire_calculator}
                    onChange={event => setProfile({ show_fire_calculator: event.currentTarget.checked })}
                  />
                </Group>
              </Card>
            </Stack>
          </Paper>
        </Stack>

        {/* Right Column: Financial Goals & Data Backup */}
        <Stack gap="lg">
          {/* Section 3: Financial Goals */}
          <Paper withBorder p="lg" radius="md">
            <Group gap="xs" mb="xs">
              <IconShieldCheck size={20} color="var(--mantine-color-teal-6)" />
              <Text fw={700} size="md">
                Financial Goals & Emergency Buffer
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="lg">
              Set targets for your emergency liquid reserve and long-term retirement calculations.
            </Text>
            <Stack gap="md">
              <NumberInput
                label="Monthly Living Expenses"
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
                  <Text size="xs" c="dimmed">Calculated Buffer Target</Text>
                  <Text fw={700} c="teal" size="md">
                    {money(reserveTarget * 100, profile.preferred_currency || 'EUR')}
                  </Text>
                </Group>
              )}
              <Divider my="xs" />
              <NumberInput
                label="Emergency Cash Goal"
                prefix="€ "
                placeholder="e.g. 10,000"
                min={0}
                value={emergencyGoal || ''}
                onChange={val => setProfile({ emergency_goal_minor: Number(val || 0) * 100 })}
              />
              <NumberInput
                label="Annual Expenses (FIRE 4% Target)"
                prefix="€ "
                description="Your target annual spending for the financial freedom calculator"
                placeholder="e.g. 24,000"
                min={0}
                value={fireExpenses || ''}
                onChange={val => setProfile({ fire_expenses_minor: Number(val || 0) * 100 })}
              />
            </Stack>
          </Paper>

          {/* Section 4: Data Backup & Management */}
          <Paper withBorder p="lg" radius="md">
            <Group gap="xs" mb="xs">
              <IconDatabase size={20} color="var(--mantine-color-violet-6)" />
              <Text fw={700} size="md">
                Data Management & Backups
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="lg">
              Safeguard your data with portable JSON export archives or restore existing backups.
            </Text>
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Box style={{ flex: 1 }}>
                  <Text fw={600} size="sm">
                    Export Backup Archive
                  </Text>
                  <Text size="xs" c="dimmed">
                    Download a full timestamped JSON backup. It contains sensitive financial data and is not encrypted.
                  </Text>
                </Box>
                <Button
                  color="teal"
                  variant="light"
                  leftSection={<IconDownload size={16} />}
                  onClick={() => void handleExport()}
                  loading={exporting}
                >
                  Export (.json)
                </Button>
              </Group>

              <Divider />

              <Stack gap="xs">
                <Text fw={600} size="sm">
                  Restore Database
                </Text>
                <Text size="xs" c="dimmed">
                  Upload a previously exported .json backup file. Your existing database will be safely updated in a single transaction.
                </Text>
                <Group gap="sm" mt="xs">
                  <FileInput
                    placeholder="Select .json backup file"
                    accept=".json"
                    value={file}
                    onChange={setFile}
                    size="sm"
                    style={{ flex: 1 }}
                  />
                  <Button
                    color="red"
                    variant="filled"
                    leftSection={<IconUpload size={16} />}
                    onClick={handleRestore}
                    disabled={!file}
                    loading={restoring}
                  >
                    Restore
                  </Button>
                </Group>
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      </SimpleGrid>

      <Divider my="xl" />
      {confirmDeleteModal}
    </ViewShell>
  );
}
