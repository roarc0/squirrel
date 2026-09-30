import { useState, useEffect } from 'react';
import { Paper, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBriefcase,
  IconChartPie,
  IconFlask,
  IconGlobe,
} from '@tabler/icons-react';
import {
  listHoldings,
  deleteHolding,
  updateHolding,
  importInstruments,
  type Account,
  type Holding,
  type Instrument,
  type TaxRate,
} from '../api';
import { GeoRadarSection } from './GeoRadarView';
import { DraftPortfoliosView } from './DraftPortfoliosView';
import { SubnavTabs } from '../components/SubnavTabs';
import { useBackendRows } from '../hooks/useBackendRows';
import { useConfirmDelete } from '../components/ConfirmDeleteModal';
import { useQueryParamArray } from '../hooks/useQueryParam';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';
import { HoldingModal } from '../components/HoldingModal';
import { PACSubtab } from './investments/PACSubtab';
import { HoldingsSubtab } from './investments/HoldingsSubtab';

export type InvestmentsSubtab = 'holdings' | 'pac' | 'radar' | 'sandbox';

export function InvestmentsView({
  holdings,
  accounts,
  instruments,
  taxRates,
  reload,
  activeSubtab = 'holdings',
  onSubtabChange,
  onOpenDrafts,
  onOpenDetail,
}: {
  holdings: Holding[];
  accounts: Account[];
  instruments: Instrument[];
  taxRates: TaxRate[];
  reload: () => Promise<void>;
  activeSubtab?: InvestmentsSubtab;
  onSubtabChange?: (subtab: InvestmentsSubtab) => void;
  onOpenDrafts?: () => void;
  onOpenDetail?: (isin: string) => void;
}) {
  const [currentSubtab, setCurrentSubtab] = useState<InvestmentsSubtab>(activeSubtab);

  useEffect(() => {
    if (activeSubtab) {
      setCurrentSubtab(activeSubtab);
    }
  }, [activeSubtab]);

  const handleSubtabChange = (subtab: InvestmentsSubtab) => {
    setCurrentSubtab(subtab);
    onSubtabChange?.(subtab);
  };

  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Holding>();
  const [error, setError] = useState('');
  const [accountIDs, setAccountIDs] = useQueryParamArray('accounts');
  const [selectedAssetClass, setSelectedAssetClass] = useState<string | null>(null);
  const { confirmDelete, modal: confirmDeleteModal } = useConfirmDelete();
  const [refreshingISIN, setRefreshingISIN] = useState<string | null>(null);
  const [showTax, setShowTax] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  const table = useBackendRows(listHoldings, holdings, 'value', 'desc');
  const activeAccounts = accounts.filter(account => !account.archived);
  const activeAccountIDs = new Set(activeAccounts.map(account => account.id));
  const accountMap = new Map<number, Account>(accounts.map(a => [a.id, a]));
  const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));

  const open = (holding?: Holding) => {
    setEditing(holding);
    setOpened(true);
  };

  const remove = (holding: Holding) => {
    confirmDelete('investment', `${holding.instrument_name} · ${holding.account_name}`, async () => {
      try {
        await deleteHolding(holding.id);
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const refreshInstrument = async (isin: string) => {
    setRefreshingISIN(isin);
    try {
      await importInstruments([isin]);
      await reload();
      notifications.show({ color: 'teal', message: `${isin} data refreshed` });
    } catch (cause) {
      notifications.show({ color: 'red', message: `Failed to refresh ${isin}: ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setRefreshingISIN(null);
    }
  };

  const zeroPac = async (holding: Holding) => {
    try {
      await updateHolding(holding.id, { pac_bps: 0 });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const ready = activeAccounts.length > 0 && instruments.length > 0;
  const activeHoldings = table.rows.filter(holding => activeAccountIDs.has(holding.account_id));
  const visibleHoldings = activeHoldings.filter(holding => accountIDs.length === 0 || accountIDs.includes(String(holding.account_id)));
  const visibleAccounts = activeAccounts.filter(account => accountIDs.length === 0 || accountIDs.includes(String(account.id)));
  const plannedHoldings = visibleHoldings.filter(h => (h.pac_bps ?? 0) > 0);

  const queryLower = filterQuery.trim().toLowerCase();
  const displayedHoldings = visibleHoldings.filter(holding => {
    if (holding.value_minor === 0) return false;
    if (selectedAssetClass && holding.asset_class !== selectedAssetClass) return false;
    if (queryLower) {
      const nameMatch = holding.instrument_name?.toLowerCase().includes(queryLower);
      const tickerMatch = holding.instrument_ticker?.toLowerCase().includes(queryLower);
      const isin = holding.instrument_isin || instMap.get(holding.instrument_id)?.isin;
      const isinMatch = isin?.toLowerCase().includes(queryLower);
      if (!nameMatch && !tickerMatch && !isinMatch) return false;
    }
    return true;
  });

  const totals = new Map<string, { value: number; invested: number; count: number; weightedTERNum: number; annualFeeDrag: number; classes: Map<string, number> }>();
  for (const holding of visibleHoldings) {
    const currency = holding.currency ?? 'EUR';
    const summary = totals.get(currency) ?? { value: 0, invested: 0, count: 0, weightedTERNum: 0, annualFeeDrag: 0, classes: new Map<string, number>() };
    const assetClass = holding.asset_class || 'other';
    const inst = instMap.get(holding.instrument_id);
    const terBps = inst?.ter_bps ?? 0;

    summary.value += holding.value_minor;
    summary.invested += holding.invested_minor;
    summary.count++;
    summary.weightedTERNum += holding.value_minor * terBps;
    summary.annualFeeDrag += Math.round((holding.value_minor * terBps) / 10000);
    summary.classes.set(assetClass, (summary.classes.get(assetClass) ?? 0) + holding.value_minor);
    totals.set(currency, summary);
  }

  return (
    <ViewShell error={error || table.sortError}>
      <SubnavTabs<InvestmentsSubtab>
        value={currentSubtab}
        onChange={handleSubtabChange}
        tabs={[
          {
            value: 'holdings',
            label: 'Holdings',
            icon: <IconBriefcase size={16} />,
            badge: activeHoldings.length > 0 ? activeHoldings.length : undefined,
          },
          {
            value: 'pac',
            label: 'Allocation Strategy',
            icon: <IconChartPie size={16} />,
            badge: plannedHoldings.length > 0 ? plannedHoldings.length : undefined,
            badgeColor: 'teal',
          },
          {
            value: 'radar',
            label: 'Geo & FX Radar',
            icon: <IconGlobe size={16} />,
          },
          {
            value: 'sandbox',
            label: 'Sandbox',
            icon: <IconFlask size={16} />,
          },
        ]}
      />

      {currentSubtab === 'radar' ? (
        <Stack gap="md">
          <SectionHeader
            title="Geo & FX Radar"
            subtitle="Geographical distribution, currency exposure, and FX risk across your investment holdings."
          />
          <Paper withBorder radius="lg" p="lg">
            <GeoRadarSection />
          </Paper>
        </Stack>
      ) : currentSubtab === 'sandbox' ? (
        <DraftPortfoliosView
          holdings={holdings}
          instruments={instruments}
          accounts={accounts}
          reload={reload}
        />
      ) : currentSubtab === 'pac' ? (
        <PACSubtab
          activeAccounts={activeAccounts}
          visibleAccounts={visibleAccounts}
          activeHoldings={activeHoldings}
          visibleHoldings={visibleHoldings}
          instMap={instMap}
          accountMap={accountMap}
          accountIDs={accountIDs}
          setAccountIDs={setAccountIDs}
          ready={ready}
          refreshingISIN={refreshingISIN}
          onOpenDetail={onOpenDetail}
          onAddInvestment={() => open()}
          onEditInvestment={open}
          onDeleteHolding={remove}
          onZeroPac={zeroPac}
          onRefreshInstrument={refreshInstrument}
          reload={reload}
        />
      ) : (
        <HoldingsSubtab
          activeAccounts={activeAccounts}
          visibleAccounts={visibleAccounts}
          activeHoldings={activeHoldings}
          visibleHoldings={visibleHoldings}
          displayedHoldings={displayedHoldings}
          instMap={instMap}
          totals={totals}
          table={table}
          filterQuery={filterQuery}
          setFilterQuery={setFilterQuery}
          accountIDs={accountIDs}
          setAccountIDs={setAccountIDs}
          showTax={showTax}
          setShowTax={setShowTax}
          selectedAssetClass={selectedAssetClass}
          setSelectedAssetClass={setSelectedAssetClass}
          ready={ready}
          onOpenDetail={onOpenDetail}
          onAddInvestment={() => open()}
          onEditInvestment={open}
          onDeleteHolding={remove}
          reload={reload}
        />
      )}

      <HoldingModal
        key={editing?.id ?? 'new'}
        opened={opened}
        close={() => setOpened(false)}
        holding={editing}
        accounts={activeAccounts}
        instruments={instruments}
        taxRates={taxRates}
        holdings={activeHoldings}
        defaultAccountID={accountIDs.length === 1 ? accountIDs[0] : undefined}
        saved={async () => {
          setOpened(false);
          await reload();
        }}
      />
      {confirmDeleteModal}
    </ViewShell>
  );
}
