import { useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import type { Account, Holding, Instrument, Summary } from '../api';
import { money, percent } from '../utils/format';

type AISettings = {
  provider: 'ollama' | 'openai' | 'custom';
  endpoint: string;
  model: string;
  apiKey: string;
};

const defaultSettings: AISettings = {
  provider: 'ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'llama3.2',
  apiKey: '',
};

function getSavedSettings(): AISettings {
  try {
    const raw = localStorage.getItem('loot.aiSettings');
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function AIAdvisorView({
  summary,
  accounts,
  holdings,
  instruments,
}: {
  summary: Summary;
  accounts: Account[];
  holdings: Holding[];
  instruments: Instrument[];
}) {
  const [settings, setSettings] = useState<AISettings>(getSavedSettings);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState('');
  const [error, setError] = useState('');

  const saveSettings = (newSettings: AISettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('loot.aiSettings', JSON.stringify(newSettings));
    } catch {
      /* optional */
    }
    setSettingsOpened(false);
  };

  // Build sanitized portfolio summary context
  const primaryCurrency = summary.base_currency || 'EUR';
  const currencyData = summary.currencies?.find(c => c.currency === primaryCurrency);

  const instMap = new Map<number, Instrument>(instruments.map(i => [i.id, i]));
  const formattedHoldings = holdings.map(h => {
    const inst = instMap.get(h.instrument_id);
    return {
      name: h.instrument_name,
      ticker: h.instrument_ticker,
      isin: h.instrument_isin,
      type: h.instrument_type,
      assetClass: h.asset_class,
      value: money(h.value_minor, h.currency ?? primaryCurrency),
      ter: inst?.ter_bps ? percent(inst.ter_bps) : '0%',
      actualPct: percent(h.actual_bps),
      plannedPct: percent(h.planned_bps),
    };
  });

  const portfolioContext = {
    baseCurrency: primaryCurrency,
    totalWealth: money(currencyData?.total_minor, primaryCurrency),
    cashBalance: money(currencyData?.balance_minor, primaryCurrency),
    investmentsTotal: money(currencyData?.portfolio_minor, primaryCurrency),
    holdingsCount: holdings.length,
    activeDiagnostics: (summary.diagnostics ?? []).map(d => ({
      severity: d.severity,
      title: d.title,
      message: d.message,
    })),
    holdings: formattedHoldings,
  };

  const contextJSON = JSON.stringify(portfolioContext, null, 2);

  const presets = [
    'How can I lower my portfolio TER fees without changing my risk level?',
    'Analyze my asset allocation drift and tell me what to rebalance next with €2,000.',
    'What are the biggest risks or overlap vulnerabilities in my current holdings?',
    'How tax-efficient is my current distribution & account setup?',
  ];

  const askAI = async (queryText = prompt) => {
    if (!queryText.trim()) return;
    setLoading(true);
    setError('');
    setAdvice('');

    try {
      const systemPrompt = `You are an expert, local-first financial portfolio AI advisor for LOOT. Analyze the user's anonymized portfolio context and answer their prompt concisely with actionable, structured bullet points. Never give legal or binding tax advice. Keep explanations simple, practical, and clear.`;

      const userContent = `Portfolio Context:\n\`\`\`json\n${contextJSON}\n\`\`\`\n\nUser Question: ${queryText}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (settings.apiKey) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
      }

      const res = await fetch(`${settings.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI Provider HTTP ${res.status}: ${text || res.statusText}`);
      }

      const data = await res.json();
      const answer = data.choices?.[0]?.message?.content || 'No response generated.';
      setAdvice(answer);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to reach AI provider. Please check your AI settings endpoint (e.g. Ollama http://localhost:11434/v1 or OpenAI key).'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Box>
          <Group gap="xs">
            <Title order={2}>AI Portfolio Advisor</Title>
            <Badge color="teal" variant="light">
              Local-First & Opt-In
            </Badge>
          </Group>
          <Text c="dimmed">
            Ask questions about fee reduction, rebalancing strategy, and risk concentration. Data is sent only when you submit.
          </Text>
        </Box>
        <Button variant="default" onClick={() => setSettingsOpened(true)}>
          ⚙️ AI Provider Settings ({settings.provider})
        </Button>
      </Group>

      {error && <Alert color="red">{error}</Alert>}

      <Paper className="metric" p="lg" radius="lg">
        <Text fw={700} size="sm" mb="xs">
          Quick Suggestion Prompts
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {presets.map((preset, idx) => (
            <Button
              key={idx}
              variant="light"
              color="gray"
              justify="start"
              style={{ height: 'auto', whiteSpace: 'normal', padding: '10px 14px' }}
              onClick={() => {
                setPrompt(preset);
                void askAI(preset);
              }}
            >
              <Text size="xs" ta="left">
                💡 {preset}
              </Text>
            </Button>
          ))}
        </SimpleGrid>
      </Paper>

      <Paper className="metric" p="lg" radius="lg">
        <Stack gap="sm">
          <Textarea
            label="Ask AI about your portfolio"
            placeholder="Type any question about your holdings, allocation, rebalancing, or fees..."
            rows={3}
            value={prompt}
            onChange={e => setPrompt(e.currentTarget.value)}
          />

          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">
              Provider: <Text span fw={600}>{settings.provider}</Text> ({settings.model} @ {settings.endpoint})
            </Text>
            <Button loading={loading} color="teal" onClick={() => void askAI()}>
              Ask AI Advisor
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Accordion variant="separated" radius="lg">
        <Accordion.Item value="preview">
          <Accordion.Control>
            <Group gap="xs">
              <Text size="xs" fw={700} c="dimmed">
                🔒 Privacy Inspection: View Data Context Included With Prompt
              </Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="xs" c="dimmed" mb="xs">
              This exact JSON payload is attached to your prompt so the AI model understands your situation:
            </Text>
            <Box
              component="pre"
              p="md"
              style={{
                borderRadius: 8,
                background: 'var(--mantine-color-dark-8, #1a1b1e)',
                color: '#e0e0e0',
                fontSize: 12,
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {contextJSON}
            </Box>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {advice && (
        <Card className="metric" p="lg" radius="lg">
          <Group justify="space-between" mb="sm">
            <Text fw={700} color="teal">
              🤖 AI Advisor Response
            </Text>
            <Badge color="gray" variant="subtle">
              {settings.model}
            </Badge>
          </Group>
          <Box
            style={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
              fontSize: 14,
            }}
          >
            {advice}
          </Box>
        </Card>
      )}

      <AISettingsModal
        opened={settingsOpened}
        onClose={() => setSettingsOpened(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </Stack>
  );
}

function AISettingsModal({
  opened,
  onClose,
  settings,
  onSave,
}: {
  opened: boolean;
  onClose: () => void;
  settings: AISettings;
  onSave: (newSettings: AISettings) => void;
}) {
  const [provider, setProvider] = useState(settings.provider);
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState(settings.apiKey);

  const handleProviderChange = (val: string | null) => {
    const next = (val as AISettings['provider']) || 'ollama';
    setProvider(next);
    if (next === 'ollama') {
      setEndpoint('http://localhost:11434/v1');
      setModel('llama3.2');
    } else if (next === 'openai') {
      setEndpoint('https://api.openai.com/v1');
      setModel('gpt-4o-mini');
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="AI Advisor Provider Settings" size="md">
      <Stack gap="sm">
        <Select
          label="AI Provider"
          value={provider}
          data={[
            { value: 'ollama', label: 'Local Ollama (Offline / Privacy First)' },
            { value: 'openai', label: 'OpenAI API' },
            { value: 'custom', label: 'Custom OpenAI-Compatible API Endpoint' },
          ]}
          onChange={handleProviderChange}
        />

        <TextInput
          label="API Endpoint URL"
          placeholder="http://localhost:11434/v1"
          value={endpoint}
          onChange={e => setEndpoint(e.currentTarget.value)}
        />

        <TextInput
          label="Model Name"
          placeholder="llama3.2 or gpt-4o-mini"
          value={model}
          onChange={e => setModel(e.currentTarget.value)}
        />

        {provider !== 'ollama' && (
          <PasswordInput
            label="API Key (Optional for local servers)"
            placeholder="sk-..."
            value={apiKey}
            onChange={e => setApiKey(e.currentTarget.value)}
          />
        )}

        <Text size="xs" c="dimmed">
          For local privacy, run <Text span ff="monospace">ollama run llama3.2</Text> locally and use Ollama endpoint.
        </Text>

        <Group justify="end" mt="md">
          <Button
            onClick={() =>
              onSave({
                provider,
                endpoint,
                model,
                apiKey,
              })
            }
          >
            Save Settings
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
