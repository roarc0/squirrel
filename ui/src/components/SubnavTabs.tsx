import React from 'react';
import { Box, Group, Text, Badge, UnstyledButton } from '@mantine/core';

export type SubnavTabItem<T extends string = string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
  badgeColor?: string;
};

export type SubnavTabsProps<T extends string = string> = {
  value: T;
  onChange: (value: T) => void;
  tabs: SubnavTabItem<T>[];
  rightSection?: React.ReactNode;
  size?: 'sm' | 'md';
};

export function SubnavTabs<T extends string = string>({
  value,
  onChange,
  tabs,
  rightSection,
  size = 'md',
}: SubnavTabsProps<T>) {
  return (
    <Group justify="space-between" align="center" wrap="wrap" gap="sm" mb="md">
      <Box
        className="subnav-tabs-container"
        role="tablist"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: 4,
          borderRadius: 10,
          background: 'light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.05))',
          border: '1px solid light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08))',
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.value === value;
          return (
            <UnstyledButton
              key={tab.value}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.value)}
              px={size === 'sm' ? 10 : 14}
              py={size === 'sm' ? 5 : 7}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                borderRadius: 8,
                fontSize: size === 'sm' ? 12 : 13,
                fontWeight: isActive ? 650 : 500,
                color: isActive
                  ? 'light-dark(var(--mantine-color-dark-9), var(--mantine-color-white))'
                  : 'var(--mantine-color-dimmed)',
                background: isActive
                  ? 'light-dark(#ffffff, var(--mantine-color-dark-6))'
                  : 'transparent',
                boxShadow: isActive
                  ? '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.03)'
                  : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                userSelect: 'none',
              }}
            >
              {tab.icon && (
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    color: isActive
                      ? 'var(--mantine-color-teal-6)'
                      : 'inherit',
                  }}
                >
                  {tab.icon}
                </Box>
              )}
              <Text size={size === 'sm' ? 'xs' : 'sm'} fw="inherit" c="inherit">
                {tab.label}
              </Text>
              {tab.badge !== undefined && (
                <Badge
                  size="xs"
                  variant={isActive ? 'filled' : 'light'}
                  color={tab.badgeColor ?? (isActive ? 'teal' : 'gray')}
                  style={{ pointerEvents: 'none', height: 18, padding: '0 6px' }}
                >
                  {tab.badge}
                </Badge>
              )}
            </UnstyledButton>
          );
        })}
      </Box>

      {rightSection && <Box>{rightSection}</Box>}
    </Group>
  );
}
