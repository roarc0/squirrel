import { useState } from 'react';
import {
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  createHolding,
  updateHolding,
  type Account,
  type Holding,
  type Instrument,
  type TaxRate,
} from '../api';
import { availablePacBps, availablePacPercent } from '../utils/pac';
import { instrumentLabels, money, percent } from '../utils/format';

type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

export type HoldingDraft = {
  accountID: string;
  instrumentID: string;
  value: Numeric;
  sinceBuy: Numeric;
  pac: Numeric;
  tax: Numeric;
  notes: string;
};

export interface HoldingModalProps {
  opened: boolean;
  close: () => void;
  holding?: Holding;
  accounts: Account[];
  instruments: Instrument[];
  taxRates: TaxRate[];
  holdings: Holding[];
  defaultAccountID?: string;
  saved: () => Promise<void>;
}

export function HoldingModal({
  opened,
  close,
  holding,
  accounts,
  instruments,
  taxRates,
  holdings,
  defaultAccountID,
  saved,
}: HoldingModalProps) {
  const initialAccountID = holding
    ? String(holding.account_id)
    : (defaultAccountID && accounts.some(item => String(item.id) === defaultAccountID)
        ? defaultAccountID
        : String(accounts.find(item => item.preferred)?.id ?? accounts[0]?.id ?? ''));

  const initialPac = holding
    ? (holding.pac_bps ?? 0) / 100
    : availablePacPercent(Number(initialAccountID), holdings);

  const [form, setForm] = useState<HoldingDraft>(() =>
    holding
      ? {
          accountID: String(holding.account_id),
          instrumentID: String(holding.instrument_id),
          value: holding.value_minor / 100,
          sinceBuy: holding.invested_minor ? (holding.value_minor - holding.invested_minor) / 100 : '',
          pac: initialPac,
          tax: holding.tax_bps / 100,
          notes: holding.notes ?? '',
        }
      : {
          accountID: initialAccountID,
          instrumentID: String(instruments[0]?.id ?? ''),
          value: 0,
          sinceBuy: '',
          pac: initialPac,
          tax: (taxRates[0]?.rate_bps ?? 2600) / 100,
          notes: '',
        }
  );
  const [saving, setSaving] = useState(false);

  const selectedAccount = accounts.find(item => String(item.id) === String(form.accountID));
  const accountCurrency = selectedAccount?.currency ?? 'EUR';
  const pacBudgetMinor = selectedAccount?.pac_amount_minor ?? 0;
  const currentAccountId = Number(form.accountID);
  const availableBps = availablePacBps(currentAccountId, holdings, holding?.id);
  const availablePct = availableBps / 100;
  const currentPacBps = bps(form.pac);
  const monthlyContribution =
    pacBudgetMinor > 0 && form.pac !== ''
      ? Math.round(((pacBudgetMinor * (Number(form.pac) || 0)) / 100)) / 100
      : '';

  const save = async () => {
    setSaving(true);
    try {
      const value = minor(form.value);
      const pacBpsVal = bps(form.pac);
      if (value === 0 && pacBpsVal === 0) {
        throw new Error('Investments with 0 value require a PAC allocation share');
      }
      const invested = value === 0 ? 0 : (form.sinceBuy === '' ? value : value - minor(form.sinceBuy));
      if (invested < 0) throw new Error('Since-buy gain/loss cannot be greater than the current value');

      const body = {
        account_id: Number(form.accountID),
        instrument_id: Number(form.instrumentID),
        invested_minor: invested,
        value_minor: value,
        tax_bps: bps(form.tax),
        is_pac: pacBpsVal > 0,
        pac_bps: pacBpsVal,
        pac_frequency: holding?.pac_frequency || 'monthly',
        notes: form.notes,
      };
      if (holding) {
        await updateHolding(holding.id, body);
      } else {
        await createHolding(body);
      }
      notifications.show({
        color: 'teal',
        title: holding ? 'Investment updated' : 'Investment added',
        message: holding ? 'Changes saved successfully.' : 'New investment added to your portfolio.',
      });
      await saved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      notifications.show({ color: 'red', title: 'Failed to save investment', message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title={holding ? 'Edit investment' : 'Add investment'}>
      <Stack>
        <Select
          searchable
          required
          label="Account"
          value={form.accountID}
          data={accounts.map(item => ({
            value: String(item.id),
            label: `${item.name} · ${item.type}${item.preferred ? ' · default' : ''} · ${item.currency}`,
          }))}
          onChange={value => {
            const nextAccountId = value ?? '';
            if (!holding) {
              const nextAvailablePct = availablePacPercent(Number(nextAccountId), holdings);
              setForm(f => ({ ...f, accountID: nextAccountId, pac: nextAvailablePct }));
            } else {
              setForm(f => ({ ...f, accountID: nextAccountId }));
            }
          }}
        />

        <Select
          searchable
          required
          label="Instrument"
          nothingFoundMessage="No ticker, name, or ISIN match"
          value={form.instrumentID}
          data={instruments.map(item => ({
            value: String(item.id),
            label: [item.ticker, item.name, instrumentLabels[item.instrument_type], item.isin].filter(Boolean).join(' · '),
          }))}
          onChange={value => setForm(f => ({ ...f, instrumentID: value ?? '' }))}
        />

        <SimpleGrid cols={2}>
          <NumberInput
            label="Current value"
            min={0}
            decimalScale={2}
            value={form.value}
            onChange={value => setForm(f => ({ ...f, value }))}
            rightSection={<Text size="xs" c="dimmed" pr={6}>{accountCurrency}</Text>}
            rightSectionWidth={46}
          />
          <NumberInput
            label="Since buy gain / loss (optional)"
            placeholder="Example: -0.85"
            decimalScale={2}
            value={form.sinceBuy}
            onChange={value => setForm(f => ({ ...f, sinceBuy: value }))}
            rightSection={<Text size="xs" c="dimmed" pr={6}>{accountCurrency}</Text>}
            rightSectionWidth={46}
          />
        </SimpleGrid>

        <SimpleGrid cols={2}>
          <Box>
            <NumberInput
              label="PAC share (%)"
              min={0}
              max={100}
              decimalScale={2}
              value={form.pac}
              onChange={val => setForm(f => ({ ...f, pac: val }))}
              rightSection={<Text size="xs" c="dimmed" pr={4}>%</Text>}
              rightSectionWidth={24}
            />
            <Group justify="space-between" align="center" mt={4} wrap="nowrap">
              <Text size="xs" c={currentPacBps > availableBps ? 'orange' : 'dimmed'}>
                {currentPacBps > availableBps
                  ? `Exceeds unallocated (${availablePct.toFixed(1)}% free)`
                  : `Bank unallocated: ${availablePct.toFixed(1)}%`}
              </Text>
              <Group gap={6} wrap="nowrap">
                {availablePct > 0 && Number(form.pac) !== availablePct && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="teal"
                    p={0}
                    h="auto"
                    onClick={() => setForm(f => ({ ...f, pac: availablePct }))}
                  >
                    Use max ({availablePct.toFixed(1)}%)
                  </Button>
                )}
                {Number(form.pac) > 0 && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    p={0}
                    h="auto"
                    onClick={() => setForm(f => ({ ...f, pac: 0 }))}
                  >
                    0%
                  </Button>
                )}
              </Group>
            </Group>
          </Box>
          <Box>
            <NumberInput
              label="Monthly contribution"
              min={0}
              decimalScale={2}
              rightSection={<Text size="xs" c="dimmed" pr={6}>{accountCurrency}/mo</Text>}
              rightSectionWidth={64}
              value={monthlyContribution}
              disabled={pacBudgetMinor === 0}
              placeholder={pacBudgetMinor === 0 ? 'No bank PAC set' : '0.00'}
              onChange={val => {
                if (pacBudgetMinor > 0) {
                  if (val === '' || val === undefined) {
                    setForm(f => ({ ...f, pac: '' }));
                  } else {
                    const computedPct = Math.round(((Number(val) * 100) / pacBudgetMinor) * 10000) / 100;
                    setForm(f => ({ ...f, pac: Math.min(100, Math.max(0, computedPct)) }));
                  }
                }
              }}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {pacBudgetMinor > 0
                ? `Of ${money(pacBudgetMinor, accountCurrency)}/mo account budget`
                : 'Set monthly budget on account to calculate amount'}
            </Text>
          </Box>
        </SimpleGrid>

        <SimpleGrid cols={2}>
          <NumberInput
            label="Applicable tax (%)"
            min={0}
            max={100}
            decimalScale={2}
            value={form.tax}
            onChange={value => setForm(f => ({ ...f, tax: value }))}
            rightSection={<Text size="xs" c="dimmed" pr={4}>%</Text>}
            rightSectionWidth={24}
          />
          <Select
            label="Tax preset"
            placeholder="Select preset"
            clearable
            data={taxRates.map(item => ({
              value: String(item.rate_bps),
              label: `${item.label} (${percent(item.rate_bps)})`,
            }))}
            onChange={value => value && setForm(f => ({ ...f, tax: Number(value) / 100 }))}
          />
        </SimpleGrid>

        <Textarea
          label="Notes & Context for AI Assistant"
          placeholder="e.g. Core global equity allocation for long-term wealth accumulation..."
          rows={2}
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.currentTarget.value }))}
        />

        <Group justify="end">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save investment</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
