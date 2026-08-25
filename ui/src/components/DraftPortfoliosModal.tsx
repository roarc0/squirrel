import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import type { Holding, Instrument } from '../api';
import { api } from '../api';
import { money, percent } from '../utils/format';

export type DraftAllocation = {
  instrumentId?: number;
  isin?: string;
  name: string;
  targetPct: number; // e.g. 70 for 70%
  pacSharePct?: number; // e.g. 60 for 60%
};

export type DraftPortfolio = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  allocations: DraftAllocation[];
};

const DEFAULT_PRESETS: DraftPortfolio[] = [
  {
    id: 'preset-world-em-70-30',
    name: 'Classic Core 70 / 30 World & EM',
    description: '70% Developed World equities + 30% Emerging Markets growth allocation.',
    updatedAt: new Date().toISOString().slice(0, 10),
    allocations: [
      { name: 'iShares Core MSCI World UCITS ETF', targetPct: 70, pacSharePct: 70 },
      { name: 'iShares Core MSCI EM IMI UCITS ETF', targetPct: 30, pacSharePct: 30 },
    ],
  },
  {
    id: 'preset-boglehead-3-fund',
    name: 'Boglehead 3-Fund Global Portfolio',
    description: '60% World Equity, 20% Emerging Markets, and 20% Global Aggregate Bonds.',
    updatedAt: new Date().toISOString().slice(0, 10),
    allocations: [
      { name: 'Vanguard FTSE All-World UCITS ETF', targetPct: 60, pacSharePct: 60 },
      { name: 'iShares Core MSCI EM IMI UCITS ETF', targetPct: 20, pacSharePct: 20 },
      { name: 'iShares Global Aggregate Bond UCITS ETF', targetPct: 20, pacSharePct: 20 },
    ],
  },
  {
    id: 'preset-all-weather-balanced',
    name: 'All-Weather Inflation Balanced',
    description: '40% World Equities, 30% Long-Term Bonds, 15% Physical Gold, 15% Commodities.',
    updatedAt: new Date().toISOString().slice(0, 10),
    allocations: [
      { name: 'iShares Core MSCI World UCITS ETF', targetPct: 40, pacSharePct: 40 },
      { name: 'iShares $ Treasury Bond 20+yr UCITS ETF', targetPct: 30, pacSharePct: 30 },
      { name: 'Invesco Physical Gold ETC', targetPct: 15, pacSharePct: 15 },
      { name: 'iShares Diversified Commodity Swap UCITS ETF', targetPct: 15, pacSharePct: 15 },
    ],
  },
];

function getStoredDrafts(): DraftPortfolio[] {
  try {
    const raw = localStorage.getItem('squirrel.draftPortfolios');
    const custom = raw ? (JSON.parse(raw) as DraftPortfolio[]) : [];
    return [...DEFAULT_PRESETS, ...custom];
  } catch {
    return DEFAULT_PRESETS;
  }
}

function saveCustomDrafts(drafts: DraftPortfolio[]) {
  try {
    const customOnly = drafts.filter(d => !d.id.startsWith('preset-'));
    localStorage.setItem('squirrel.draftPortfolios', JSON.stringify(customOnly));
  } catch {
    /* optional */
  }
}

export function DraftPortfoliosModal({
  opened,
  onClose,
  holdings,
  instruments,
  reload,
}: {
  opened: boolean;
  onClose: () => void;
  holdings: Holding[];
  instruments: Instrument[];
  reload: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<DraftPortfolio[]>(getStoredDrafts);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PRESETS[0].id);
  const [isEditing, setIsEditing] = useState(false);
  const [editingDraft, setEditingDraft] = useState<DraftPortfolio | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const activeDraft = drafts.find(d => d.id === selectedId) || drafts[0];

  const handleSaveCurrentAsDraft = () => {
    const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));
    const currentAllocations: DraftAllocation[] = holdings.map(h => {
      const inst = instMap.get(h.instrument_id);
      return {
        instrumentId: h.instrument_id,
        isin: h.instrument_isin,
        name: h.instrument_name || inst?.name || `Instrument #${h.instrument_id}`,
        targetPct: h.planned_bps ? h.planned_bps / 100 : (h.actual_bps ? h.actual_bps / 100 : 0),
        pacSharePct: h.pac_bps ? h.pac_bps / 100 : 0,
      };
    });

    const newDraft: DraftPortfolio = {
      id: `draft-${Date.now()}`,
      name: `Snapshot ${new Date().toLocaleDateString()} (${holdings.length} holdings)`,
      description: 'Saved snapshot of current holding target allocations.',
      updatedAt: new Date().toISOString().slice(0, 10),
      allocations: currentAllocations,
    };

    const nextDrafts = [...drafts, newDraft];
    setDrafts(nextDrafts);
    saveCustomDrafts(nextDrafts);
    setSelectedId(newDraft.id);
    setSuccess('Saved current holdings as new Draft Portfolio!');
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleDeleteDraft = (id: string) => {
    if (id.startsWith('preset-')) return;
    const next = drafts.filter(d => d.id !== id);
    setDrafts(next);
    saveCustomDrafts(next);
    setSelectedId(next[0]?.id || DEFAULT_PRESETS[0].id);
  };

  const handleApplyDraftToHoldings = async (draft: DraftPortfolio) => {
    setError('');
    setSuccess('');
    try {
      // Map draft allocations to matching holdings by ISIN or instrument name
      let appliedCount = 0;
      for (const holding of holdings) {
        const match = draft.allocations.find(
          a => (a.isin && a.isin === holding.instrument_isin) ||
               (a.name && holding.instrument_name && holding.instrument_name.toLowerCase().includes(a.name.toLowerCase()))
        );

        if (match) {
          const plannedBps = Math.round(match.targetPct * 100);
          const pacBps = Math.round((match.pacSharePct ?? 0) * 100);
          await api(`/api/holdings/${holding.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              ...holding,
              planned_bps: plannedBps,
              pac_bps: pacBps,
              is_pac: pacBps > 0,
            }),
          });
          appliedCount++;
        }
      }

      await reload();
      setSuccess(`Applied draft allocations to ${appliedCount} matching holdings!`);
      setTimeout(() => setSuccess(''), 4000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const startCreateNew = () => {
    setEditingDraft({
      id: `draft-${Date.now()}`,
      name: 'New Custom Model Portfolio',
      description: 'Custom target weights allocation model.',
      updatedAt: new Date().toISOString().slice(0, 10),
      allocations: [
        { name: 'Core World ETF', targetPct: 70, pacSharePct: 70 },
        { name: 'Emerging Markets ETF', targetPct: 30, pacSharePct: 30 },
      ],
    });
    setIsEditing(true);
  };

  const saveEditedDraft = () => {
    if (!editingDraft) return;
    const exists = drafts.some(d => d.id === editingDraft.id);
    let next: DraftPortfolio[];
    if (exists) {
      next = drafts.map(d => (d.id === editingDraft.id ? editingDraft : d));
    } else {
      next = [...drafts, editingDraft];
    }
    setDrafts(next);
    saveCustomDrafts(next);
    setSelectedId(editingDraft.id);
    setIsEditing(false);
    setEditingDraft(null);
  };

  return (
    <Modal opened={opened} onClose={onClose} title="📁 Draft & Model Portfolios" size="xl">
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}
        {success && <Alert color="teal">{success}</Alert>}

        {!isEditing ? (
          <>
            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed">
                Save experimental allocation models or load target weights into your active holdings.
              </Text>
              <Group gap="xs">
                <Button size="xs" variant="light" color="teal" onClick={handleSaveCurrentAsDraft}>
                  📸 Save Current Holdings as Draft
                </Button>
                <Button size="xs" variant="default" onClick={startCreateNew}>
                  + New Custom Draft
                </Button>
              </Group>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
              {drafts.map(d => (
                <Paper
                  key={d.id}
                  p="sm"
                  radius="md"
                  withBorder
                  style={{
                    cursor: 'pointer',
                    borderColor: d.id === selectedId ? 'var(--mantine-color-teal-5)' : undefined,
                    backgroundColor: d.id === selectedId ? 'rgba(32, 201, 151, 0.06)' : undefined,
                  }}
                  onClick={() => setSelectedId(d.id)}
                >
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={700} truncate>
                      {d.name}
                    </Text>
                    {d.id.startsWith('preset-') ? (
                      <Badge size="xs" color="gray" variant="subtle">
                        Preset
                      </Badge>
                    ) : (
                      <Badge size="xs" color="teal" variant="light">
                        Custom
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {d.description}
                  </Text>
                </Paper>
              ))}
            </SimpleGrid>

            {activeDraft && (
              <Card className="metric" p="lg" radius="lg">
                <Group justify="space-between" mb="sm">
                  <Box>
                    <Group gap="xs">
                      <Text fw={700} size="lg">
                        {activeDraft.name}
                      </Text>
                      {activeDraft.id.startsWith('preset-') && (
                        <Badge color="gray">Standard Model</Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {activeDraft.description}
                    </Text>
                  </Box>
                  <Group gap="xs">
                    {!activeDraft.id.startsWith('preset-') && (
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => handleDeleteDraft(activeDraft.id)}
                      >
                        Delete
                      </Button>
                    )}
                    <Button
                      size="xs"
                      color="teal"
                      onClick={() => void handleApplyDraftToHoldings(activeDraft)}
                    >
                      ⚡ Load Target Weights to Holdings
                    </Button>
                  </Group>
                </Group>

                <Divider my="xs" label="Planned Target Allocations" />

                <Stack gap="xs" mt="xs">
                  {activeDraft.allocations.map((item, idx) => (
                    <Paper key={idx} p="xs" radius="md" withBorder>
                      <Group justify="space-between">
                        <Box>
                          <Text size="sm" fw={600}>
                            {item.name}
                          </Text>
                          {item.isin && (
                            <Text size="xs" c="dimmed">
                              ISIN: {item.isin}
                            </Text>
                          )}
                        </Box>
                        <Group gap="md">
                          <Badge color="blue" variant="light">
                            Target Planned: {item.targetPct}%
                          </Badge>
                          {item.pacSharePct !== undefined && (
                            <Badge color="teal" variant="filled">
                              PAC Share: {item.pacSharePct}%
                            </Badge>
                          )}
                        </Group>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </Card>
            )}
          </>
        ) : (
          <Stack gap="sm">
            <TextInput
              label="Draft Name"
              required
              value={editingDraft?.name || ''}
              onChange={e =>
                setEditingDraft(curr => (curr ? { ...curr, name: e.currentTarget.value } : null))
              }
            />
            <Textarea
              label="Description"
              rows={2}
              value={editingDraft?.description || ''}
              onChange={e =>
                setEditingDraft(curr => (curr ? { ...curr, description: e.currentTarget.value } : null))
              }
            />

            <Divider label="Allocations & Target Weights" />

            {editingDraft?.allocations.map((alloc, idx) => (
              <Card key={idx} p="sm" withBorder>
                <Group justify="space-between" align="end">
                  <TextInput
                    label="Instrument / Index Name"
                    style={{ flex: 1 }}
                    value={alloc.name}
                    onChange={e => {
                      const val = e.currentTarget.value;
                      setEditingDraft(curr =>
                        curr
                          ? {
                              ...curr,
                              allocations: curr.allocations.map((a, i) =>
                                i === idx ? { ...a, name: val } : a
                              ),
                            }
                          : null
                      );
                    }}
                  />
                  <NumberInput
                    label="Target Weight (%)"
                    w={130}
                    min={0}
                    max={100}
                    value={alloc.targetPct}
                    onChange={val => {
                      const num = Number(val || 0);
                      setEditingDraft(curr =>
                        curr
                          ? {
                              ...curr,
                              allocations: curr.allocations.map((a, i) =>
                                i === idx ? { ...a, targetPct: num } : a
                              ),
                            }
                          : null
                      );
                    }}
                  />
                  <NumberInput
                    label="PAC Share (%)"
                    w={130}
                    min={0}
                    max={100}
                    value={alloc.pacSharePct ?? 0}
                    onChange={val => {
                      const num = Number(val || 0);
                      setEditingDraft(curr =>
                        curr
                          ? {
                              ...curr,
                              allocations: curr.allocations.map((a, i) =>
                                i === idx ? { ...a, pacSharePct: num } : a
                              ),
                            }
                          : null
                      );
                    }}
                  />
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() =>
                      setEditingDraft(curr =>
                        curr
                          ? {
                              ...curr,
                              allocations: curr.allocations.filter((_, i) => i !== idx),
                            }
                          : null
                      )
                    }
                  >
                    ×
                  </ActionIcon>
                </Group>
              </Card>
            ))}

            <Group justify="space-between" mt="md">
              <Button
                variant="light"
                size="xs"
                onClick={() =>
                  setEditingDraft(curr =>
                    curr
                      ? {
                          ...curr,
                          allocations: [
                            ...curr.allocations,
                            { name: 'New Asset', targetPct: 10, pacSharePct: 10 },
                          ],
                        }
                      : null
                  )
                }
              >
                + Add Asset Row
              </Button>
              <Group gap="xs">
                <Button variant="default" size="xs" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button color="teal" size="xs" onClick={saveEditedDraft}>
                  Save Draft
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
