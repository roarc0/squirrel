import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { createInstrument, type Instrument, type InstrumentType } from '../api';
import { instrumentLabels } from '../utils/format';

type Numeric = string | number;
const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

export type InstrumentDraft = Omit<Instrument, 'id' | 'ter_bps' | 'fund_size_million' | 'tracking_difference_bps' | 'tracking_error_bps'> & {
  ter: Numeric;
  size: Numeric;
  trackingDifference: Numeric;
  trackingError: Numeric;
};

export const blankInstrument = (): InstrumentDraft => ({
  isin: '',
  name: '',
  ticker: '',
  instrument_type: 'etf',
  provider: '',
  index_name: '',
  investment_focus: '',
  asset_class: '',
  strategy: 'broad',
  currency_hedged: false,
  starred: false,
  data_status: 'enriched',
  distribution: 'accumulating',
  replication: 'physical_full',
  domicile: 'IE',
  fund_currency: 'EUR',
  ter: 0.2,
  size: 0,
  inception_date: '',
  trackingDifference: '',
  trackingError: '',
  ucits: false,
  source_url: '',
});

export function InstrumentModal({
  opened,
  close,
  instrument,
  saved,
}: {
  opened: boolean;
  close: () => void;
  instrument?: Instrument;
  saved: () => Promise<void>;
}) {
  const [form, setForm] = useState<InstrumentDraft>(() =>
    instrument
      ? {
          ...instrument,
          ter: instrument.ter_bps / 100,
          size: instrument.fund_size_million,
          trackingDifference:
            instrument.tracking_difference_bps === null ? '' : instrument.tracking_difference_bps / 100,
          trackingError:
            instrument.tracking_error_bps === null ? '' : instrument.tracking_error_bps / 100,
        }
      : blankInstrument()
  );
  const [error, setError] = useState('');

  const save = async () => {
    try {
      await createInstrument({
        isin: form.isin,
        name: form.name,
        ticker: form.ticker,
        instrument_type: form.instrument_type,
        provider: form.provider,
        index_name: form.index_name,
        investment_focus: form.investment_focus,
        asset_class: form.asset_class,
        strategy: form.strategy,
        currency_hedged: form.currency_hedged,
        data_status: 'enriched',
        distribution: form.distribution,
        replication: form.replication,
        domicile: form.domicile,
        fund_currency: form.fund_currency,
        ter_bps: bps(form.ter),
        fund_size_million: n(form.size),
        inception_date: form.inception_date,
        tracking_difference_bps: form.trackingDifference === '' ? null : bps(form.trackingDifference),
        tracking_error_bps: form.trackingError === '' ? null : bps(form.trackingError),
        ucits: form.ucits,
        source_url: form.source_url,
      });
      await saved();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const set = <K extends keyof InstrumentDraft>(key: K, value: InstrumentDraft[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  return (
    <Modal opened={opened} onClose={close} title={instrument ? 'Edit instrument' : 'Add instrument'} size="xl">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          <TextInput required label="ISIN" value={form.isin} onChange={e => set('isin', e.currentTarget.value.toUpperCase())} />
          <TextInput required label="Name" value={form.name} onChange={e => set('name', e.currentTarget.value)} />
          <TextInput label="Ticker" value={form.ticker} onChange={e => set('ticker', e.currentTarget.value)} />
          <Select
            label="Instrument type"
            value={form.instrument_type}
            data={Object.entries(instrumentLabels).map(([value, label]) => ({ value, label }))}
            onChange={value => set('instrument_type', (value ?? 'other') as InstrumentType)}
          />
          <TextInput label="Issuer" value={form.provider} onChange={e => set('provider', e.currentTarget.value)} />
          <TextInput label="Tracked index" value={form.index_name} onChange={e => set('index_name', e.currentTarget.value)} />
          <TextInput label="Investment focus" placeholder="Equity, World" value={form.investment_focus} onChange={e => set('investment_focus', e.currentTarget.value)} />
          <Select
            label="Asset class"
            value={form.asset_class}
            data={[
              { value: '', label: 'Unknown' },
              { value: 'equity', label: 'Equity' },
              { value: 'bond', label: 'Bond' },
              { value: 'commodity', label: 'Commodity' },
              { value: 'monetary', label: 'Monetary' },
              { value: 'real_estate', label: 'Real estate' },
              { value: 'crypto', label: 'Crypto' },
              { value: 'mixed', label: 'Mixed' },
              { value: 'other', label: 'Other' },
            ]}
            onChange={value => set('asset_class', value ?? '')}
          />
          <Select
            label="Strategy"
            value={form.strategy}
            data={[
              { value: 'broad', label: 'Broad' },
              { value: 'active', label: 'Active' },
              { value: 'esg', label: 'ESG / screened' },
              { value: 'dividend', label: 'Dividend' },
              { value: 'factor', label: 'Factor' },
            ]}
            onChange={value => set('strategy', value ?? 'broad')}
          />
          <TextInput label="Domicile" maxLength={2} value={form.domicile} onChange={e => set('domicile', e.currentTarget.value.toUpperCase())} />
          <Select
            label="Distribution"
            value={form.distribution}
            data={[
              { value: 'accumulating', label: 'Accumulating' },
              { value: 'distributing', label: 'Distributing' },
            ]}
            onChange={value => set('distribution', (value ?? 'accumulating') as InstrumentDraft['distribution'])}
          />
          <Select
            label="Replication"
            value={form.replication}
            data={[
              { value: 'physical_full', label: 'Physical full' },
              { value: 'physical_sampling', label: 'Physical sampling' },
              { value: 'synthetic', label: 'Synthetic' },
            ]}
            onChange={value => set('replication', (value ?? 'physical_full') as InstrumentDraft['replication'])}
          />
          <TextInput label="Fund currency" maxLength={3} value={form.fund_currency} onChange={e => set('fund_currency', e.currentTarget.value.toUpperCase())} />
          <NumberInput label="TER (%)" min={0} decimalScale={3} value={form.ter} onChange={value => set('ter', value)} />
          <NumberInput label="Fund size (million)" min={0} value={form.size} onChange={value => set('size', value)} />
          <TextInput type="date" label="Inception date" value={form.inception_date} onChange={e => set('inception_date', e.currentTarget.value)} />
          <Checkbox label="UCITS compliant" checked={form.ucits} onChange={event => set('ucits', event.currentTarget.checked)} />
          <Checkbox label="Currency hedged" checked={form.currency_hedged} onChange={event => set('currency_hedged', event.currentTarget.checked)} />
          <NumberInput label="Tracking difference (%)" decimalScale={3} value={form.trackingDifference} onChange={value => set('trackingDifference', value)} />
          <NumberInput label="Tracking error (%)" min={0} decimalScale={3} value={form.trackingError} onChange={value => set('trackingError', value)} />
          <TextInput label="Source URL" type="url" value={form.source_url} onChange={e => set('source_url', e.currentTarget.value)} />
        </SimpleGrid>
        <Text size="xs" c="dimmed">Instrument type describes the legal wrapper; asset class describes what it invests in. The ISIN is the stable key.</Text>
        <Group justify="end">
          <Button onClick={() => void save()}>Save instrument</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
