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
  IconCamera,
  IconEyeOff,
  IconEye,
  IconArrowRight,
  IconSparkles,
  IconActivity,
  IconSun,
  IconMoon,
  IconPalette,
  IconRepeat,
  IconRadar2,
} from '@tabler/icons-react';
import type { Account, Instrument, BtpBond } from '../api';
import type { ThemeAccent, ThemeScheme } from './Sidebar';
import { copyToClipboard } from '../utils/copyToClipboard';

export type QuickSearchCategory = 'Navigation' | 'Quick Actions' | 'Theme & Appearance' | 'Instruments' | 'BTP Bonds';

export type QuickSearchAction = {
  id: string;
  category: QuickSearchCategory;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  keywords?: string[];
  href?: string;
  onSelect: () => void;
};

const MAX_INSTRUMENT_RESULTS = 8;
const MAX_BTP_RESULTS = 4;
const MAX_TOTAL_RESULTS = 24;

interface IndexedInstrument {
  id: number;
  name: string;
  ticker?: string;
  isin: string;
  type: string;
  searchKey: string;
}

interface IndexedBtp {
  isin: string;
  name: string;
  tier_rank: string;
  price: number;
  ytm_net: number;
  expiry_date: string;
  searchKey: string;
}

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
  scheme = 'dark',
  accent = 'amber',
  onApplyTheme,
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
  scheme?: ThemeScheme;
  accent?: ThemeAccent;
  onApplyTheme?: (scheme: ThemeScheme, accent: ThemeAccent) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query and focus input smoothly when modal opens
  useEffect(() => {
    if (opened) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        setTimeout(() => inputRef.current?.focus(), 30);
      });
    }
  }, [opened]);

  // Fast pre-computed index of instruments
  const indexedInstruments = useMemo<IndexedInstrument[]>(() => {
    return instruments.map(inst => ({
      id: inst.id,
      name: inst.name,
      ticker: inst.ticker,
      isin: inst.isin,
      type: inst.instrument_type,
      searchKey: `${inst.name} ${inst.isin} ${inst.ticker || ''} ${inst.instrument_type}`.toLowerCase(),
    }));
  }, [instruments]);

  // Fast pre-computed index of BTPs
  const indexedBtps = useMemo<IndexedBtp[]>(() => {
    return btps.map(b => ({
      isin: b.isin,
      name: b.name,
      tier_rank: b.tier_rank,
      price: b.price,
      ytm_net: b.ytm_net,
      expiry_date: b.expiry_date,
      searchKey: `${b.name} ${b.isin} ${b.tier_rank} btp bond sovereign`.toLowerCase(),
    }));
  }, [btps]);

  // Core Command Palette Actions (Navigation, Tools, Theme)
  const coreActions = useMemo<QuickSearchAction[]>(() => {
    const actions: QuickSearchAction[] = [];

    // 1. Navigation Actions
    actions.push(
      {
        id: 'nav-overview',
        category: 'Navigation',
        title: 'Overview Dashboard',
        subtitle: 'Net worth trend, KPIs, and asset allocation breakdown',
        icon: <IconChartPie size={18} color="var(--mantine-color-teal-6)" />,
        keywords: ['overview', 'dashboard', 'summary', 'net worth', 'allocation'],
        href: '/overview',
        onSelect: () => {
          onSwitchTab('overview');
          onClose();
        },
      },
      {
        id: 'nav-accounts',
        category: 'Navigation',
        title: 'Accounts & Liquidity',
        subtitle: 'Bank accounts, cash balances, and liquidity tiers',
        icon: <IconBuildingBank size={18} color="var(--mantine-color-blue-6)" />,
        keywords: ['accounts', 'cash', 'bank', 'liquidity', 'balances'],
        href: '/accounts',
        onSelect: () => {
          onSwitchTab('accounts');
          onClose();
        },
      },
      {
        id: 'nav-investments',
        category: 'Navigation',
        title: 'Investments & Holdings',
        subtitle: 'Holdings portfolio, asset values, and return metrics',
        icon: <IconBriefcase size={18} color="var(--mantine-color-teal-6)" />,
        keywords: ['investments', 'holdings', 'stocks', 'etf', 'portfolio'],
        href: '/investments',
        onSelect: () => {
          onSwitchTab('investments');
          onClose();
        },
      },
      {
        id: 'nav-pac',
        category: 'Navigation',
        title: 'PAC Accumulation Plans',
        subtitle: 'Monthly DCA plans, broker allocation targets, and progress',
        icon: <IconRepeat size={18} color="var(--mantine-color-teal-6)" />,
        keywords: ['pac', 'dca', 'accumulation', 'monthly', 'recurring', 'savings plan'],
        href: '/investments/pac',
        onSelect: () => {
          onSwitchTab('investments');
          try {
            window.history.pushState({}, '', '/investments/pac');
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch {}
          onClose();
        },
      },
      {
        id: 'nav-radar',
        category: 'Navigation',
        title: 'Geo & FX Radar',
        subtitle: 'Geographic equity exposure and currency exposure breakdown',
        icon: <IconRadar2 size={18} color="var(--mantine-color-indigo-6)" />,
        keywords: ['geo', 'fx', 'radar', 'currency', 'geography', 'exposure', 'usd', 'eur'],
        href: '/investments/radar',
        onSelect: () => {
          onSwitchTab('investments');
          try {
            window.history.pushState({}, '', '/investments/radar');
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch {}
          onClose();
        },
      },
      {
        id: 'nav-drafts',
        category: 'Navigation',
        title: 'Portfolio Sandbox (Drafts)',
        subtitle: 'Simulate rebalancing scenarios and draft allocation models',
        icon: <IconFlask size={18} color="var(--mantine-color-violet-6)" />,
        keywords: ['sandbox', 'drafts', 'simulation', 'rebalancing', 'model'],
        href: '/drafts',
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
        keywords: ['instruments', 'catalog', 'etfs', 'bonds', 'stocks', 'search'],
        href: '/instruments',
        onSelect: () => {
          onSwitchTab('instruments');
          onClose();
        },
      },
      {
        id: 'nav-btp',
        category: 'Navigation',
        title: 'BTP Rank Analytics',
        subtitle: 'Italian Sovereign Bonds yield curve and scoring',
        icon: <IconFileCertificate size={18} color="var(--mantine-color-blue-6)" />,
        keywords: ['btp', 'bonds', 'yield curve', 'ytm', 'italy', 'sovereign'],
        href: '/btp',
        onSelect: () => {
          onSwitchTab('btp');
          onClose();
        },
      },
      {
        id: 'nav-market',
        category: 'Navigation',
        title: 'Market Context',
        subtitle: 'ECB rates, €STR, inflation benchmarks, and yield curves',
        icon: <IconActivity size={18} color="var(--mantine-color-blue-6)" />,
        keywords: ['market', 'rates', 'ecb', 'estr', 'inflation', 'benchmarks', 'yields'],
        href: '/market',
        onSelect: () => {
          onSwitchTab('market');
          onClose();
        },
      },
      {
        id: 'nav-consultant',
        category: 'Navigation',
        title: 'Portfolio Copilot',
        subtitle: 'Interactive portfolio intelligence, allocation audits & advice',
        icon: <IconRobot size={18} color="var(--mantine-color-indigo-6)" />,
        keywords: ['copilot', 'advisor', 'ai consultant', 'intelligence', 'advice'],
        href: '/consultant',
        onSelect: () => {
          onSwitchTab('consultant');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        category: 'Navigation',
        title: 'Settings & Preferences',
        subtitle: 'Configure currency, target allocations, and profile',
        icon: <IconSettings size={18} color="var(--mantine-color-gray-6)" />,
        keywords: ['settings', 'preferences', 'profile', 'configuration', 'admin'],
        href: '/settings',
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
        title: 'Record Portfolio Snapshot',
        subtitle: 'Capture current holding balances and save dated snapshot',
        icon: <IconCamera size={18} color="var(--mantine-color-teal-6)" />,
        keywords: ['snapshot', 'update', 'record', 'save', 'sync', 'checkpoint'],
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
        keywords: ['privacy', 'hide', 'show', 'mask', 'balances', 'stealth'],
        onSelect: () => {
          onToggleHideBalances();
          onClose();
        },
      }
    );

    // 3. Theme & Appearance Actions
    if (onApplyTheme) {
      actions.push(
        {
          id: 'action-theme-dark',
          category: 'Theme & Appearance',
          title: 'Switch to Dark Theme',
          subtitle: scheme === 'dark' ? 'Currently active' : 'Dark slate color theme',
          icon: <IconMoon size={18} color="var(--mantine-color-indigo-4)" />,
          keywords: ['theme', 'dark', 'night', 'mode', 'appearance', 'black', 'dark mode', 'color scheme'],
          badge: scheme === 'dark' ? 'ACTIVE' : undefined,
          badgeColor: 'teal',
          onSelect: () => {
            onApplyTheme('dark', accent);
            onClose();
          },
        },
        {
          id: 'action-theme-light',
          category: 'Theme & Appearance',
          title: 'Switch to Light Theme',
          subtitle: scheme === 'light' ? 'Currently active' : 'Crisp daylight clean theme',
          icon: <IconSun size={18} color="var(--mantine-color-yellow-6)" />,
          keywords: ['theme', 'light', 'day', 'mode', 'appearance', 'white', 'light mode', 'color scheme'],
          badge: scheme === 'light' ? 'ACTIVE' : undefined,
          badgeColor: 'teal',
          onSelect: () => {
            onApplyTheme('light', accent);
            onClose();
          },
        },
        {
          id: 'action-theme-toggle',
          category: 'Theme & Appearance',
          title: 'Toggle Theme (Light / Dark)',
          subtitle: `Toggle from ${scheme} to ${scheme === 'dark' ? 'light' : 'dark'}`,
          icon: scheme === 'dark' ? <IconSun size={18} color="var(--mantine-color-yellow-6)" /> : <IconMoon size={18} color="var(--mantine-color-indigo-4)" />,
          keywords: ['theme', 'toggle theme', 'switch theme', 'invert mode'],
          onSelect: () => {
            onApplyTheme(scheme === 'dark' ? 'light' : 'dark', accent);
            onClose();
          },
        },
        {
          id: 'action-accent-amber',
          category: 'Theme & Appearance',
          title: 'Set Accent: Orange / Amber',
          subtitle: 'Warm energetic orange highlight color',
          icon: <IconPalette size={18} color="#f97316" />,
          keywords: ['accent', 'orange', 'amber', 'color', 'theme'],
          badge: accent === 'amber' ? 'ACTIVE' : undefined,
          badgeColor: 'orange',
          onSelect: () => {
            onApplyTheme(scheme, 'amber');
            onClose();
          },
        },
        {
          id: 'action-accent-teal',
          category: 'Theme & Appearance',
          title: 'Set Accent: Teal / Mint',
          subtitle: 'Clean financial emerald teal highlight color',
          icon: <IconPalette size={18} color="#12b886" />,
          keywords: ['accent', 'teal', 'mint', 'emerald', 'green', 'color', 'theme'],
          badge: accent === 'teal' ? 'ACTIVE' : undefined,
          badgeColor: 'teal',
          onSelect: () => {
            onApplyTheme(scheme, 'teal');
            onClose();
          },
        },
        {
          id: 'action-accent-ocean',
          category: 'Theme & Appearance',
          title: 'Set Accent: Ocean Blue',
          subtitle: 'Deep modern ocean blue highlight color',
          icon: <IconPalette size={18} color="#228be6" />,
          keywords: ['accent', 'ocean', 'blue', 'color', 'theme'],
          badge: accent === 'ocean' ? 'ACTIVE' : undefined,
          badgeColor: 'blue',
          onSelect: () => {
            onApplyTheme(scheme, 'ocean');
            onClose();
          },
        },
        {
          id: 'action-accent-violet',
          category: 'Theme & Appearance',
          title: 'Set Accent: Royal Violet',
          subtitle: 'Sophisticated purple violet highlight color',
          icon: <IconPalette size={18} color="#7950f2" />,
          keywords: ['accent', 'violet', 'purple', 'color', 'theme'],
          badge: accent === 'violet' ? 'ACTIVE' : undefined,
          badgeColor: 'violet',
          onSelect: () => {
            onApplyTheme(scheme, 'violet');
            onClose();
          },
        }
      );
    }

    return actions;
  }, [scheme, accent, hideBalances, onSwitchTab, onClose, onOpenUpdateModal, onToggleHideBalances, onApplyTheme]);

  // High-performance search filter:
  // When query is empty: show core actions (Navigation, Quick Actions, Theme) with ZERO instrument overhead.
  // When query is entered: search indexed instruments and BTPs with early break to keep list tiny and ultra responsive.
  const filteredActions = useMemo<QuickSearchAction[]>(() => {
    const q = query.trim().toLowerCase();

    // Default state: show top actions immediately with 0 delay
    if (!q) {
      return coreActions;
    }

    const results: QuickSearchAction[] = [];

    // 1. Search Core Actions (Navigation, Quick Actions, Theme)
    for (const a of coreActions) {
      const matchTitle = a.title.toLowerCase().includes(q);
      const matchSubtitle = a.subtitle ? a.subtitle.toLowerCase().includes(q) : false;
      const matchCategory = a.category.toLowerCase().includes(q);
      const matchKeywords = a.keywords ? a.keywords.some(k => k.toLowerCase().includes(q)) : false;

      if (matchTitle || matchSubtitle || matchCategory || matchKeywords) {
        results.push(a);
      }
    }

    // 2. Search Instruments with early termination (capped at MAX_INSTRUMENT_RESULTS)
    let instCount = 0;
    for (const inst of indexedInstruments) {
      if (inst.searchKey.includes(q)) {
        results.push({
          id: `inst-${inst.id}`,
          category: 'Instruments',
          title: inst.name,
          subtitle: `${inst.ticker || '—'} · ISIN: ${inst.isin}`,
          icon: <IconSearch size={18} color="var(--mantine-color-cyan-6)" />,
          badge: inst.type.toUpperCase(),
          badgeColor: 'cyan',
          href: '/instruments',
          onSelect: () => {
            onSwitchTab('instruments');
            copyToClipboard(inst.isin, 'ISIN');
            onClose();
          },
        });
        instCount++;
        if (instCount >= MAX_INSTRUMENT_RESULTS) break;
      }
    }

    // 3. Search BTPs with early termination (capped at MAX_BTP_RESULTS)
    let btpCount = 0;
    for (const btp of indexedBtps) {
      if (btp.searchKey.includes(q)) {
        results.push({
          id: `btp-${btp.isin}`,
          category: 'BTP Bonds',
          title: btp.name,
          subtitle: `Price: €${btp.price.toFixed(2)} · Net YTM: ${btp.ytm_net.toFixed(2)}% · Expiry: ${btp.expiry_date}`,
          icon: <IconFileCertificate size={18} color="var(--mantine-color-blue-6)" />,
          badge: `Tier ${btp.tier_rank}`,
          badgeColor: btp.tier_rank === 'S' ? 'violet' : btp.tier_rank === 'A' ? 'teal' : 'blue',
          href: '/btp',
          onSelect: () => {
            onSwitchTab('btp');
            copyToClipboard(btp.isin, 'BTP ISIN');
            onClose();
          },
        });
        btpCount++;
        if (btpCount >= MAX_BTP_RESULTS) break;
      }
    }

    return results.slice(0, MAX_TOTAL_RESULTS);
  }, [coreActions, query, indexedInstruments, indexedBtps, onSwitchTab, onClose]);

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

  // Group filtered actions by category for crisp headings
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
      className="quick-search-modal"
      transitionProps={{
        transition: 'pop',
        duration: 160,
        timingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      overlayProps={{
        backgroundOpacity: 0.45,
        blur: 4,
      }}
      styles={{
        content: {
          overflow: 'hidden',
          background: 'light-dark(#ffffff, #161b22)',
          border: '1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1))',
          boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.35)',
        },
      }}
    >
      <Box p="md" style={{ borderBottom: '1px solid light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.08))' }}>
        <TextInput
          ref={inputRef}
          leftSection={<IconSearch size={20} color="var(--mantine-color-teal-6)" />}
          placeholder="Search actions, navigation, theme (dark/light), or instruments..."
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

      <ScrollArea.Autosize mah={400} offsetScrollbars p="xs">
        {filteredActions.length === 0 ? (
          <Stack align="center" py="xl" gap="xs">
            <IconSparkles size={32} color="var(--mantine-color-dimmed)" />
            <Text fw={650} size="sm">
              No matching results found
            </Text>
            <Text size="xs" c="dimmed">
              Try typing "dark", "light", "snapshot", "pac", or an ISIN ticker.
            </Text>
          </Stack>
        ) : (
          <Stack gap="xs">
            {groupedActions.map(group => (
              <Box key={group.category}>
                <Text
                  size="11px"
                  fw={750}
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
                        component={action.href ? 'a' : 'button'}
                        href={action.href}
                        onClick={(e: React.MouseEvent) => {
                          if (action.href && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) {
                            onClose();
                            return;
                          }
                          if (action.href) {
                            e.preventDefault();
                          }
                          action.onSelect();
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          background: isSelected
                            ? 'var(--mantine-color-teal-light)'
                            : 'transparent',
                          transition: 'all 80ms ease',
                          textDecoration: 'none',
                          color: 'inherit',
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

      {/* Command Palette Footer */}
      <Paper p="xs" radius={0} style={{ background: 'light-dark(#f8fafc, #11141a)', borderTop: '1px solid light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.06))' }}>
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
          <Text size="xs" c="teal" fw={750}>
            Squirrel Palette
          </Text>
        </Group>
      </Paper>
    </Modal>
  );
}
