import React, { useCallback, useEffect, useState } from 'react';
import {
  IconChartPie,
  IconBuildingBank,
  IconBriefcase,
  IconFlask,
  IconSearch,
  IconActivity,
  IconRobot,
  IconExternalLink,
  IconArrowsExchange,
  IconRefresh,
  IconPencil,
  IconTrash,
  IconStar,
  IconStarFilled,
  IconUser,
  IconEye,
  IconEyeOff,
  IconPalette,
  IconSettings,
  IconTrendingUp,
  IconTrendingDown,
  IconFileCertificate,
  IconBell,
  IconBellRinging,
  IconCheck,
  IconSun,
  IconMoon,
} from '@tabler/icons-react';
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Grid,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Pagination,
  Paper,
  Popover,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Menu,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core';
import { api, instrumentClient, type Account, type Diagnostic, type Instrument, type InstrumentAlternative, type InstrumentType, type Holding, type RankedInstrument, type ReferenceRate, type Snapshot, type Summary, type TaxRate } from './api';
import { Chip, chipColor } from './Chip';
import { DataTable, TableAction, TableActions, type DataColumn, type SortDirection } from './DataTable';
import { CompareModal } from './CompareModal';
import { AppSkeleton } from './components/AppSkeleton';
import { InvestModal } from './InvestModal';
import { SettingsView } from './SettingsView';
import { UpdateSituationModal } from './UpdateSituationModal';
import { OverviewView } from './views/OverviewView';
import { AccountsView } from './views/AccountsView';
import { InvestmentsView } from './views/InvestmentsView';
import { InstrumentFinderView } from './views/InstrumentFinderView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { AIConsultantView } from './views/AIConsultantView';
import { DraftPortfoliosView } from './views/DraftPortfoliosView';
import { BtpRankView } from './views/BtpRankView';
import { chartGeometry, matchesExactFilters, pageBounds, performanceMood } from './visual';

type Data = { summary: Summary; accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; instruments: Instrument[]; holdings: Holding[]; snapshots: Snapshot[] };
type Numeric = string | number;
import { money, investedMoney, setHideBalancesState } from './utils/format';
import { captureTokenFromURL, clearToken, fetchMe, isUnauthenticatedError, type AuthUser } from './auth';
import { LoginView } from './LoginView';
import { loadProfile, useProfile } from './hooks/useProfile';

type ThemeAccent = 'teal' | 'amber' | 'ocean' | 'violet' | 'rose';
type ThemeScheme = 'light' | 'dark';

const ACCENT_HEX: Record<ThemeAccent, string> = {
  teal: '#12b886', amber: '#fab005', ocean: '#228be6', violet: '#7950f2', rose: '#e64980',
};
const ACCENT_LABELS: Record<ThemeAccent, string> = {
  teal: 'Teal', amber: 'Amber', ocean: 'Ocean', violet: 'Violet', rose: 'Rose',
};
const ACCENTS = Object.keys(ACCENT_HEX) as ThemeAccent[];

const TEAL_VAR_KEYS = [
  '--mantine-color-teal-0', '--mantine-color-teal-1', '--mantine-color-teal-2',
  '--mantine-color-teal-3', '--mantine-color-teal-4', '--mantine-color-teal-5',
  '--mantine-color-teal-6', '--mantine-color-teal-7', '--mantine-color-teal-8', '--mantine-color-teal-9',
  '--mantine-color-teal-filled', '--mantine-color-teal-filled-hover',
  '--mantine-color-teal-light', '--mantine-color-teal-light-hover', '--mantine-color-teal-light-color',
  '--mantine-color-teal-outline', '--mantine-color-teal-outline-hover',
];

const ACCENT_VARS: Record<ThemeAccent, Record<string, string>> = {
  teal: {},
  amber: {
    '--mantine-color-teal-0': '#fff9db', '--mantine-color-teal-1': '#fff3bf', '--mantine-color-teal-2': '#ffec99',
    '--mantine-color-teal-3': '#ffe066', '--mantine-color-teal-4': '#ffd43b', '--mantine-color-teal-5': '#fcc419',
    '--mantine-color-teal-6': '#fab005', '--mantine-color-teal-7': '#f59f00', '--mantine-color-teal-8': '#e67700', '--mantine-color-teal-9': '#d9480f',
    '--mantine-color-teal-filled': '#fab005', '--mantine-color-teal-filled-hover': '#f59f00',
    '--mantine-color-teal-light': 'rgba(250,176,5,0.12)', '--mantine-color-teal-light-hover': 'rgba(250,176,5,0.15)',
    '--mantine-color-teal-light-color': '#e67700', '--mantine-color-teal-outline': '#fab005', '--mantine-color-teal-outline-hover': 'rgba(250,176,5,0.05)',
  },
  ocean: {
    '--mantine-color-teal-0': '#e7f5ff', '--mantine-color-teal-1': '#d0ebff', '--mantine-color-teal-2': '#a5d8ff',
    '--mantine-color-teal-3': '#74c0fc', '--mantine-color-teal-4': '#4dabf7', '--mantine-color-teal-5': '#339af0',
    '--mantine-color-teal-6': '#228be6', '--mantine-color-teal-7': '#1c7ed6', '--mantine-color-teal-8': '#1971c2', '--mantine-color-teal-9': '#1864ab',
    '--mantine-color-teal-filled': '#228be6', '--mantine-color-teal-filled-hover': '#1c7ed6',
    '--mantine-color-teal-light': 'rgba(34,139,230,0.12)', '--mantine-color-teal-light-hover': 'rgba(34,139,230,0.15)',
    '--mantine-color-teal-light-color': '#1c7ed6', '--mantine-color-teal-outline': '#228be6', '--mantine-color-teal-outline-hover': 'rgba(34,139,230,0.05)',
  },
  violet: {
    '--mantine-color-teal-0': '#f3f0ff', '--mantine-color-teal-1': '#e5dbff', '--mantine-color-teal-2': '#d0bfff',
    '--mantine-color-teal-3': '#b197fc', '--mantine-color-teal-4': '#9775fa', '--mantine-color-teal-5': '#845ef7',
    '--mantine-color-teal-6': '#7950f2', '--mantine-color-teal-7': '#6741d9', '--mantine-color-teal-8': '#5f3dc4', '--mantine-color-teal-9': '#5c37b8',
    '--mantine-color-teal-filled': '#7950f2', '--mantine-color-teal-filled-hover': '#6741d9',
    '--mantine-color-teal-light': 'rgba(121,80,242,0.15)', '--mantine-color-teal-light-hover': 'rgba(121,80,242,0.18)',
    '--mantine-color-teal-light-color': '#9775fa', '--mantine-color-teal-outline': '#7950f2', '--mantine-color-teal-outline-hover': 'rgba(121,80,242,0.07)',
  },
  rose: {
    '--mantine-color-teal-0': '#fff0f6', '--mantine-color-teal-1': '#ffdeeb', '--mantine-color-teal-2': '#fcc2d7',
    '--mantine-color-teal-3': '#faa2c1', '--mantine-color-teal-4': '#f783ac', '--mantine-color-teal-5': '#f06595',
    '--mantine-color-teal-6': '#e64980', '--mantine-color-teal-7': '#d6336c', '--mantine-color-teal-8': '#c2255c', '--mantine-color-teal-9': '#a61e4d',
    '--mantine-color-teal-filled': '#e64980', '--mantine-color-teal-filled-hover': '#d6336c',
    '--mantine-color-teal-light': 'rgba(230,73,128,0.15)', '--mantine-color-teal-light-hover': 'rgba(230,73,128,0.18)',
    '--mantine-color-teal-light-color': '#f06595', '--mantine-color-teal-outline': '#e64980', '--mantine-color-teal-outline-hover': 'rgba(230,73,128,0.07)',
  },
};

function applyAccentVars(a: ThemeAccent) {
  TEAL_VAR_KEYS.forEach(k => document.documentElement.style.removeProperty(k));
  Object.entries(ACCENT_VARS[a]).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}

export function useBackendRows<T>(endpoint: string, source: T[], initialSort = '', initialDirection: SortDirection = 'asc') {
  const [rows, setRows] = useState(source);
  const [sort, setSort] = useState(initialSort);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const [sortError, setSortError] = useState('');
  useEffect(() => { setRows(source); setSort(initialSort); setDirection(initialDirection); }, [source, initialSort, initialDirection]);
  const sortRows = async (key: string, next: SortDirection) => {
    try {
      setRows(await api<T[]>(`${endpoint}?sort=${encodeURIComponent(key)}&direction=${next}`) ?? []);
      setSort(key); setDirection(next); setSortError('');
    } catch (cause) { setSortError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return { rows, sort, direction, sortError, sortRows };
}

export function LootChestIcon({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="lootChestGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--mantine-color-teal-4, #20c997)" />
          <stop offset="100%" stopColor="var(--mantine-color-teal-7, #0ca678)" />
        </linearGradient>
        <linearGradient id="lootGoldGrad" x1="10" y1="8" x2="14" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffd43b" />
          <stop offset="100%" stopColor="#f59f00" />
        </linearGradient>
      </defs>

      {/* Chest Base Body */}
      <rect
        x="3"
        y="11"
        width="18"
        height="9"
        rx="2"
        fill="url(#lootChestGrad)"
        fillOpacity="0.18"
        stroke="url(#lootChestGrad)"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />

      {/* Chest Domed Lid */}
      <path
        d="M3.5 11C3.5 6.5 7 4 12 4C17 4 20.5 6.5 20.5 11H3.5Z"
        fill="url(#lootChestGrad)"
        fillOpacity="0.3"
        stroke="url(#lootChestGrad)"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />

      {/* Center Lock / Keyhole Clasp */}
      <rect
        x="9.5"
        y="9.5"
        width="5"
        height="5"
        rx="1"
        fill="url(#lootGoldGrad)"
        stroke="rgba(0,0,0,0.3)"
        strokeWidth="0.5"
      />
      <circle cx="12" cy="11.5" r="0.8" fill="#121212" />

      {/* Metallic Straps */}
      <line x1="7" y1="4.5" x2="7" y2="19.5" stroke="url(#lootChestGrad)" strokeWidth="1.2" opacity="0.6" />
      <line x1="17" y1="4.5" x2="17" y2="19.5" stroke="url(#lootChestGrad)" strokeWidth="1.2" opacity="0.6" />

      {/* Golden Sparkle */}
      <path
        d="M19.5 2.5L20 4L21.5 4.5L20 5L19.5 6.5L19 5L17.5 4.5L19 4L19.5 2.5Z"
        fill="#ffd43b"
      />
    </svg>
  );
}

export function formatUserName(user?: AuthUser | null): string {
  if (!user || !user.email) return 'Account';
  const namePart = user.email.split('@')[0];
  return namePart
    .split(/[._-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function App() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    captureTokenFromURL();
    try {
      const [summary, accounts, rates, taxRates, instruments, holdings, snapshots] = await Promise.all([
        api<Summary>('/api/summary'),
        api<Account[]>('/api/accounts'),
        api<ReferenceRate[]>('/api/reference-rates'),
        api<TaxRate[]>('/api/tax-rates'),
        api<Instrument[]>('/api/instruments'),
        api<Holding[]>('/api/holdings'),
        api<Snapshot[]>('/api/snapshots'),
      ]);
      setData({ summary, accounts: accounts ?? [], rates: rates ?? [], taxRates: taxRates ?? [], instruments: instruments ?? [], holdings: holdings ?? [], snapshots: snapshots ?? [] });
      setNeedsLogin(false);
      setError('');
      fetchMe().then(u => setCurrentUser(u));
      void loadProfile();
    } catch (cause) {
      if (isUnauthenticatedError(cause)) {
        setNeedsLogin(true);
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const [updateModalOpened, setUpdateModalOpened] = useState(false);

  const VALID_TABS = ['overview', 'accounts', 'investments', 'holdings', 'drafts', 'instruments', 'diagnostics', 'consultant', 'advisor', 'btp', 'settings'];

  const [activeTab, setActiveTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const rawTab = params.get('tab');
    const urlTab = rawTab === 'holdings' ? 'investments' : rawTab === 'advisor' ? 'consultant' : rawTab;
    if (urlTab && VALID_TABS.includes(urlTab)) {
      return urlTab;
    }
    if (params.has('similarity')) {
      return 'instruments';
    }
    try {
      const saved = localStorage.getItem('loot.activeTab');
      const normSaved = saved === 'holdings' ? 'investments' : saved === 'advisor' ? 'consultant' : saved;
      if (normSaved && VALID_TABS.includes(normSaved)) {
        return normSaved;
      }
    } catch {
      /* optional */
    }
    return 'overview';
  });

  const handleTabChange = (val: string | null) => {
    const next = val || 'overview';
    setActiveTab(next);
    try {
      localStorage.setItem('loot.activeTab', next);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.pushState({}, '', url.toString());
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab') || 'overview';
      if (VALID_TABS.includes(tab)) {
        setActiveTab(tab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [profile, setProfileField] = useProfile();
  const hideBalances = profile.hide_balances;
  const setHideBalances = (fn: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof fn === 'function' ? fn(profile.hide_balances) : fn;
    setProfileField({ hide_balances: next });
  };

  useEffect(() => {
    setHideBalancesState(hideBalances);
  }, [hideBalances]);

  if (needsLogin) return <LoginView />;
  if (!data) {
    return (
      <main className="shell">
        {error ? <Alert color="red">{error}</Alert> : <AppSkeleton />}
      </main>
    );
  }

  const diagnosticsCount = data.summary.diagnostics?.length ?? 0;
  return (
  <>
    <main className="shell">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="xs" align="center">
          <LootChestIcon size={26} />
          <Title order={1} size="1.75rem" className="brand" c="teal">LOOT</Title>
        </Group>
        <Group gap={10}>
          <HeaderIconButton icon={<IconArrowsExchange size={16} />} label="Update" onClick={() => setUpdateModalOpened(true)} />
          <ThemePickerButton />
          <Popover width={380} position="bottom-end" shadow="md" radius="lg" withArrow>
            <Popover.Target>
              <Box style={{ position: 'relative', display: 'inline-block' }}>
                <HeaderIconButton
                  icon={diagnosticsCount > 0 ? <IconBellRinging size={16} color="var(--mantine-color-orange-6)" /> : <IconBell size={16} />}
                  label="Alerts"
                />
                {diagnosticsCount > 0 && (
                  <Badge
                    size="xs"
                    color="orange"
                    circle
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      pointerEvents: 'none',
                      fontSize: 10,
                      height: 16,
                      minWidth: 16,
                    }}
                  >
                    {diagnosticsCount}
                  </Badge>
                )}
              </Box>
            </Popover.Target>
            <Popover.Dropdown p="sm">
              <Group justify="space-between" align="center" pb="xs" mb="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Group gap="xs">
                  <IconBellRinging size={18} color="var(--mantine-color-teal-6)" />
                  <Text fw={750} size="sm">
                    Diagnostics & Warnings
                  </Text>
                </Group>
                <Badge color={diagnosticsCount > 0 ? 'orange' : 'teal'} variant="light" size="sm">
                  {diagnosticsCount} {diagnosticsCount === 1 ? 'issue' : 'issues'}
                </Badge>
              </Group>

              {diagnosticsCount === 0 ? (
                <Stack align="center" gap="xs" py="md">
                  <IconCheck size={28} color="var(--mantine-color-teal-6)" />
                  <Text size="sm" fw={600} c="teal">
                    All systems optimal!
                  </Text>
                  <Text size="xs" c="dimmed" ta="center">
                    No diagnostic warnings or allocation issues detected across your portfolio.
                  </Text>
                </Stack>
              ) : (
                <ScrollArea.Autosize mah={360} offsetScrollbars>
                  <Stack gap="xs">
                    {data.summary.diagnostics?.map(diag => (
                      <Card key={diag.id} withBorder radius="md" p="xs" style={{ background: 'var(--mantine-color-body)' }}>
                        <Group justify="space-between" align="center" mb={4}>
                          <Badge
                            color={diag.severity === 'warning' ? 'orange' : diag.severity === 'alert' ? 'red' : 'blue'}
                            variant="light"
                            size="xs"
                          >
                            {diag.category.toUpperCase()}
                          </Badge>
                          <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                            {diag.severity}
                          </Text>
                        </Group>
                        <Text fw={700} size="xs" mb={2}>
                          {diag.title}
                        </Text>
                        <Text size="xs" c="dimmed" lh={1.35} mb="xs">
                          {diag.message}
                        </Text>
                        {diag.category === 'cash' && (
                          <Button size="compact-xs" variant="light" color="teal" onClick={() => handleTabChange('settings')}>
                            Configure Reserve →
                          </Button>
                        )}
                        {diag.category === 'drift' && (
                          <Button size="compact-xs" variant="light" color="teal" onClick={() => handleTabChange('investments')}>
                            Rebalance Portfolio →
                          </Button>
                        )}
                      </Card>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              )}
            </Popover.Dropdown>
          </Popover>
          {currentUser ? (
            <Menu shadow="md" width={240} position="bottom-end">
              <Menu.Target>
                <HeaderIconButton
                  icon={currentUser.picture
                    ? <Avatar src={currentUser.picture} size={20} radius="xl" />
                    : <IconUser size={16} />}
                  label={formatUserName(currentUser)}
                />
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  <Stack gap={2}>
                    <Group gap="xs" align="center">
                      <Text size="sm" fw={600}>{currentUser.email}</Text>
                      {currentUser.is_admin && <Badge size="xs" color="teal">admin</Badge>}
                    </Group>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ fontFamily: 'monospace', cursor: 'pointer', wordBreak: 'break-all' }}
                      title="Click to copy"
                      onClick={() => navigator.clipboard.writeText(currentUser.google_id)}
                    >
                      {currentUser.google_id}
                    </Text>
                  </Stack>
                </Menu.Label>
                <Menu.Divider />
                <Menu.Item
                  leftSection={hideBalances ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  onClick={() => setHideBalances(v => !v)}
                >
                  {hideBalances ? 'Show Balances' : 'Hide Balances'}
                </Menu.Item>
                <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => handleTabChange('settings')}>
                  Settings
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  onClick={() => { clearToken(); setNeedsLogin(true); setCurrentUser(null); setData(undefined); }}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </Group>
      </Group>
      {error && <Alert color="red" mb="md" withCloseButton onClose={() => setError('')}>{error}</Alert>}
      <Tabs value={activeTab} onChange={handleTabChange} keepMounted={false}>
        <Tabs.List mb="xl">
          <Tabs.Tab value="overview" leftSection={<IconChartPie size={16} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="accounts" leftSection={<IconBuildingBank size={16} />}>
            Accounts
          </Tabs.Tab>
          <Tabs.Tab value="investments" leftSection={<IconBriefcase size={16} />}>
            Investments
          </Tabs.Tab>
          <Tabs.Tab value="drafts" leftSection={<IconFlask size={16} />}>
            Portfolio Sandbox
          </Tabs.Tab>
          <Tabs.Tab value="instruments" leftSection={<IconSearch size={16} />}>
            Instruments
          </Tabs.Tab>
          <Tabs.Tab value="consultant" leftSection={<IconRobot size={16} />}>
            AI Consultant
          </Tabs.Tab>
          {profile.enable_btp_ranks && (
            <Tabs.Tab value="btp" leftSection={<IconFileCertificate size={16} />}>
              BTP Rank
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="overview" className="tab-content"><Overview data={data} reload={load} onSwitchTab={handleTabChange} /></Tabs.Panel>
        <Tabs.Panel value="accounts" className="tab-content"><Accounts accounts={data.accounts} rates={data.rates} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="investments" className="tab-content"><Investments holdings={data.holdings} accounts={data.accounts} instruments={data.instruments} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="holdings" className="tab-content"><Investments holdings={data.holdings} accounts={data.accounts} instruments={data.instruments} taxRates={data.taxRates} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="drafts" className="tab-content">
          <DraftPortfoliosView
            holdings={data.holdings}
            instruments={data.instruments}
            accounts={data.accounts}
            reload={load}
          />
        </Tabs.Panel>
        <Tabs.Panel value="instruments" className="tab-content"><InstrumentFinder instruments={data.instruments} reload={load} /></Tabs.Panel>
        <Tabs.Panel value="diagnostics" className="tab-content">
          <DiagnosticsTab
            diagnostics={data.summary.diagnostics ?? []}
            onOpenSettings={() => handleTabChange('settings')}
            onOpenInvest={() => handleTabChange('investments')}
          />
        </Tabs.Panel>
        <Tabs.Panel value="consultant" className="tab-content">
          <AIConsultantView
            summary={data.summary}
            accounts={data.accounts}
            holdings={data.holdings}
            instruments={data.instruments}
          />
        </Tabs.Panel>
        <Tabs.Panel value="advisor" className="tab-content">
          <AIConsultantView
            summary={data.summary}
            accounts={data.accounts}
            holdings={data.holdings}
            instruments={data.instruments}
          />
        </Tabs.Panel>
        <Tabs.Panel value="btp" className="tab-content">
          <BtpRankView />
        </Tabs.Panel>
        <Tabs.Panel value="settings" className="tab-content">
          <SettingsView reload={load} />
        </Tabs.Panel>
      </Tabs>
      <UpdateSituationModal
        opened={updateModalOpened}
        onClose={() => setUpdateModalOpened(false)}
        accounts={data.accounts}
        holdings={data.holdings}
        reload={load}
      />
    </main>
    <footer className="app-footer">
      <Text size="xs" c="dimmed">LOOT · Know what you own</Text>
    </footer>
  </>
  );
}

function DiagnosticsTab({
  diagnostics,
  onOpenSettings,
  onOpenInvest,
}: {
  diagnostics: Diagnostic[];
  onOpenSettings: () => void;
  onOpenInvest: () => void;
}) {
  return (
    <DiagnosticsView
      diagnostics={diagnostics}
      onOpenSettings={onOpenSettings}
      onOpenInvest={onOpenInvest}
    />
  );
}

function Overview({ data, reload, onSwitchTab }: { data: Data; reload: () => Promise<void>; onSwitchTab: (tab: string) => void }) {
  return <OverviewView data={data} reload={reload} onSwitchTab={onSwitchTab} />;
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">{label}</Text><Text size="xl" fw={750} mt={4} className={positive ? 'positive' : ''}>{value}</Text></Card>;
}

function InvestmentMetric({ value, invested, currency }: { value: number; invested: number; currency: string }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">Investments</Text><Text size="xl" fw={750} mt={4}>{money(value, currency)}</Text><Text size="xs" c="dimmed" mt={5}>Invested {investedMoney(invested, value, currency)}</Text></Card>;
}

function PerformanceMetric({ value, invested, currency }: { value: number; invested: number; currency: string }) {
  return <Card className="metric" p="lg" radius="lg"><Text size="sm" c="dimmed">Investment trend</Text><Group mt={10} align="center"><PerformanceResult value={value} invested={invested} currency={currency} mood /></Group></Card>;
}

export function PerformanceResult({ value, invested, currency, mood = false }: { value: number; invested: number; currency: string; mood?: boolean }) {
  if (invested <= 0) return <Text size="sm" c="dimmed">—</Text>;
  const change = value - invested; const changePercent = change / invested * 100; const state = performanceMood(changePercent);
  return (
    <Group gap={4} wrap="nowrap" align="center">
      {mood && <Text title={state.label} size="lg" lh={1}>{state.emoji}</Text>}
      {change >= 0 ? <IconTrendingUp size={14} color="var(--mantine-color-teal-6)" /> : <IconTrendingDown size={14} color="var(--mantine-color-red-6)" />}
      <Text size="sm" fw={700} c={change >= 0 ? 'teal' : 'red'}>
        {change >= 0 ? '+' : ''}{money(change, currency)} · {change >= 0 ? '+' : ''}{changePercent.toFixed(1)}%
      </Text>
    </Group>
  );
}

const HeaderIconButton = React.forwardRef<HTMLButtonElement, { icon: React.ReactNode; label: string; onClick?: () => void }>(
  ({ icon, label, onClick }, ref) => (
    <button ref={ref} type="button" onClick={onClick} aria-label={label} className="header-btn">
      {icon}
      <Text size="xs" fw={500} lh={1}>{label}</Text>
    </button>
  )
);

function ThemePickerButton() {
  const { setColorScheme } = useMantineColorScheme();
  const [, setProfileField] = useProfile();
  const [scheme, setScheme] = useState<ThemeScheme>(() => {
    const s = localStorage.getItem('loot.scheme');
    return s === 'light' ? 'light' : 'dark';
  });
  const [accent, setAccent] = useState<ThemeAccent>(() => {
    const a = localStorage.getItem('loot.accent') as ThemeAccent | null;
    return a && a in ACCENT_HEX ? a : 'teal';
  });

  useEffect(() => {
    applyAccentVars(accent);
    document.documentElement.setAttribute('data-accent', accent);
    setColorScheme(scheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (s: ThemeScheme, a: ThemeAccent) => {
    localStorage.setItem('loot.scheme', s);
    localStorage.setItem('loot.accent', a);
    applyAccentVars(a);
    document.documentElement.setAttribute('data-accent', a);
    setProfileField({ theme: `${s}:${a}` });
    if ('startViewTransition' in document) {
      (document as any).startViewTransition(() => setColorScheme(s));
    } else {
      setColorScheme(s);
    }
  };

  return (
    <Popover position="bottom-end" withArrow shadow="md" width={184}>
      <Popover.Target>
        <HeaderIconButton
          icon={
            <Box style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {scheme === 'light' ? (
                <IconSun size={16} color="var(--mantine-color-yellow-5)" />
              ) : (
                <IconMoon size={16} color="var(--mantine-color-indigo-3)" />
              )}
              <Box
                w={6}
                h={6}
                style={{
                  borderRadius: '50%',
                  background: ACCENT_HEX[accent],
                  position: 'absolute',
                  bottom: -2,
                  right: -3,
                  border: '1px solid var(--mantine-color-body)',
                }}
              />
            </Box>
          }
          label="Theme"
        />
      </Popover.Target>
      <Popover.Dropdown p={12}>
        <Stack gap={8}>
          <Text size="11px" fw={700} c="dimmed" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Mode</Text>
          <SegmentedControl
            size="xs"
            fullWidth
            value={scheme}
            onChange={v => { const s = v as ThemeScheme; setScheme(s); apply(s, accent); }}
            data={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          />
          <Divider my={2} />
          <Text size="11px" fw={700} c="dimmed" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Accent</Text>
          <Group gap={8} wrap="nowrap">
            {ACCENTS.map(a => (
              <Tooltip key={a} label={ACCENT_LABELS[a]} position="bottom" withArrow>
                <Box
                  component="button"
                  w={26} h={26}
                  onClick={() => { setAccent(a); apply(scheme, a); }}
                  aria-label={ACCENT_LABELS[a]}
                  style={{
                    borderRadius: '50%',
                    background: ACCENT_HEX[a],
                    cursor: 'pointer',
                    border: 'none',
                    padding: 0,
                    flexShrink: 0,
                    outline: a === accent ? `2px solid ${ACCENT_HEX[a]}` : '2px solid transparent',
                    outlineOffset: 3,
                    transform: a === accent ? 'scale(1.18)' : 'scale(1)',
                    transition: 'transform 0.12s ease, outline-color 0.12s ease',
                  }}
                />
              </Tooltip>
            ))}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function AllocationBar({
  segments,
  total,
  selectedKey,
  onSelectKey,
}: {
  segments: { label: string; value: number; key?: string }[];
  total: number;
  selectedKey?: string | null;
  onSelectKey?: (key: string | null) => void;
}) {
  const visible = segments.filter(segment => segment.value > 0);

  return (
    <Stack gap="xs" mt="sm">
      <Box
        h={14}
        bg="light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))"
        style={{ display: 'flex', overflow: 'hidden', borderRadius: 999 }}
      >
        {visible.map(segment => {
          const itemKey = segment.key ?? segment.label.toLowerCase();
          const isSelected = selectedKey === itemKey;
          const isDimmed = Boolean(selectedKey && !isSelected);
          const pct = total > 0 ? (segment.value / total) * 100 : 0;

          return (
            <Tooltip
              key={segment.label}
              label={`${segment.label}: ${pct.toFixed(1)}% (${money(segment.value, 'EUR')})${onSelectKey ? ' · Click to filter' : ''}`}
              withArrow
            >
              <Box
                bg={`${chipColor(segment.label)}.5`}
                onClick={() => onSelectKey?.(isSelected ? null : itemKey)}
                style={{
                  width: `${pct}%`,
                  cursor: onSelectKey ? 'pointer' : 'default',
                  opacity: isDimmed ? 0.35 : 1,
                  transition: 'opacity 0.2s ease, transform 0.15s ease',
                  transform: isSelected ? 'scaleY(1.2)' : 'scaleY(1)',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Group gap="xs">
        {visible.map(segment => {
          const itemKey = segment.key ?? segment.label.toLowerCase();
          const isSelected = selectedKey === itemKey;
          const pct = total > 0 ? (segment.value / total) * 100 : 0;
          return (
            <UnstyledButton
              key={segment.label}
              disabled={!onSelectKey}
              onClick={() => onSelectKey?.(isSelected ? null : itemKey)}
            >
              <Chip
                colorKey={segment.label}
                variant={isSelected ? 'filled' : 'light'}
                style={{
                  cursor: onSelectKey ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                  boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
                }}
              >
                {`${segment.label} ${pct.toFixed(1)}%`}
              </Chip>
            </UnstyledButton>
          );
        })}
      </Group>
    </Stack>
  );
}

type TierDraft = { upTo: Numeric; kind: 'fixed' | 'reference'; rate: Numeric; reference: string; spread: Numeric };
type AccountDraft = { name: string; institution: string; type: Account['type']; preferred: boolean; archived: boolean; currency: string; balance: Numeric; tax: Numeric; fee: Numeric; tiers: TierDraft[] };
const blankTier = (): TierDraft => ({ upTo: '', kind: 'fixed', rate: 0, reference: '', spread: 0 });
const blankAccount = (tax = 26): AccountDraft => ({ name: '', institution: '', type: 'bank', preferred: false, archived: false, currency: 'EUR', balance: 0, tax, fee: 0, tiers: [blankTier()] });

function Accounts({ accounts, rates, taxRates, reload }: { accounts: Account[]; rates: ReferenceRate[]; taxRates: TaxRate[]; reload: () => Promise<void> }) {
  return <AccountsView accounts={accounts} rates={rates} taxRates={taxRates} reload={reload} />;
}

type HoldingDraft = { accountID: string; instrumentID: string; value: Numeric; sinceBuy: Numeric; planned: Numeric; tax: Numeric };

function Investments({ holdings, accounts, instruments, taxRates, reload, onOpenDrafts }: { holdings: Holding[]; accounts: Account[]; instruments: Instrument[]; taxRates: TaxRate[]; reload: () => Promise<void>; onOpenDrafts?: () => void }) {
  return <InvestmentsView holdings={holdings} accounts={accounts} instruments={instruments} taxRates={taxRates} reload={reload} onOpenDrafts={onOpenDrafts} />;
}

function InstrumentFinder({ instruments, reload }: { instruments: Instrument[]; reload: () => Promise<void> }) {
  return <InstrumentFinderView instruments={instruments} reload={reload} />;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <Card className="metric" p="xl" radius="lg"><Text fw={700}>{title}</Text><Text size="sm" c="dimmed" mt={4}>{text}</Text></Card>;
}
