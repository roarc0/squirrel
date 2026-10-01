import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { instrumentClient } from '../../api';
import { refreshBacktestInstruments } from './refresh';

export function RefreshBacktestData({
  isins,
  disabled,
  busy,
  onBusyChange,
  onComplete,
}: {
  isins: string[];
  disabled: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => Promise<void>;
}) {
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const refresh = async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    onBusyChange(true);
    setSummary('');
    setFailures([]);
    try {
      const result = await refreshBacktestInstruments(
        isins,
        {
          profile: (isin) => instrumentClient.lookupInstrument({ query: isin }, { signal: request.signal }),
          history: (isin) =>
            instrumentClient.refreshInstrumentPerformance({ isin }, { signal: request.signal }),
        },
        request.signal,
        (isin, stage, completed, total) => {
          if (mounted.current)
            setProgress(
              `${completed}/${total} fully refreshed · ${isin} · ${stage === 'history' ? 'full return history' : 'ETF profile'}`,
            );
        },
      );
      if (!mounted.current) return;
      setFailures(result.failures);
      setSummary(
        `${result.cancelled ? 'Refresh cancelled.' : 'Refresh finished.'} ${result.completed}/${result.total} instruments fully refreshed. Run the backtest again to recalculate results.`,
      );
      await onComplete();
    } catch (cause) {
      if (mounted.current)
        setFailures((current) => [...current, cause instanceof Error ? cause.message : String(cause)]);
    } finally {
      controller.current = null;
      if (mounted.current) onBusyChange(false);
    }
  };
  return (
    <Stack gap="xs">
      <Group>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={busy}
          disabled={disabled || !isins.length}
          onClick={() => void refresh()}
        >
          Refresh all ETF data ({new Set(isins).size})
        </Button>
        {busy && (
          <Button variant="subtle" size="xs" onClick={() => controller.current?.abort()}>
            Cancel refresh
          </Button>
        )}
        <Text size="xs" c="dimmed">
          Refreshes profiles and full return histories for the instruments selected above.
        </Text>
      </Group>
      {busy && (
        <Text size="xs" c="dimmed" role="status">
          {progress} · Selections are captured when the refresh starts.
        </Text>
      )}
      {summary && (
        <Text size="xs" role="status">
          {summary}
        </Text>
      )}
      {failures.length > 0 && (
        <Alert color="orange" title="Some data could not be refreshed">
          {failures.map((failure, index) => (
            <Text size="xs" key={index}>
              {failure}
            </Text>
          ))}
        </Alert>
      )}
    </Stack>
  );
}
