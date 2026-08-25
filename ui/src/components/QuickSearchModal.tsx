import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Badge,
  Box,
  Group,
  Kbd,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import {
  IconSearch,
  IconChartPie,
  IconBuildingBank,
  IconBriefcase,
  IconFlask,
  IconRobot,
  IconFileCertificate,
  IconSettings,
  IconArrowsExchange,
  IconEyeOff,
  IconEye,
  IconRefresh,
  IconArrowRight,
  IconSparkles,
} from '@tabler/icons-react';
import type { Account, Instrument, BtpBond } from '../api';
import { copyToClipboard } from '../utils/copyToClipboard';

export type QuickSearchAction = {
  id: string;
  category: 'Navigation' | 'Instruments & BTPs' | 'Quick Actions';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  onSelect: () => void;
};

export function QuickSearchModal({
  opened,
  onClose,
  onSwitchTab,
  onToggleHideBalances,
  onOpenUpdateModal,
  hideBalances,
  instruments = [],
  accounts = [],
  btps = [],
}: {
  opened: boolean;
  onClose: () => void;
  onSwitchTab: (tab: string) => void;
  onToggleHideBalances: () => void;
  onOpenUpdateModal: () => void;
  hideBalances: boolean;
  instruments?: Instrument[];
  accounts?: Account[];
  btps?: BtpBond[];
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query and selection when modal opens
  useEffect(() => {
    if (opened) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [opened]);

  const allActions = useMemo<QuickSearchAction[]>(() => {
    const actions: QuickSearchAction[] = [];

    // 1. Navigation Tabs
    actions.push(
      {
        id: 'nav-overview',
        category: 'Navigation',
        title: 'Overview Dashboard',
        subtitle: 'View portfolio summary, net worth trend, and asset allocation',
        icon: <IconChartPie size={18} color="var(--mantine-color-teal-6)" />,
        onSelect: () => {
          onSwitchTab('overview');
          onClose();
        },
      },
      {
        id: 'nav-accounts',
        category: 'Navigation',
        title: 'Accounts & Liquidity',
        subtitle: 'Manage cash balances, bank accounts, and liquidity tiers',
        icon: <IconBuildingBank size={18} color="var(--mantine-color-blue-6)" />,
        onSelect: () => {
          onSwitchTab('accounts');
          onClose();
        },
      },
      {
        id: 'nav-investments',
        category: 'Navigation',
        title: 'Investments & Holdings',
        subtitle: 'View active holdings, PAC budgets, and position profits',
        icon: <IconBriefcase size={18} color="var(--mantine-color-teal-6)" />,
        onSelect: () => {
          onSwitchTab('investments');
          onClose();
        },
      },
      {
        id: 'nav-drafts',
        category: 'Navigation',
        title: 'Portfolio Sandbox (Drafts)',
        subtitle: 'Simulate rebalancing scenarios and draft portfolio strategies',
        icon: <IconFlask size={18} color="var(--mantine-color-violet-6)" />,
        onSelect: () => {
          onSwitchTab('drafts');
          onClose();
        },
      },
      {
        id: 'nav-instruments',
        category: 'Navigation',
        title: 'Instruments Catalog',
        subtitle: 'Search and compare ETFs, Stocks, Bonds, and Funds',
        icon: <IconSearch size={18} color="var(--mantine-color-cyan-6)" />,
        onSelect: () => {
          onSwitchTab('instruments');
          onClose();
        },
      },
      {
        id: 'nav-btp',
        category: 'Navigation',
        title: 'BTP Rank Analytics',
        subtitle: 'Italian Sovereign Bonds yield curve, duration risk, and scoring',
        icon: <IconFileCertificate size={18} color="var(--mantine-color-blue-6)" />,
        onSelect: () => {
          onSwitchTab('btp');
          onClose();
        },
      },
      {
        id: 'nav-consultant',
        category: 'Navigation',
        title: 'AI Consultant',
        subtitle: 'Get AI portfolio observations and allocation advice',
        icon: <IconRobot size={18} color="var(--mantine-color-indigo-6)" />,
        onSelect: () => {
          onSwitchTab('consultant');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        category: 'Navigation',
        title: 'Settings & Preferences',
        subtitle: 'Configure currency, reserve buffer targets, and backups',
        icon: <IconSettings size={18} color="var(--mantine-color-gray-6)" />,
        onSelect: () => {
          onSwitchTab('settings');
          onClose();
        },
      }
    );

    // 2. Quick Actions
    actions.push(
      {
        id: 'action-update',
        category: 'Quick Actions',
        title: 'Update Portfolio Values',
        subtitle: 'Record current holding balances and update snapshot',
        icon: <IconArrowsExchange size={18} color="var(--mantine-color-teal-6)" />,
        onSelect: () => {
          onClose();
          onOpenUpdateModal();
        },
      },
      {
        id: 'action-hide-balances',
        category: 'Quick Actions',
        title: hideBalances ? 'Show Balances' : 'Hide Balances (Privacy Mode)',
        subtitle: hideBalances ? 'Unmask monetary values across dashboards' : 'Mask monetary values with asterisks',
        icon: hideBalances ? <IconEye size={18} color="var(--mantine-color-teal-6)" /> : <IconEyeOff size={18} color="var(--mantine-color-orange-6)" />,
        onSelect: () => {
          onToggleHideBalances();
          onClose();
        },
      }
    );

    // 3. Search Instruments & Accounts
    for (const inst of instruments) {
      actions.push({
        id: `inst-${inst.id}`,
        category: 'Instruments & BTPs',
        title: inst.name,
        subtitle: `${inst.ticker || '—'} · ISIN: ${inst.isin}`,
        icon: <IconSearch size={18} color="var(--mantine-color-cyan-6)" />,
        badge: inst.instrument_type.toUpperCase(),
        badgeColor: 'cyan',
        onSelect: () => {
          onSwitchTab('instruments');
          copyToClipboard(inst.isin, 'ISIN');
          onClose();
        },
      });
    }

    // 4. Search BTP Bonds
    for (const btp of btps) {
      actions.push({
        id: `btp-${btp.isin}`,
        category: 'Instruments & BTPs',
        title: btp.name,
        subtitle: `Price: €${btp.price.toFixed(2)} · Net YTM: ${btp.ytm_net.toFixed(2)}% · Expiry: ${btp.expiry_date}`,
        icon: <IconFileCertificate size={18} color="var(--mantine-color-blue-6)" />,
        badge: `Tier ${btp.tier_rank}`,
        badgeColor: btp.tier_rank === 'S' ? 'violet' : btp.tier_rank === 'A' ? 'teal' : 'blue',
        onSelect: () => {
          onSwitchTab('btp');
          copyToClipboard(btp.isin, 'BTP ISIN');
          onClose();
        },
      });
    }

    return actions;
  }, [instruments, accounts, btps, hideBalances, onSwitchTab, onClose, onOpenUpdateModal, onToggleHideBalances]);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allActions;
    return allActions.filter(
      a =>
        a.title.toLowerCase().includes(q) ||
        (a.subtitle && a.subtitle.toLowerCase().includes(q)) ||
        a.category.toLowerCase().includes(q)
    );
  }, [allActions, query]);

  // Handle Keyboard Arrow Navigation & Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % (filteredActions.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredActions.length) % (filteredActions.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredActions[selectedIndex]) {
        filteredActions[selectedIndex].onSelect();
      }
    }
  };

  // Group filtered actions by category
  const groupedActions = useMemo(() => {
    const groups: { category: string; items: { action: QuickSearchAction; globalIndex: number }[] }[] = [];
    let currentIndex = 0;

    const catMap = new Map<string, { action: QuickSearchAction; globalIndex: number }[]>();
    for (const action of filteredActions) {
      const list = catMap.get(action.category) ?? [];
      list.push({ action, globalIndex: currentIndex++ });
      catMap.set(action.category, list);
    }

    for (const [category, items] of catMap.entries()) {
      groups.push({ category, items });
    }
    return groups;
  }, [filteredActions]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      size="lg"
      padding={0}
      radius="lg"
      styles={{
        content: { overflow: 'hidden', background: 'var(--mantine-color-body)' },
      }}
    >
      <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <TextInput
          ref={inputRef}
          leftSection={<IconSearch size={20} color="var(--mantine-color-teal-6)" />}
          placeholder="Type a command or search (e.g. Accounts, BTP, ISIN, Privacy)..."
          variant="unstyled"
          size="md"
          value={query}
          onChange={e => {
            setQuery(e.currentTarget.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </Box>

      <ScrollArea.Autosize mah={380} offsetScrollbars p="xs">
        {filteredActions.length === 0 ? (
          <Stack align="center" py="xl" gap="xs">
            <IconSparkles size={32} color="var(--mantine-color-dimmed)" />
            <Text fw={650} size="sm">
              No matching results found
            </Text>
            <Text size="xs" c="dimmed">
              Try searching for a tab name, instrument ISIN, or command.
            </Text>
          </Stack>
        ) : (
          <Stack gap="xs">
            {groupedActions.map(group => (
              <Box key={group.category}>
                <Text
                  size="11px"
                  fw={700}
                  c="dimmed"
                  px="xs"
                  py={4}
                  style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
                >
                  {group.category}
                </Text>
                <Stack gap={2}>
                  {group.items.map(({ action, globalIndex }) => {
                    const isSelected = globalIndex === selectedIndex;
                    return (
                      <UnstyledButton
                        key={action.id}
                        onClick={action.onSelect}
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          background: isSelected
                            ? 'var(--mantine-color-teal-light)'
                            : 'transparent',
                          transition: 'background 120ms ease',
                        }}
                      >
                        <Group justify="space-between" align="center" wrap="nowrap">
                          <Group gap="sm" align="center" style={{ flex: 1, minWidth: 0 }}>
                            <Box style={{ flexShrink: 0 }}>{action.icon}</Box>
                            <Box style={{ flex: 1, minWidth: 0 }}>
                              <Text size="sm" fw={isSelected ? 750 : 600} truncate>
                                {action.title}
                              </Text>
                              {action.subtitle && (
                                <Text size="xs" c="dimmed" truncate>
                                  {action.subtitle}
                                </Text>
                              )}
                            </Box>
                          </Group>

                          <Group gap="xs" style={{ flexShrink: 0 }}>
                            {action.badge && (
                              <Badge size="xs" color={action.badgeColor || 'gray'} variant="light">
                                {action.badge}
                              </Badge>
                            )}
                            {isSelected && (
                              <IconArrowRight size={14} color="var(--mantine-color-teal-6)" />
                            )}
                          </Group>
                        </Group>
                      </UnstyledButton>
                    );
                  })}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </ScrollArea.Autosize>

      {/* Console-style Command Palette Footer */}
      <Paper p="xs" radius={0} withBorder style={{ background: 'var(--mantine-color-default-hover)' }}>
        <Group justify="space-between" align="center">
          <Group gap="md">
            <Group gap={4} align="center">
              <Kbd size="xs">↑</Kbd>
              <Kbd size="xs">↓</Kbd>
              <Text size="xs" c="dimmed">
                Navigate
              </Text>
            </Group>
            <Group gap={4} align="center">
              <Kbd size="xs">↵</Kbd>
              <Text size="xs" c="dimmed">
                Select
              </Text>
            </Group>
            <Group gap={4} align="center">
              <Kbd size="xs">Esc</Kbd>
              <Text size="xs" c="dimmed">
                Close
              </Text>
            </Group>
          </Group>
          <Text size="xs" c="teal" fw={700}>
            LOOT Command Palette
          </Text>
        </Group>
      </Paper>
    </Modal>
  );
}
