import { useState, useEffect } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Input,
  Popover,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconCheck,
  IconChevronDown,
  IconSearch,
  IconX,
} from '@tabler/icons-react';

export interface FacetOption {
  value: string;
  label: string;
}

interface FacetFilterSelectProps {
  label: string;
  placeholder?: string;
  options: FacetOption[];
  include: string[];
  exclude: string[];
  onChange: (include: string[], exclude: string[]) => void;
  searchable?: boolean;
}

export function FacetFilterSelect({
  label,
  placeholder = 'Any',
  options,
  include,
  exclude,
  onChange,
  searchable = false,
}: FacetFilterSelectProps) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'include' | 'exclude'>('include');

  const optionMap = new Map(options.map(opt => [opt.value, opt.label]));
  const getLabel = (val: string) => optionMap.get(val) || val;

  // Whenever popover opens, default to exclude mode if there are exclusions and no inclusions
  useEffect(() => {
    if (opened) {
      if (exclude.length > 0 && include.length === 0) {
        setMode('exclude');
      } else {
        setMode('include');
      }
      setSearch('');
    }
  }, [opened]);

  const filteredOptions = search.trim()
    ? options.filter(opt => opt.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const toggleInclude = (val: string) => {
    if (include.includes(val)) {
      onChange(include.filter(v => v !== val), exclude);
    } else {
      // Include this, remove from exclude if present
      onChange([...include, val], exclude.filter(v => v !== val));
    }
  };

  const toggleExclude = (val: string) => {
    if (exclude.includes(val)) {
      onChange(include, exclude.filter(v => v !== val));
    } else {
      // Exclude this, remove from include if present
      onChange(include.filter(v => v !== val), [...exclude, val]);
    }
  };

  const handleRowClick = (val: string) => {
    if (mode === 'exclude') {
      toggleExclude(val);
    } else {
      toggleInclude(val);
    }
  };

  const handleClear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange([], []);
  };

  const renderTriggerContent = () => {
    const hasInc = include.length > 0;
    const hasExc = exclude.length > 0;

    if (!hasInc && !hasExc) {
      return (
        <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
          {placeholder}
        </Text>
      );
    }

    if (hasInc && !hasExc) {
      if (include.length === 1) {
        return (
          <Badge size="xs" color="teal" variant="light" style={{ textTransform: 'none', maxWidth: 120 }}>
            {getLabel(include[0])}
          </Badge>
        );
      }
      return (
        <Badge size="xs" color="teal" variant="light" style={{ textTransform: 'none' }}>
          {include.length} included
        </Badge>
      );
    }

    if (!hasInc && hasExc) {
      if (exclude.length === 1) {
        return (
          <Badge size="xs" color="red" variant="light" style={{ textTransform: 'none', maxWidth: 130 }}>
            ✕ Excl: {getLabel(exclude[0])}
          </Badge>
        );
      }
      return (
        <Badge size="xs" color="red" variant="light" style={{ textTransform: 'none' }}>
          ✕ {exclude.length} excluded
        </Badge>
      );
    }

    return (
      <Group gap={3} wrap="nowrap">
        <Badge size="xs" color="teal" variant="light">+{include.length}</Badge>
        <Badge size="xs" color="red" variant="light">−{exclude.length}</Badge>
      </Group>
    );
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      shadow="md"
      radius="md"
      width={310}
      withinPortal
    >
      <Popover.Target>
        <Input.Wrapper label={label} size="xs" styles={{ label: { marginBottom: 3, fontWeight: 550, fontSize: 11 } }}>
          <UnstyledButton
            onClick={() => setOpened(o => !o)}
            style={{
              height: 30,
              minHeight: 30,
              maxHeight: 30,
              width: '100%',
              padding: '0 8px',
              borderRadius: 'var(--mantine-radius-sm)',
              border: '1px solid var(--mantine-color-default-border)',
              backgroundColor: 'var(--mantine-color-body)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              overflow: 'hidden',
              boxSizing: 'border-box',
            }}
          >
            <Box style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
              {renderTriggerContent()}
            </Box>
            <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
              {(include.length > 0 || exclude.length > 0) && (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={handleClear}
                  aria-label={`Clear ${label}`}
                >
                  <IconX size={10} />
                </ActionIcon>
              )}
              <IconChevronDown size={12} style={{ opacity: 0.6 }} />
            </Group>
          </UnstyledButton>
        </Input.Wrapper>
      </Popover.Target>

      <Popover.Dropdown p="xs">
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="xs" fw={700}>{label}</Text>
            {(include.length > 0 || exclude.length > 0) && (
              <Button size="compact-xs" variant="subtle" color="gray" onClick={() => handleClear()}>
                Clear all
              </Button>
            )}
          </Group>

          {/* Mode Switcher: Include vs Exclude */}
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={v => setMode(v as 'include' | 'exclude')}
            color={mode === 'include' ? 'teal' : 'red'}
            data={[
              {
                value: 'include',
                label: (
                  <Group gap={4} justify="center" wrap="nowrap">
                    <IconCheck size={12} color={mode === 'include' ? 'white' : 'var(--mantine-color-teal-6)'} />
                    <span>Include{include.length > 0 ? ` (${include.length})` : ''}</span>
                  </Group>
                ),
              },
              {
                value: 'exclude',
                label: (
                  <Group gap={4} justify="center" wrap="nowrap">
                    <IconX size={12} color={mode === 'exclude' ? 'white' : 'var(--mantine-color-red-6)'} />
                    <span>Exclude{exclude.length > 0 ? ` (${exclude.length})` : ''}</span>
                  </Group>
                ),
              },
            ]}
          />

          {searchable && options.length > 5 && (
            <TextInput
              size="xs"
              placeholder="Search options…"
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              leftSection={<IconSearch size={12} />}
              autoFocus
            />
          )}

          <Box style={{ maxHeight: 220, overflowY: 'auto' }}>
            <Stack gap={3}>
              {filteredOptions.map(opt => {
                const isInc = include.includes(opt.value);
                const isExc = exclude.includes(opt.value);
                return (
                  <Group
                    key={opt.value}
                    justify="space-between"
                    wrap="nowrap"
                    p={4}
                    style={{
                      borderRadius: 'var(--mantine-radius-xs)',
                      backgroundColor: isInc
                        ? 'var(--mantine-color-teal-light)'
                        : isExc
                        ? 'var(--mantine-color-red-light)'
                        : undefined,
                      cursor: 'pointer',
                      transition: 'background-color 150ms ease',
                    }}
                    onClick={() => handleRowClick(opt.value)}
                  >
                    <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                      {isInc ? (
                        <ThemeIcon size={18} radius="xl" color="teal" variant="filled">
                          <IconCheck size={11} stroke={3} />
                        </ThemeIcon>
                      ) : isExc ? (
                        <ThemeIcon size={18} radius="xl" color="red" variant="filled">
                          <IconX size={11} stroke={3} />
                        </ThemeIcon>
                      ) : (
                        <Box
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            border: '1.5px solid var(--mantine-color-gray-4)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <Text
                        size="xs"
                        fw={isInc || isExc ? 600 : 400}
                        c={isInc ? 'teal' : isExc ? 'red' : undefined}
                        truncate
                      >
                        {opt.label}
                      </Text>
                    </Group>

                    {/* Direct action buttons: [+ In] and [− Ex] */}
                    <Group gap={3} wrap="nowrap" style={{ flexShrink: 0 }}>
                      <Tooltip label={isInc ? 'Remove inclusion' : 'Include (only show this)'}>
                        <Button
                          size="compact-xs"
                          color="teal"
                          variant={isInc ? 'filled' : 'subtle'}
                          onClick={e => {
                            e.stopPropagation();
                            toggleInclude(opt.value);
                          }}
                          styles={{ root: { paddingLeft: 6, paddingRight: 6, height: 22, fontSize: 11 } }}
                        >
                          {isInc ? '✓ In' : '+ In'}
                        </Button>
                      </Tooltip>
                      <Tooltip label={isExc ? 'Remove exclusion' : 'Exclude (hide this)'}>
                        <Button
                          size="compact-xs"
                          color="red"
                          variant={isExc ? 'filled' : 'subtle'}
                          onClick={e => {
                            e.stopPropagation();
                            toggleExclude(opt.value);
                          }}
                          styles={{ root: { paddingLeft: 6, paddingRight: 6, height: 22, fontSize: 11 } }}
                        >
                          {isExc ? '✕ Ex' : '− Ex'}
                        </Button>
                      </Tooltip>
                    </Group>
                  </Group>
                );
              })}
              {filteredOptions.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" py="xs">No options found</Text>
              )}
            </Stack>
          </Box>

          <Text size="10px" c="dimmed" ta="center">
            Click row to {mode === 'include' ? 'include' : 'exclude'} · or use [In] / [Ex] buttons
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
