import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconChartLine, IconPlayerPlay } from '@tabler/icons-react';
import { backtestClient, type Account, type Holding, type Instrument } from '../../api';
import type { RunBacktestResponse } from '../../pb/v1/backtest_pb';
import { SectionHeader } from '../../components/SectionHeader';
import { AllocationEditor, AllocationSummary } from './PortfolioAllocation';
import { MetricsGrid } from './MetricsGrid';
import { AnalysisChart } from './AnalysisChart';
import { ReturnHeatmap } from './ReturnHeatmap';
import { RollingReturns } from './RollingReturns';
import { Drawdowns } from './Drawdowns';
import { HoldingPeriods } from './HoldingPeriods';
import { CorrelationMatrix } from './CorrelationMatrix';
import { colors, eur, pct } from './format';
import { copyPAC, selectPACs, type DraftPlan } from './draft';
import { RefreshBacktestData } from './RefreshBacktestData';

function AnalysisSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card withBorder radius="md" p="lg">
      <Title order={3} size="lg" mb="md">
        {title}
      </Title>
      {children}
    </Card>
  );
}

export function BacktestView({
  accounts,
  holdings,
  instruments,
  reload,
}: {
  accounts: Account[];
  holdings: Holding[];
  instruments: Instrument[];
  reload: (opts?: { refreshInstruments?: boolean }) => Promise<void>;
}) {
  const eligible = accounts.filter(
    (a) =>
      !a.archived &&
      a.currency === 'EUR' &&
      (a.pac_amount_minor ?? 0) > 0 &&
      holdings.some((h) => h.account_id === a.id && (h.pac_bps ?? 0) > 0) &&
      holdings
        .filter((h) => h.account_id === a.id && (h.pac_bps ?? 0) > 0)
        .every((h) => h.instrument_isin && (!h.pac_frequency || h.pac_frequency === 'monthly')),
  );
  const [plans, setPlans] = useState<DraftPlan[]>(() =>
    eligible.length
      ? eligible.map((account) => copyPAC(account, holdings))
      : [{ id: 'custom', name: 'Custom portfolio', monthly: 300, allocations: [] }],
  );
  const accountIds = plans.filter((plan) => plan.id !== 'custom').map((plan) => plan.id);
  const [initial, setInitial] = useState<number | string>(0);
  const [period, setPeriod] = useState('max');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rebalance, setRebalance] = useState('none');
  const [riskFree, setRiskFree] = useState<number | string>(0);
  const [target, setTarget] = useState<number | string>(0);
  const [result, setResult] = useState<RunBacktestResponse>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [portfolioId, setPortfolioId] = useState('combined');
  const [chartMode, setChartMode] = useState('return');
  const [compareId, setCompareId] = useState<string | null>(null);
  const [runInputs, setRunInputs] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    // ETF history can be refreshed in another browser tab while this result stays mounted.
    const recheck = () => {
      if (document.visibilityState === 'visible') setRunInputs('');
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);
  const choosePACs = (ids: string[]) => {
    try {
      setPlans(
        ids.length
          ? selectPACs(ids, plans, eligible, holdings)
          : [{ id: 'custom', name: 'Custom portfolio', monthly: 300, allocations: [] }],
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const inputKey = JSON.stringify({
    dataVersion,
    plans,
    initial,
    period,
    start: period === 'max' ? '' : start,
    end: period === 'max' ? '' : end,
    rebalance,
    riskFree,
    target,
  });
  const refreshIsins = [...new Set(plans.flatMap((plan) => plan.allocations.map((a) => a.isin)))];

  const run = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    try {
      const response = await backtestClient.runBacktest(
        {
          draftPlans: plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            monthlyMinor: BigInt(Math.round(plan.monthly * 100)),
            allocations: plan.allocations
              .filter((a) => a.weight > 0)
              .map((a) => ({ isin: a.isin, weightBps: Math.round(a.weight * 100) })),
          })),
          initialMinor: BigInt(Math.round(Number(initial) * 100)),
          startDate: period === 'max' ? '' : start,
          endDate: period === 'max' ? '' : end,
          rebalance,
          riskFreeRate: Number(riskFree) / 100,
          targetReturn: Number(target) / 100,
        },
        { signal: request.signal },
      );
      if (!request.signal.aborted) {
        setResult(response);
        setRunInputs(inputKey);
        setPortfolioId('combined');
        setCompareId(null);
      }
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  const portfolios = result?.combined
    ? [result.combined, ...(result.portfolios.length > 1 ? result.portfolios : [])]
    : [];
  const portfolio = portfolios.find((p) => p.id === portfolioId) ?? portfolios[0];
  const comparison = portfolios.find((p) => p.id === compareId && p.id !== portfolio?.id);
  const last = portfolio?.series.at(-1);
  const selectedPlans = result?.plans.filter((p) => portfolioId === 'combined' || p.id === portfolioId) ?? [];
  const totalBudget = selectedPlans.reduce((sum, p) => sum + p.initial + p.monthly, 0);
  const weightMap = new Map<string, number>();
  for (const plan of selectedPlans)
    for (const a of plan.allocations)
      weightMap.set(
        a.isin,
        (weightMap.get(a.isin) ?? 0) + ((a.weightBps / 100) * (plan.initial + plan.monthly)) / totalBudget,
      );
  const composition = [...weightMap].map(([isin, weight]) => ({
    isin,
    weight,
    name: result?.coverage.find((c) => c.isin === isin)?.name ?? isin,
  }));

  return (
    <Stack gap="lg">
      <SectionHeader
        title="Portfolio backtest"
        subtitle="Replay your PACs or a custom allocation through real historical markets."
        badge={
          <Badge variant="light" color="blue">
            Historical analysis
          </Badge>
        }
      />
      <Card withBorder p="lg" radius="md">
        <Stack gap="md">
          <Group align="end">
            <MultiSelect
              label="PACs to backtest"
              placeholder="Choose one or more PACs, or build from scratch"
              value={accountIds}
              onChange={choosePACs}
              data={eligible.map((a) => ({ value: String(a.id), label: a.name }))}
              clearable
              searchable
              style={{ flex: 1, minWidth: 220 }}
            />
            <Button variant="subtle" onClick={() => choosePACs([])}>
              Start from scratch
            </Button>
            <Badge color="gray" variant="light">
              EUR · Dividends reinvested
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Replace instruments and edit weights directly below. Changes apply only to this backtest; saved
            PACs stay unchanged.
          </Text>
          <AllocationEditor key={dataVersion} plans={plans} instruments={instruments} onChange={setPlans} />
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>
                Analysis period
              </Text>
              <Text size="xs" c="dimmed">
                Max automatically uses all available shared history, independent of when you created your PAC.
              </Text>
            </div>
            <SegmentedControl
              aria-label="Analysis period"
              value={period}
              onChange={setPeriod}
              data={[
                { value: 'max', label: 'Max history' },
                { value: 'custom', label: 'Custom dates' },
              ]}
            />
          </Group>
          {period === 'custom' && (
            <SimpleGrid cols={2}>
              <TextInput
                type="date"
                label="Start date"
                description="Empty = earliest shared date"
                value={start}
                onChange={(e) => setStart(e.currentTarget.value)}
                max={end || new Date().toISOString().slice(0, 10)}
              />
              <TextInput
                type="date"
                label="End date"
                description="Empty = latest shared date"
                value={end}
                onChange={(e) => setEnd(e.currentTarget.value)}
                min={start || undefined}
                max={new Date().toISOString().slice(0, 10)}
              />
            </SimpleGrid>
          )}
          {period === 'max' && result && runInputs === inputKey && (
            <Text size="sm" c="blue">
              Maximum available period: {result.startDate} → {result.endDate}
            </Text>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <NumberInput
              label="Initial investment (€)"
              description={
                plans.length > 1
                  ? 'Split by monthly budgets, or equally if all are zero'
                  : 'Added to the first monthly deposit'
              }
              value={initial}
              onChange={setInitial}
              min={0}
              max={1e10}
              decimalScale={2}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select
              label="Rebalancing"
              value={rebalance}
              onChange={(v) => setRebalance(v ?? 'none')}
              data={[
                { value: 'none', label: 'None · new deposits follow weights' },
                { value: 'monthly', label: 'Monthly · first calendar day' },
                { value: 'annually', label: 'Annually · 1 January' },
              ]}
            />
            <NumberInput
              label="Risk-free rate (% / year)"
              value={riskFree}
              onChange={setRiskFree}
              min={-99}
              max={100}
              decimalScale={2}
            />
            <NumberInput
              label="Sortino target (% / year)"
              value={target}
              onChange={setTarget}
              min={-99}
              max={100}
              decimalScale={2}
            />
          </SimpleGrid>
          <Divider />
          <RefreshBacktestData
            isins={refreshIsins}
            disabled={busy}
            busy={refreshing}
            onBusyChange={setRefreshing}
            onComplete={async () => {
              setDataVersion((version) => version + 1);
              await reload({ refreshInstruments: true });
            }}
          />
          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed" maw={650}>
              Real history only. The newest instrument sets the earliest shared start; missing internal dates
              stop the calculation. Cash earns 0%. No personal taxes, trading fees or inflation adjustment.
            </Text>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              loading={busy}
              disabled={
                refreshing ||
                plans.some(
                  (plan) =>
                    plan.allocations.every((a) => a.weight <= 0) ||
                    plan.allocations.reduce((sum, a) => sum + Math.round(a.weight * 100), 0) > 10000,
                )
              }
              onClick={() => void run()}
            >
              Run backtest
            </Button>
          </Group>
          {busy && (
            <Group>
              <Text size="xs" c="dimmed" role="status">
                Loading saved histories and fetching missing ones. First runs may take longer.
              </Text>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  controller.current?.abort();
                  setBusy(false);
                }}
              >
                Cancel
              </Button>
            </Group>
          )}
          {error && (
            <Alert color="red" title="Backtest could not run">
              {error}
            </Alert>
          )}
        </Stack>
      </Card>

      {!result && !busy && !error && (
        <Card withBorder p="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconChartLine size={32} color={colors[0]} />
            <Text fw={600}>Your strategy, through past markets</Text>
            <Text size="sm" c="dimmed" ta="center">
              Select accounts or build an allocation, then run a backtest to explore returns, downside risk
              and diversification.
            </Text>
          </Stack>
        </Card>
      )}
      {result && portfolio && last && (
        <>
          {runInputs !== inputKey && (
            <Alert color="yellow">
              Results below show the last completed run. Run the backtest again to use the latest inputs and
              instrument history.
            </Alert>
          )}
          <Group justify="space-between">
            <Title order={2}>Your portfolio and strategy</Title>
            {portfolios.length > 1 && (
              <Select
                aria-label="Portfolio analysis"
                w={240}
                value={portfolio.id}
                onChange={(v) => {
                  setPortfolioId(v ?? 'combined');
                  setCompareId(null);
                }}
                data={portfolios.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
          </Group>
          <Card withBorder radius="md" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={700}>{portfolio.name}</Text>
                <Badge color="gray" variant="light">
                  {result.startDate} → {result.endDate}
                </Badge>
              </Group>
              <AllocationSummary rows={composition} />
              <Text size="xs" c="dimmed">
                Initial allocation / contribution weights. Market weights drift between rebalancing dates.
              </Text>
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
                {[
                  ['Contributed', eur(last.contributed)],
                  ['Ending value', eur(last.value)],
                  ['Profit / loss', eur(last.value - last.contributed)],
                  ['Total time-weighted return', pct(last.index - 1)],
                  ['Annualized return (CAGR)', pct(portfolio.metrics?.cagr)],
                  ['Duration', `${portfolio.durationYears.toFixed(2)} years`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <Text size="xs" c="dimmed">
                      {label}
                    </Text>
                    <Text size="xl" fw={700}>
                      {value}
                    </Text>
                  </div>
                ))}
              </SimpleGrid>
              <Text size="xs" c="dimmed">
                Annualized return is the compounded yearly equivalent of the time-weighted return; it needs at
                least one year of history. Duration uses elapsed calendar days ÷ 365.25.
              </Text>
              <Divider />
              <Group gap="xl">
                <Text size="xs">
                  Currency <b>EUR</b>
                </Text>
                <Text size="xs">
                  Rebalancing <b>{result.rebalance}</b>
                </Text>
                <Text size="xs">
                  Monthly deposits <b>{eur(selectedPlans.reduce((sum, p) => sum + p.monthly, 0))}</b>
                </Text>
                <Text size="xs">
                  Risk-free <b>{pct(result.riskFreeRate)}</b> · Target <b>{pct(result.targetReturn)}</b>
                </Text>
              </Group>
              {result.notes.length > 0 && (
                <Alert color="blue" variant="light">
                  {result.notes.map((note, i) => (
                    <Text key={i} size="xs">
                      {note}
                    </Text>
                  ))}
                </Alert>
              )}
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 12 }}>Instrument history and coverage</summary>
                <Table.ScrollContainer minWidth={580}>
                  <Table mt="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Instrument</Table.Th>
                        <Table.Th>Available from</Table.Th>
                        <Table.Th>Through</Table.Th>
                        <Table.Th>Fetched</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.coverage.map((c) => (
                        <Table.Tr key={c.isin}>
                          <Table.Td>
                            <Text size="xs">{c.name}</Text>
                            <Text size="10px" c="dimmed">
                              {c.isin}
                            </Text>
                          </Table.Td>
                          <Table.Td>{c.startDate}</Table.Td>
                          <Table.Td>{c.endDate}</Table.Td>
                          <Table.Td>{c.fetchedAt.slice(0, 10)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </details>
            </Stack>
          </Card>

          <Title order={2}>Detailed analysis</Title>
          <AnalysisSection title="Metrics at a glance">
            <MetricsGrid portfolio={portfolio} />
            {portfolio.notes.map((note) => (
              <Text key={note} size="xs" c="dimmed" mt="sm">
                {note}
              </Text>
            ))}
          </AnalysisSection>
          <AnalysisSection title="Performance over time">
            <Group justify="space-between" mb="sm">
              <SegmentedControl
                size="xs"
                value={chartMode}
                onChange={setChartMode}
                data={[
                  { value: 'return', label: 'Return %' },
                  { value: 'value', label: 'Value & contributions' },
                ]}
              />
              {portfolios.length > 1 && chartMode === 'return' && (
                <Select
                  aria-label="Compare PAC"
                  placeholder="Compare another PAC"
                  clearable
                  value={compareId}
                  onChange={setCompareId}
                  data={portfolios
                    .filter((p) => p.id !== portfolio.id)
                    .map((p) => ({ value: p.id, label: p.name }))}
                />
              )}
            </Group>
            <AnalysisChart
              title="Portfolio performance"
              money={chartMode === 'value'}
              dates={portfolio.series.map((d) => d.date)}
              lines={
                chartMode === 'value'
                  ? [
                      {
                        name: 'Portfolio value',
                        color: colors[0],
                        values: portfolio.series.map((d) => d.value),
                      },
                      {
                        name: 'Contributions',
                        color: colors[1],
                        dashed: true,
                        values: portfolio.series.map((d) => d.contributed),
                      },
                    ]
                  : [
                      {
                        name: portfolio.name,
                        color: colors[0],
                        values: portfolio.series.map((d) => d.index - 1),
                      },
                      ...(comparison
                        ? [
                            {
                              name: comparison.name,
                              color: colors[1],
                              values: comparison.series.map((d) => d.index - 1),
                            },
                          ]
                        : []),
                    ]
              }
            />
            <Text size="xs" c="dimmed">
              Return % removes the effect of deposits. Value &amp; contributions shows the simulated investor
              experience.
            </Text>
          </AnalysisSection>
          <AnalysisSection title="Return heatmap">
            <ReturnHeatmap portfolio={portfolio} />
          </AnalysisSection>
          <AnalysisSection title="Rolling returns">
            <RollingReturns portfolio={portfolio} />
          </AnalysisSection>
          <AnalysisSection title="Value drawdowns">
            <Drawdowns portfolio={portfolio} />
          </AnalysisSection>
          <AnalysisSection title="Losses by holding period">
            <HoldingPeriods portfolio={portfolio} />
          </AnalysisSection>
          <AnalysisSection title="Correlation matrix">
            <CorrelationMatrix result={result} assetIds={composition.map((a) => a.isin)} />
          </AnalysisSection>
          <AnalysisSection title="Methodology & data">
            <Stack gap="sm">
              <Text size="sm">
                This is a historical simulation of the selected allocations. The initial amount and first monthly
                contribution are invested at the first available close; later contributions are invested at
                the first calendar-day close of each month. Rebalancing takes place after deposits,
                independently within each account.
              </Text>
              <Text size="sm">
                Fractional total-return index units represent reinvested dividends. Fund-currency labels do
                not change the EUR measurement currency. Provider histories include weekends and are rounded
                to basis points. Shared calendar days are checked; no earlier history or proxy prices are
                synthesized.
              </Text>
              <Text size="sm">
                Risk metrics use daily time-weighted returns and 365.25 periods/year. CAGR measures strategy
                growth; XIRR measures investor cash-flow performance. Calmar uses the selected window.
                Historical monthly VaR excludes partial months and needs at least 12 complete months. Cash
                balances earn no interest.
              </Text>
              <Alert color="gray" title="Factor exposure">
                Factor regression requires aligned market, size, value, profitability, investment and momentum
                return datasets. These are not available from the current price-history source, so factor
                loadings are not estimated here.
              </Alert>
            </Stack>
          </AnalysisSection>
        </>
      )}
    </Stack>
  );
}
