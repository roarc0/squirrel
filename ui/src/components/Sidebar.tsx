import React from 'react';
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Kbd,
  Menu,
  Popover,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconBell,
  IconBellRinging,
  IconBriefcase,
  IconBuildingBank,
  IconCamera,
  IconChartPie,
  IconCheck,
  IconChevronRight,
  IconCompass,
  IconEye,
  IconEyeOff,
  IconFileCertificate,
  IconFlask,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMoon,
  IconRobot,
  IconSearch,
  IconSettings,
  IconSun,
  IconUser,
} from '@tabler/icons-react';
import type { AuthUser } from '../auth';
import type { Diagnostic } from '../api';
import { handleLinkClick } from '../utils/navigation';

export type ThemeAccent = 'teal' | 'amber' | 'ocean' | 'violet' | 'rose';
export type ThemeScheme = 'light' | 'dark';

export const ACCENT_HEX: Record<ThemeAccent, string> = {
  teal: '#12b886',
  amber: '#f97316',
  ocean: '#228be6',
  violet: '#7950f2',
  rose: '#e64980',
};

export const ACCENT_LABELS: Record<ThemeAccent, string> = {
  teal: 'Teal',
  amber: 'Orange',
  ocean: 'Ocean',
  violet: 'Violet',
  rose: 'Rose',
};

export const ACCENTS = Object.keys(ACCENT_HEX) as ThemeAccent[];

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: string;
  onNavigate: (tab: string) => void;
  diagnosticsCount: number;
  diagnostics: Diagnostic[];
  accountsCount: number;
  currentUser: AuthUser | null;
  hideBalances: boolean;
  onToggleHideBalances: () => void;
  onOpenUpdate: () => void;
  onOpenSearch: () => void;
  onSignOut: () => void;
  scheme: ThemeScheme;
  accent: ThemeAccent;
  onApplyTheme: (scheme: ThemeScheme, accent: ThemeAccent) => void;
  enableBtp: boolean;
  squirrelIcon: React.ReactNode;
  squirrelBrandLogo: React.ReactNode;
}

export function formatUserName(user: AuthUser | null) {
  if (!user) return 'Personal Portfolio';
  const emailPart = user.email.split('@')[0] ?? '';
  const namePart = emailPart.replace(/[0-9]+$/, '');
  if (!namePart) return emailPart;
  return namePart
    .split(/[._-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  activeTab,
  onNavigate,
  diagnosticsCount,
  diagnostics,
  accountsCount,
  currentUser,
  hideBalances,
  onToggleHideBalances,
  onOpenUpdate,
  onOpenSearch,
  onSignOut,
  scheme,
  accent,
  onApplyTheme,
  enableBtp,
  squirrelIcon,
  squirrelBrandLogo,
}: SidebarProps) {
  const userName = formatUserName(currentUser);
  const userSubtitle = currentUser?.is_admin
    ? 'Platform Admin'
    : currentUser?.email
    ? currentUser.email
    : 'Personal Portfolio';

  const navItems = [
    { key: 'overview', label: 'Overview', icon: <IconChartPie size={18} />, href: '/overview' },
    { key: 'accounts', label: 'Accounts', icon: <IconBuildingBank size={18} />, href: '/accounts', badge: accountsCount > 0 ? String(accountsCount) : undefined },
    { key: 'investments', label: 'Investments', icon: <IconBriefcase size={18} />, href: '/investments' },
    { key: 'drafts', label: 'Portfolio Sandbox', icon: <IconFlask size={18} />, href: '/drafts' },
    { key: 'instruments', label: 'Instruments', icon: <IconCompass size={18} />, href: '/instruments' },
    { key: 'market', label: 'Market Context', icon: <IconActivity size={18} />, href: '/market' },
    {
      key: 'diagnostics',
      label: 'Diagnostics',
      icon: <IconAlertTriangle size={18} />,
      href: '/diagnostics',
      badge: diagnosticsCount > 0 ? String(diagnosticsCount) : undefined,
      badgeColor: 'orange',
    },
    { key: 'consultant', label: 'AI Consultant', icon: <IconRobot size={18} />, href: '/consultant', badge: 'AI', badgeColor: 'teal' },
    ...(enableBtp
      ? [{ key: 'btp', label: 'BTP Rank', icon: <IconFileCertificate size={18} />, href: '/btp' }]
      : []),
  ];

  const renderDiagnosticsPopover = (trigger: React.ReactNode) => (
    <Popover width={360} position={collapsed ? 'right-start' : 'bottom-end'} shadow="md" radius="lg" withArrow>
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown p="sm">
        <Group justify="space-between" align="center" pb="xs" mb="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Group gap="xs">
            <IconBellRinging size={18} color="var(--mantine-color-teal-6)" />
            <Text fw={750} size="sm">Diagnostics & Warnings</Text>
          </Group>
          <Badge color={diagnosticsCount > 0 ? 'orange' : 'teal'} variant="light" size="sm">
            {diagnosticsCount} {diagnosticsCount === 1 ? 'issue' : 'issues'}
          </Badge>
        </Group>

        {diagnosticsCount === 0 ? (
          <Stack align="center" gap="xs" py="md">
            <IconCheck size={28} color="var(--mantine-color-teal-6)" />
            <Text size="sm" fw={600} c="teal">All systems optimal!</Text>
            <Text size="xs" c="dimmed" ta="center">No diagnostic warnings or allocation issues detected across your portfolio.</Text>
          </Stack>
        ) : (
          <ScrollArea.Autosize mah={360} offsetScrollbars>
            <Stack gap="xs">
              {diagnostics.map(diag => (
                <Card key={diag.id} withBorder radius="md" p="xs" style={{ background: 'var(--mantine-color-body)' }}>
                  <Group justify="space-between" align="center" mb={4}>
                    <Badge color={diag.severity === 'warning' ? 'orange' : diag.severity === 'alert' ? 'red' : 'blue'} variant="light" size="xs">
                      {diag.category.toUpperCase()}
                    </Badge>
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>{diag.severity}</Text>
                  </Group>
                  <Text fw={700} size="xs" mb={2}>{diag.title}</Text>
                  <Text size="xs" c="dimmed" lh={1.35} mb="xs">{diag.message}</Text>
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="teal"
                    onClick={() => onNavigate(diag.category === 'cash' ? 'settings' : 'investments')}
                  >
                    Resolve →
                  </Button>
                </Card>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Popover.Dropdown>
    </Popover>
  );

  const renderUserMenu = (trigger: React.ReactNode) => (
    <Menu shadow="xl" width={260} position={collapsed ? 'right-end' : 'top-start'} radius="md" withArrow>
      <Menu.Target>{trigger}</Menu.Target>
      <Menu.Dropdown p="xs">
        {currentUser && (
          <>
            <Box px="xs" py="xs">
              <Group gap="xs" align="center" mb={2}>
                <Text size="sm" fw={700}>{formatUserName(currentUser)}</Text>
                {currentUser.is_admin && <Badge size="xs" color="teal" variant="filled">admin</Badge>}
              </Group>
              <Text size="xs" c="dimmed" truncate>{currentUser.email}</Text>
              <Text
                size="10px"
                c="dimmed"
                style={{ fontFamily: 'monospace', cursor: 'pointer', marginTop: 4 }}
                title="Click to copy ID"
                onClick={() => navigator.clipboard.writeText(currentUser.google_id)}
              >
                ID: {currentUser.google_id.slice(0, 16)}...
              </Text>
            </Box>
            <Menu.Divider />
          </>
        )}

        <Menu.Item
          leftSection={hideBalances ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          onClick={onToggleHideBalances}
          rightSection={<Kbd size="xs">⌘H</Kbd>}
        >
          {hideBalances ? 'Show Balances' : 'Hide Balances'}
        </Menu.Item>

        <Menu.Item
          leftSection={<IconSettings size={15} />}
          onClick={() => onNavigate('settings')}
        >
          Settings
        </Menu.Item>

        <Menu.Divider />

        <Box px="xs" py="xs">
          <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.06em' }} mb={6}>Theme & Appearance</Text>
          <SegmentedControl
            size="xs"
            fullWidth
            value={scheme}
            onChange={v => onApplyTheme(v as ThemeScheme, accent)}
            data={[
              { value: 'light', label: <Group gap={4} justify="center"><IconSun size={13} /><span>Light</span></Group> },
              { value: 'dark', label: <Group gap={4} justify="center"><IconMoon size={13} /><span>Dark</span></Group> },
            ]}
            mb="xs"
          />
          <Group gap={8} justify="space-between" wrap="nowrap" px={2} py={2}>
            {ACCENTS.map(a => (
              <Tooltip key={a} label={ACCENT_LABELS[a]} position="top" withArrow>
                <Box
                  component="button"
                  w={22}
                  h={22}
                  onClick={() => onApplyTheme(scheme, a)}
                  aria-label={ACCENT_LABELS[a]}
                  style={{
                    borderRadius: '50%',
                    background: ACCENT_HEX[a],
                    cursor: 'pointer',
                    border: 'none',
                    padding: 0,
                    flexShrink: 0,
                    boxShadow: a === accent
                      ? `0 0 0 2px var(--mantine-color-body), 0 0 0 4px ${ACCENT_HEX[a]}`
                      : '0 1px 3px rgba(0,0,0,0.15)',
                    transform: a === accent ? 'scale(1.1)' : 'scale(1)',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                />
              </Tooltip>
            ))}
          </Group>
        </Box>

        {currentUser && (
          <>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconLogout size={15} />} onClick={onSignOut}>
              Sign out
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  if (collapsed) {
    return (
      <aside className="app-sidebar collapsed">
        {/* Top brand icon & expand toggle */}
        <Stack gap="xs" align="center" w="100%" mb="md">
          <Box
            component="a"
            href="/overview"
            onClick={(e) => handleLinkClick(e, '/overview', onNavigate)}
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'center' }}
            title="Squirrel Overview"
          >
            {squirrelIcon}
          </Box>
          <Tooltip label="Expand sidebar (⌘B)" position="right" withArrow offset={14}>
            <ActionIcon variant="subtle" color="gray" size="md" radius="md" onClick={onToggleCollapse}>
              <IconLayoutSidebarLeftExpand size={18} />
            </ActionIcon>
          </Tooltip>
        </Stack>

        <Divider w="60%" my="xs" opacity={0.6} />

        {/* Tools in collapsed state */}
        <Stack gap={6} align="center" my={2}>
          <Tooltip label="Snapshot" position="right" withArrow offset={14}>
            <ActionIcon variant="light" color="teal" size="md" radius="md" onClick={onOpenUpdate} aria-label="Snapshot">
              <IconCamera size={17} />
            </ActionIcon>
          </Tooltip>

          {renderDiagnosticsPopover(
            <Tooltip label={diagnosticsCount > 0 ? `${diagnosticsCount} Warnings` : 'Alerts'} position="right" withArrow offset={14}>
              <Box style={{ position: 'relative', display: 'inline-block' }}>
                <ActionIcon variant="subtle" color={diagnosticsCount > 0 ? 'orange' : 'gray'} size="md" radius="md">
                  {diagnosticsCount > 0 ? <IconBellRinging size={17} /> : <IconBell size={17} />}
                </ActionIcon>
                {diagnosticsCount > 0 && (
                  <Badge
                    size="xs"
                    color="orange"
                    circle
                    style={{ position: 'absolute', top: -3, right: -3, pointerEvents: 'none', height: 13, minWidth: 13, fontSize: 8 }}
                  >
                    {diagnosticsCount}
                  </Badge>
                )}
              </Box>
            </Tooltip>
          )}
        </Stack>

        {/* Nav items vertical stack */}
        <Stack gap={6} align="center" style={{ flex: 1, width: '100%', overflowY: 'auto' }} py="xs">
          {navItems.map(item => {
            const isActive = activeTab === item.key;
            return (
              <Tooltip key={item.key} label={item.label} position="right" withArrow offset={14}>
                <button
                  type="button"
                  className={`sidebar-nav-item-collapsed ${isActive ? 'active' : ''}`}
                  onClick={(e) => handleLinkClick(e, item.href, onNavigate)}
                  aria-label={item.label}
                >
                  {item.icon}
                </button>
              </Tooltip>
            );
          })}
        </Stack>

        <Divider w="60%" my="xs" opacity={0.6} />

        {/* Collapsed Bottom actions: Search, Avatar */}
        <Stack gap="xs" align="center" w="100%">
          <Tooltip label="Search (⌘K)" position="right" withArrow offset={14}>
            <ActionIcon variant="subtle" color="gray" size="lg" radius="md" onClick={onOpenSearch} aria-label="Search">
              <IconSearch size={18} />
            </ActionIcon>
          </Tooltip>

          {renderUserMenu(
            <Tooltip label={userName} position="right" withArrow offset={14}>
              <UnstyledButton style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
                {currentUser?.picture ? (
                  <Avatar src={currentUser.picture} size={32} radius="xl" />
                ) : (
                  <Avatar color="teal" radius="xl" size={32}>
                    <IconUser size={16} />
                  </Avatar>
                )}
              </UnstyledButton>
            </Tooltip>
          )}
        </Stack>
      </aside>
    );
  }

  // Expanded Sidebar
  return (
    <aside className="app-sidebar expanded">
      {/* Top row: Brand logo and collapse button */}
      <Group justify="space-between" align="center" mb="lg" px={4}>
        <Box
          component="a"
          href="/overview"
          onClick={(e) => handleLinkClick(e, '/overview', onNavigate)}
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
        >
          {squirrelBrandLogo}
        </Box>
        <Tooltip label="Collapse sidebar (⌘B)" position="bottom" withArrow>
          <ActionIcon variant="subtle" color="gray" size="sm" radius="md" onClick={onToggleCollapse}>
            <IconLayoutSidebarLeftCollapse size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Portfolio / Workspace card */}
      <Box mb="md" px={4}>
        <Group justify="space-between" align="center" mb={6}>
          <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em' }}>
            Portfolio
          </Text>
          <Group gap={6}>
            {renderDiagnosticsPopover(
              <ActionIcon variant="subtle" color={diagnosticsCount > 0 ? 'orange' : 'gray'} size="sm" radius="md" title="Diagnostics & Alerts">
                <Box style={{ position: 'relative', display: 'inline-flex' }}>
                  {diagnosticsCount > 0 ? <IconBellRinging size={14} /> : <IconBell size={14} />}
                  {diagnosticsCount > 0 && (
                    <Badge
                      size="xs"
                      color="orange"
                      circle
                      style={{ position: 'absolute', top: -4, right: -4, pointerEvents: 'none', height: 12, minWidth: 12, fontSize: 8 }}
                    >
                      {diagnosticsCount}
                    </Badge>
                  )}
                </Box>
              </ActionIcon>
            )}
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              radius="md"
              title="Settings"
              onClick={() => onNavigate('settings')}
            >
              <IconSettings size={14} />
            </ActionIcon>
          </Group>
        </Group>

        <Group
          justify="space-between"
          p="xs"
          style={{
            background: 'light-dark(#f8fafc, #161a22)',
            border: '1px solid light-dark(#e2e8f0, #21262d)',
            borderRadius: 8,
          }}
        >
          <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
            <Box
              w={7}
              h={7}
              style={{
                borderRadius: '50%',
                background: 'var(--mantine-color-teal-6)',
                boxShadow: '0 0 0 2px color-mix(in srgb, var(--mantine-color-teal-6) 25%, transparent)',
                flexShrink: 0,
              }}
            />
            <Text size="xs" fw={650} truncate>
              Main Portfolio
            </Text>
          </Group>
          <Button
            size="compact-xs"
            variant="light"
            color="teal"
            leftSection={<IconCamera size={13} />}
            onClick={onOpenUpdate}
            radius="md"
          >
            Snapshot
          </Button>
        </Group>
      </Box>

      {/* Nav items section */}
      <Box style={{ flex: 1, overflowY: 'auto' }} pr={2}>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em' }} px={8} mb={6}>
          Navigation
        </Text>
        <Stack gap={3}>
          {navItems.map(item => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                onClick={(e) => handleLinkClick(e, item.href, onNavigate)}
              >
                <Box style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  {item.icon}
                </Box>
                <Text size="xs" style={{ flex: 1, textAlign: 'left', fontWeight: isActive ? 650 : 500 }} truncate>
                  {item.label}
                </Text>
                {item.badge && (
                  <Badge
                    size="xs"
                    variant={isActive ? 'filled' : 'light'}
                    color={isActive ? 'white' : item.badgeColor ?? 'gray'}
                    styles={{
                      root: isActive ? { color: 'var(--mantine-color-teal-9)', background: 'rgba(255,255,255,0.92)' } : undefined,
                    }}
                  >
                    {item.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </Stack>
      </Box>

      <Divider my="xs" opacity={0.5} />

      {/* Bottom section: Quick Search, User card, version */}
      <Stack gap="xs" px={2} pt={4}>

        <button type="button" className="sidebar-search-btn" onClick={onOpenSearch}>
          <IconSearch size={14} style={{ opacity: 0.7 }} />
          <span style={{ flex: 1, textAlign: 'left', fontSize: 12 }}>Search portfolio...</span>
          <Kbd size="xs">⌘K</Kbd>
        </button>

        {renderUserMenu(
          <UnstyledButton className="sidebar-user-card">
            {currentUser?.picture ? (
              <Avatar src={currentUser.picture} size={30} radius="xl" />
            ) : (
              <Avatar color="teal" radius="xl" size={30}>
                <IconUser size={15} />
              </Avatar>
            )}
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <Text size="xs" fw={650} truncate lh={1.2}>
                {userName}
              </Text>
              <Text size="11px" c="dimmed" truncate lh={1.2}>
                {userSubtitle}
              </Text>
            </div>
            <IconChevronRight size={14} style={{ opacity: 0.5 }} />
          </UnstyledButton>
        )}

        <Text size="10px" c="dimmed" ta="center" style={{ letterSpacing: '0.02em' }}>
          squirrel · stash, track & grow
        </Text>
      </Stack>
    </aside>
  );
}
