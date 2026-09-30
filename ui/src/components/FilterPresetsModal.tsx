import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { builtInPresets, type FilterPreset, type InstrumentFilters } from '../utils/rankFilters';

export function SavePresetModal({
  opened,
  onClose,
  initialName = '',
  matchingCount,
  onSave,
}: {
  opened: boolean;
  onClose: () => void;
  initialName?: string;
  matchingCount: number;
  onSave: (name: string) => void;
}) {
  const [presetNameInput, setPresetNameInput] = useState(initialName);

  useEffect(() => {
    if (opened) setPresetNameInput(initialName);
  }, [opened, initialName]);

  const handleSave = () => {
    if (!presetNameInput.trim()) return;
    onSave(presetNameInput.trim());
    setPresetNameInput('');
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Save Filter Preset" size="sm">
      <Stack gap="sm">
        <TextInput
          label="Preset name"
          placeholder="e.g. European Equity Core"
          value={presetNameInput}
          onChange={e => setPresetNameInput(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
          }}
          autoFocus
        />
        <Text size="xs" c="dimmed">
          Saves current filter criteria ({matchingCount} matching instruments). Presets are saved locally and can be recalled anytime.
        </Text>
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={!presetNameInput.trim()} onClick={handleSave}>
            Save preset
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ManagePresetsModal({
  opened,
  onClose,
  customPresets,
  activePresetId,
  currentFilters,
  onApplyPreset,
  onUpdatePreset,
  onDeletePreset,
}: {
  opened: boolean;
  onClose: () => void;
  customPresets: FilterPreset[];
  activePresetId: string | null;
  currentFilters: InstrumentFilters;
  onApplyPreset: (id: string) => void;
  onUpdatePreset: (updated: FilterPreset[]) => void;
  onDeletePreset: (id: string) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Manage Filter Presets" size="md">
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          Presets save your screener filters for quick recall. You can load, overwrite with current filters, or delete presets here.
        </Text>

        {customPresets.length === 0 ? (
          <Paper withBorder p="md" radius="sm" ta="center">
            <Text size="sm" c="dimmed">No custom presets saved yet.</Text>
            <Text size="xs" c="dimmed" mt={4}>Apply your favorite filters and click "Save preset" to create one.</Text>
          </Paper>
        ) : (
          <Stack gap="xs">
            {customPresets.map(preset => {
              const isActive = activePresetId === preset.id;
              return (
                <Paper key={preset.id} withBorder p="sm" radius="sm">
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Group gap="xs" align="center">
                        <Text fw={650} size="sm" truncate>{preset.name}</Text>
                        {isActive && <Badge size="xs" color="teal" variant="filled">Active</Badge>}
                      </Group>
                      <Group gap={4} mt={4} wrap="wrap">
                        {preset.filters.assetClasses.length > 0 && (
                          <Badge size="xs" variant="light" color="teal">{preset.filters.assetClasses.join(', ')}</Badge>
                        )}
                        {preset.filters.distributions.length > 0 && (
                          <Badge size="xs" variant="light" color="indigo">{preset.filters.distributions.join(', ')}</Badge>
                        )}
                        {preset.filters.excludeDistributions.length > 0 && (
                          <Badge size="xs" variant="light" color="red">Excl {preset.filters.excludeDistributions.join(', ')}</Badge>
                        )}
                        {preset.filters.maxTER !== '' && (
                          <Badge size="xs" variant="light" color="orange">TER ≤ {preset.filters.maxTER}%</Badge>
                        )}
                        {preset.filters.minSize !== '' && (
                          <Badge size="xs" variant="light" color="yellow">Size ≥ €{preset.filters.minSize}m</Badge>
                        )}
                      </Group>
                    </Box>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => {
                          onApplyPreset(preset.id);
                          onClose();
                        }}
                      >
                        Load
                      </Button>
                      <Tooltip label="Overwrite this preset with what is currently on screen">
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => {
                            const updated = customPresets.map(p =>
                              p.id === preset.id ? { ...p, filters: { ...currentFilters } } : p
                            );
                            onUpdatePreset(updated);
                            notifications.show({
                              color: 'teal',
                              title: 'Preset updated',
                              message: `Overwrote "${preset.name}" with current filters.`,
                            });
                          }}
                        >
                          Overwrite
                        </Button>
                      </Tooltip>
                      <Tooltip label={`Delete preset "${preset.name}"`}>
                        <ActionIcon
                          size="sm"
                          color="red"
                          variant="subtle"
                          onClick={() => onDeletePreset(preset.id)}
                          aria-label={`Delete ${preset.name}`}
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}

        <Divider my="xs" label="Built-in Presets" labelPosition="center" />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {builtInPresets.map(preset => (
            <Paper key={preset.id} withBorder p="xs" radius="sm" style={{ opacity: 0.9 }}>
              <Group justify="space-between" align="center">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="xs" fw={600} truncate>{preset.name}</Text>
                  <Text size="10px" c="dimmed">Built-in</Text>
                </Box>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={() => {
                    onApplyPreset(preset.id);
                    onClose();
                  }}
                >
                  Load
                </Button>
              </Group>
            </Paper>
          ))}
        </SimpleGrid>
      </Stack>
    </Modal>
  );
}
