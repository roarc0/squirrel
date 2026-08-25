import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Combobox,
  Divider,
  Group,
  InputBase,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  useCombobox,
} from '@mantine/core';
import { IconPencil, IconTrash, IconCopy, IconCamera, IconRepeat, IconPlus } from '@tabler/icons-react';
import type { Account, Holding, Instrument } from '../api';
import { AllocationBar } from '../App';
import { Chip } from '../Chip';
import { Empty } from '../components/Empty';
import { money, percent } from '../utils/format';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';

export type DraftAllocation = {
  instrument_id?: number;
  isin?: string;
  name: string;
  asset_class?: string;
  ter_bps?: number;
  target_pct: number;
  pac_share_pct?: number;
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
      { isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World UCITS ETF', asset_class: 'equity', ter_bps: 20, target_pct: 70, pac_share_pct: 70 },
      { isin: 'IE00BKM4GZ71', name: 'iShares Core MSCI EM IMI UCITS ETF', asset_class: 'equity', ter_bps: 18, target_pct: 30, pac_share_pct: 30 },
    ],
  },
  {
    id: 'preset-boglehead-3-fund',
    name: 'Boglehead 3-Fund Global Portfolio',
    description: '60% World Equity, 20% Emerging Markets, and 20% Global Aggregate Bonds.',
    updatedAt: new Date().toISOString().slice(0, 10),
    allocations: [
      { isin: 'IE00BK5BQT36', name: 'Vanguard FTSE All-World UCITS ETF', asset_class: 'equity', ter_bps: 22, target_pct: 60, pac_share_pct: 60 },
      { isin: 'IE00BKM4GZ71', name: 'iShares Core MSCI EM IMI UCITS ETF', asset_class: 'equity', ter_bps: 18, target_pct: 20, pac_share_pct: 20 },
      { isin: 'IE00BDBRDM35', name: 'iShares Global Aggregate Bond UCITS ETF', asset_class: 'bond', ter_bps: 10, target_pct: 20, pac_share_pct: 20 },
    ],
  },
  {
    id: 'preset-all-weather-balanced',
    name: 'All-Weather Inflation Balanced',
    description: '40% World Equities, 30% Long-Term Bonds, 15% Physical Gold, 15% Commodities.',
    updatedAt: new Date().toISOString().slice(0, 10),
    allocations: [
      { isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World UCITS ETF', asset_class: 'equity', ter_bps: 20, target_pct: 40, pac_share_pct: 40 },
      { isin: 'IE00BSKRJZ44', name: 'iShares $ Treasury Bond 20+yr UCITS ETF', asset_class: 'bond', ter_bps: 15, target_pct: 30, pac_share_pct: 30 },
      { isin: 'IE00B579F325', name: 'Invesco Physical Gold ETC', asset_class: 'commodity', ter_bps: 12, target_pct: 15, pac_share_pct: 15 },
      { isin: 'IE00BDFL4P12', name: 'iShares Diversified Commodity Swap UCITS ETF', asset_class: 'commodity', ter_bps: 19, target_pct: 15, pac_share_pct: 15 },
    ],
  },
];

function getStoredDrafts(): DraftPortfolio[] {
  try {
    const raw = localStorage.getItem('loot.draftPortfolios');
    if (!raw) return DEFAULT_PRESETS;
    const custom = JSON.parse(raw);
    return [...DEFAULT_PRESETS, ...custom];
  } catch {
    return DEFAULT_PRESETS;
  }
}

function saveCustomDrafts(drafts: DraftPortfolio[]) {
  try {
    const customOnly = drafts.filter(d => !d.id.startsWith('preset-'));
    localStorage.setItem('loot.draftPortfolios', JSON.stringify(customOnly));
  } catch {
    /* optional */
  }
}

function PortfolioOptionContent({ draft }: { draft: DraftPortfolio }) {
  const isPreset = draft.id.startsWith('preset-');
  const targetSum = draft.allocations.reduce((a, b) => a + (b.target_pct || 0), 0);
  return (
    <Stack gap={2} py={2}>
      <Group justify="space-between" wrap="nowrap">
        <Text fw={700} size="sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
          {draft.name}
        </Text>
        <Badge size="xs" color={isPreset ? 'gray' : 'violet'} variant={isPreset ? 'subtle' : 'light'} style={{ flexShrink: 0 }}>
          {isPreset ? 'Preset' : 'Custom'}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={1}>{draft.description}</Text>
      <Group gap="xs">
        <Text size="xs" c="dimmed">{draft.allocations.length} instruments</Text>
        <Badge size="xs" color={Math.abs(targetSum - 100) < 0.1 ? 'teal' : 'orange'} variant="dot">
          {targetSum}%
        </Badge>
      </Group>
    </Stack>
  );
}

export function DraftPortfoliosView({
  holdings,
  instruments,
  accounts: _accounts,
  reload: _reload,
}: {
  holdings: Holding[];
  instruments: Instrument[];
  accounts: Account[];
  reload: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<DraftPortfolio[]>(getStoredDrafts);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PRESETS[0].id);
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editingDraft, setEditingDraft] = useState<DraftPortfolio | null>(null);
  const [simulatedPacMonthly, setSimulatedPacMonthly] = useState<number>(300);
  const [success, setSuccess] = useState('');

  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });

  const activeDraft = drafts.find(d => d.id === selectedId) || drafts[0];

  const handleSnapshotCurrentHoldings = () => {
    const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));
    const allocations: DraftAllocation[] = holdings.map(h => {
      const inst = instMap.get(h.instrument_id);
      return {
        instrument_id: h.instrument_id,
        isin: h.instrument_isin,
        name: h.instrument_name || inst?.name || `Instrument #${h.instrument_id}`,
        asset_class: h.asset_class || inst?.asset_class || 'other',
        ter_bps: inst?.ter_bps ?? h.ter_bps ?? 0,
        target_pct: h.planned_bps ? h.planned_bps / 100 : (h.actual_bps ? h.actual_bps / 100 : 0),
        pac_share_pct: h.pac_bps ? h.pac_bps / 100 : 0,
      };
    });

    const newDraft: DraftPortfolio = {
      id: `draft-${Date.now()}`,
      name: `Snapshot ${new Date().toLocaleDateString()} (${holdings.length} holdings)`,
      description: 'Snapshot of active real holdings target weights.',
      updatedAt: new Date().toISOString().slice(0, 10),
      allocations,
    };

    const next = [...drafts, newDraft];
    setDrafts(next);
    saveCustomDrafts(next);
    setSelectedId(newDraft.id);
    setSuccess('Saved current holdings as a new Draft Portfolio!');
    setTimeout(() => setSuccess(''), 3500);
  };

  const handleCreateNew = () => {
    const newDraft: DraftPortfolio = {
      id: `draft-${Date.now()}`,
      name: 'Custom Model Allocation',
      description: 'Experimental allocation weights model.',
      updatedAt: new Date().toISOString().slice(0, 10),
      allocations: [
        { name: 'Core MSCI World ETF', asset_class: 'equity', ter_bps: 20, target_pct: 70, pac_share_pct: 70 },
        { name: 'Emerging Markets ETF', asset_class: 'equity', ter_bps: 18, target_pct: 30, pac_share_pct: 30 },
      ],
    };
    setEditingDraft(newDraft);
    setEditModalOpened(true);
  };

  const handleEdit = (draft: DraftPortfolio) => {
    setEditingDraft(JSON.parse(JSON.stringify(draft)));
    setEditModalOpened(true);
  };

  const handleClone = (draft: DraftPortfolio) => {
    const cloned: DraftPortfolio = {
      ...JSON.parse(JSON.stringify(draft)),
      id: `draft-${Date.now()}`,
      name: `${draft.name} (Copy)`,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    const next = [...drafts, cloned];
    setDrafts(next);
    saveCustomDrafts(next);
    setSelectedId(cloned.id);
    setSuccess(`Cloned "${draft.name}" as a new custom draft!`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();

  const handleDelete = (draft: DraftPortfolio) => {
    if (draft.id.startsWith('preset-')) return;
    confirmDelete('draft portfolio', draft.name, () => {
      const next = drafts.filter(d => d.id !== draft.id);
      setDrafts(next);
      saveCustomDrafts(next);
      setSelectedId(next[0]?.id || DEFAULT_PRESETS[0].id);
    });
  };

  const handleSaveDraftModal = () => {
    if (!editingDraft) return;
    const exists = drafts.some(d => d.id === editingDraft.id);
    const next = exists
      ? drafts.map(d => (d.id === editingDraft.id ? editingDraft : d))
      : [...drafts, editingDraft];
    setDrafts(next);
    saveCustomDrafts(next);
    setSelectedId(editingDraft.id);
    setEditModalOpened(false);
    setEditingDraft(null);
    setSuccess('Draft model portfolio saved!');
    setTimeout(() => setSuccess(''), 3000);
  };

  const totalTargetPct = (activeDraft?.allocations ?? []).reduce((a, b) => a + (b.target_pct || 0), 0);
  const totalPacSharePct = (activeDraft?.allocations ?? []).reduce((a, b) => a + (b.pac_share_pct || 0), 0);
  const weightedTerNum = (activeDraft?.allocations ?? []).reduce((acc, a) => acc + (a.target_pct || 0) * (a.ter_bps || 0), 0);
  const weightedTerPct = totalTargetPct > 0 ? weightedTerNum / totalTargetPct / 100 : 0;

  const classMap = new Map<string, number>();
  for (const alloc of activeDraft?.allocations ?? []) {
    const ac = alloc.asset_class || 'other';
    classMap.set(ac, (classMap.get(ac) ?? 0) + alloc.target_pct);
  }

  return (
    <ViewShell>
      <SectionHeader
        title="Portfolio Sandbox"
        subtitle="Select a classic model portfolio or create custom draft allocations to experiment with target weights."
        badge={<Badge color="violet" variant="light">Model Allocation Sandbox</Badge>}
        actions={
          <Group gap="xs" align="center" wrap="nowrap">
            <Combobox
              store={combobox}
              onOptionSubmit={val => { setSelectedId(val); combobox.closeDropdown(); }}
              width={360}
              position="bottom-end"
            >
              <Combobox.Target>
                <InputBase
                  component="button"
                  type="button"
                  pointer
                  rightSection={<Combobox.Chevron />}
                  rightSectionPointerEvents="none"
                  onClick={() => combobox.toggleDropdown()}
                  w={280}
                >
                  <Text size="sm" truncate>
                    {activeDraft?.name ?? 'Pick a portfolio...'}
                  </Text>
                </InputBase>
              </Combobox.Target>
              <Combobox.Dropdown>
                <ScrollArea.Autosize mah={420} type="scroll">
                  <Combobox.Options>
                    <Combobox.Group label="Standard Classic Portfolios">
                      {DEFAULT_PRESETS.map(d => (
                        <Combobox.Option value={d.id} key={d.id} active={d.id === selectedId}>
                          <PortfolioOptionContent draft={d} />
                        </Combobox.Option>
                      ))}
                    </Combobox.Group>
                    {drafts.some(d => !d.id.startsWith('preset-')) && (
                      <Combobox.Group label="Custom Saved Drafts">
                        {drafts.filter(d => !d.id.startsWith('preset-')).map(d => (
                          <Combobox.Option value={d.id} key={d.id} active={d.id === selectedId}>
                            <PortfolioOptionContent draft={d} />
                          </Combobox.Option>
                        ))}
                      </Combobox.Group>
                    )}
                  </Combobox.Options>
                </ScrollArea.Autosize>
              </Combobox.Dropdown>
            </Combobox>
            <Button variant="light" color="teal" leftSection={<IconCamera size={14} />} onClick={handleSnapshotCurrentHoldings}>
              Snapshot Real Holdings
            </Button>
            <Button color="violet" leftSection={<IconPlus size={14} />} onClick={handleCreateNew}>
              Create Custom Draft
            </Button>
          </Group>
        }
      />

      {success && <Alert color="teal">{success}</Alert>}

      {activeDraft ? (
        <Stack gap="md">
          <Card className="metric" p="lg" radius="lg">
            <Group justify="space-between" align="start" mb="xs">
              <Box>
                <Group gap="xs" mb={2}>
                  <Text size="xl" fw={800}>
                    {activeDraft.name}
                  </Text>
                  {activeDraft.id.startsWith('preset-') ? (
                    <Badge color="gray">Preset Model</Badge>
                  ) : (
                    <Badge color="violet">Custom Model</Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {activeDraft.description}
                </Text>
              </Box>

              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconCopy size={14} />}
                  onClick={() => handleClone(activeDraft)}
                >
                  Clone
                </Button>
                {!activeDraft.id.startsWith('preset-') && (
                  <>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconPencil size={14} />}
                      onClick={() => handleEdit(activeDraft)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => handleDelete(activeDraft)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </Group>
            </Group>

            <Divider my="sm" />

            <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
              <Box>
                <Text size="xs" c="dimmed">Target Allocation</Text>
                <Text size="lg" fw={750} c={Math.abs(totalTargetPct - 100) < 0.1 ? 'teal' : 'orange'}>
                  {totalTargetPct}%
                </Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">PAC Share Total</Text>
                <Text size="lg" fw={750} c="teal">{totalPacSharePct}%</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Weighted TER</Text>
                <Text size="lg" fw={750}>{weightedTerPct.toFixed(2)}%</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Annual Fee Drag</Text>
                <Text size="lg" fw={750} c="orange">
                  -{money(Math.round(simulatedPacMonthly * 12 * (weightedTerPct / 100)), 'EUR')}/yr
                </Text>
              </Box>
            </SimpleGrid>

            <Text size="xs" fw={700} c="dimmed" mb={4}>Asset Allocation Mix</Text>
            <AllocationBar
              total={totalTargetPct}
              segments={[...classMap].map(([ac, val]) => ({ label: ac, value: val }))}
            />
          </Card>

          <Paper className="metric" p="md" radius="lg">
            <Group justify="space-between" mb="xs">
              <Text fw={700} size="sm">Model Holdings & Target Percentage Shares</Text>
              <Text size="xs" c="dimmed">{activeDraft.allocations.length} Allocation Targets</Text>
            </Group>

            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Instrument / Index</Table.Th>
                  <Table.Th>Asset Class</Table.Th>
                  <Table.Th>TER Fee</Table.Th>
                  <Table.Th>Target Weight (%)</Table.Th>
                  <Table.Th>PAC Share (%)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {activeDraft.allocations.map((item, idx) => (
                  <Table.Tr key={idx}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{item.name}</Text>
                      {item.isin && <Text size="xs" c="dimmed">ISIN: {item.isin}</Text>}
                    </Table.Td>
                    <Table.Td><Chip>{item.asset_class || 'equity'}</Chip></Table.Td>
                    <Table.Td>{item.ter_bps ? percent(item.ter_bps) : '—'}</Table.Td>
                    <Table.Td>
                      <Badge color="blue" variant="filled">{item.target_pct}%</Badge>
                    </Table.Td>
                    <Table.Td>
                      {item.pac_share_pct !== undefined ? (
                        <Badge color="teal" variant="filled">🔄 {item.pac_share_pct}%</Badge>
                      ) : '—'}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>

          <Card className="metric" p="lg" radius="lg">
            <Group justify="space-between" align="center" mb="xs">
              <Text fw={750} size="md">📈 DCA PAC Projection Simulator</Text>
              <Group gap="xs">
                <Text size="xs" c="dimmed">Simulated Monthly Deposit:</Text>
                <NumberInput
                  w={120}
                  size="xs"
                  prefix="€"
                  min={0}
                  value={simulatedPacMonthly}
                  onChange={v => setSimulatedPacMonthly(Number(v || 0))}
                />
              </Group>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 4 }} mt="xs">
              <Paper p="xs" radius="md" withBorder>
                <Text size="xs" c="dimmed">Monthly Deposit</Text>
                <Text size="md" fw={800} color="teal">{money(simulatedPacMonthly * 100, 'EUR')}/mo</Text>
              </Paper>
              <Paper p="xs" radius="md" withBorder>
                <Text size="xs" c="dimmed">Yearly PAC Capital</Text>
                <Text size="md" fw={800} color="teal">{money(simulatedPacMonthly * 12 * 100, 'EUR')}/yr</Text>
              </Paper>
              <Paper p="xs" radius="md" withBorder>
                <Text size="xs" c="dimmed">5-Year Total PAC</Text>
                <Text size="md" fw={800}>{money(simulatedPacMonthly * 60 * 100, 'EUR')}</Text>
              </Paper>
              <Paper p="xs" radius="md" withBorder>
                <Text size="xs" c="dimmed">10-Year Total PAC</Text>
                <Text size="md" fw={800}>{money(simulatedPacMonthly * 120 * 100, 'EUR')}</Text>
              </Paper>
            </SimpleGrid>
          </Card>
        </Stack>
      ) : (
        <Empty title="No Draft Selected" text="Choose a portfolio from the selector above or create a new one." />
      )}

      {editModalOpened && editingDraft && (
        <Modal
          opened={editModalOpened}
          onClose={() => setEditModalOpened(false)}
          title="✏️ Edit Draft Portfolio Model"
          size="lg"
        >
          <Stack gap="sm">
            <TextInput
              label="Draft Name"
              required
              value={editingDraft.name}
              onChange={e => setEditingDraft(curr => curr ? { ...curr, name: e.currentTarget.value } : null)}
            />
            <Textarea
              label="Description"
              rows={2}
              value={editingDraft.description}
              onChange={e => setEditingDraft(curr => curr ? { ...curr, description: e.currentTarget.value } : null)}
            />

            <Divider label="Allocations & Target Percentage Shares" my="xs" />

            {editingDraft.allocations.map((alloc, idx) => (
              <Card key={idx} p="xs" withBorder>
                <Group align="end" gap="xs">
                  <TextInput
                    label="Instrument / Ticker"
                    style={{ flex: 1 }}
                    value={alloc.name}
                    onChange={e => {
                      const val = e.currentTarget.value;
                      setEditingDraft(curr =>
                        curr ? { ...curr, allocations: curr.allocations.map((a, i) => i === idx ? { ...a, name: val } : a) } : null
                      );
                    }}
                  />
                  <NumberInput
                    label="Target (%)"
                    w={110}
                    min={0}
                    max={100}
                    decimalScale={2}
                    value={alloc.target_pct}
                    onChange={val => {
                      const numVal = Number(val || 0);
                      setEditingDraft(curr =>
                        curr ? { ...curr, allocations: curr.allocations.map((a, i) => i === idx ? { ...a, target_pct: numVal } : a) } : null
                      );
                    }}
                  />
                  <NumberInput
                    label="PAC (%)"
                    w={100}
                    min={0}
                    max={100}
                    decimalScale={2}
                    value={alloc.pac_share_pct ?? 0}
                    onChange={val => {
                      const numVal = Number(val || 0);
                      setEditingDraft(curr =>
                        curr ? { ...curr, allocations: curr.allocations.map((a, i) => i === idx ? { ...a, pac_share_pct: numVal } : a) } : null
                      );
                    }}
                  />
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    mb={2}
                    onClick={() =>
                      setEditingDraft(curr =>
                        curr ? { ...curr, allocations: curr.allocations.filter((_, i) => i !== idx) } : null
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
                    curr ? { ...curr, allocations: [...curr.allocations, { name: 'New Asset', target_pct: 10, pac_share_pct: 10 }] } : null
                  )
                }
              >
                + Add Asset Row
              </Button>
              <Group gap="xs">
                <Button variant="default" size="xs" onClick={() => setEditModalOpened(false)}>Cancel</Button>
                <Button color="violet" size="xs" onClick={handleSaveDraftModal}>Save Draft</Button>
              </Group>
            </Group>
          </Stack>
        </Modal>
      )}
      {confirmDeleteModal}
    </ViewShell>
  );
}
