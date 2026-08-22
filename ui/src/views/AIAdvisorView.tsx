import { useState, useEffect } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import type { Account, Holding, Instrument, Summary, AIModelInfo } from '../api';
import { listAIModels, downloadAIModel } from '../api';
import { money, percent } from '../utils/format';

type AISettings = {
  provider: 'local' | 'ollama' | 'openai' | 'custom';
  endpoint: string;
  model: string;
  apiKey: string;
};

const defaultSettings: AISettings = {
  provider: 'local',
  endpoint: 'http://localhost:8080/v1',
  model: 'deepseek-r1-distill-qwen-7b',
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

type MCPToolCallRecord = {
  name: string;
  args: any;
  result: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
  toolCalls?: MCPToolCallRecord[];
};

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
  const [error, setError] = useState('');

  // Persist chat messages temporarily in sessionStorage until refresh
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem('loot.aiChatHistory');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const saveMessages = (nextMessages: ChatMessage[]) => {
    setMessages(nextMessages);
    try {
      sessionStorage.setItem('loot.aiChatHistory', JSON.stringify(nextMessages));
    } catch {
      /* optional */
    }
  };

  const clearChat = () => {
    saveMessages([]);
    try {
      sessionStorage.removeItem('loot.aiChatHistory');
    } catch {
      /* optional */
    }
  };

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

  const formattedAccounts = accounts.map(a => ({
    name: a.name,
    institution: a.institution,
    type: a.type,
    balance: money(a.balance_minor, a.currency),
    notes: a.notes || undefined,
  }));

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
      notes: h.notes || undefined,
    };
  });

  const portfolioContext = {
    baseCurrency: primaryCurrency,
    totalWealth: money(currencyData?.total_minor, primaryCurrency),
    cashBalance: money(currencyData?.balance_minor, primaryCurrency),
    investmentsTotal: money(currencyData?.portfolio_minor, primaryCurrency),
    accountsCount: accounts.length,
    holdingsCount: holdings.length,
    accounts: formattedAccounts,
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
    'Search the 4,000+ ETF catalog for cheap MSCI World ETFs with TER under 0.15%.',
    'Analyze my asset allocation drift and tell me what to rebalance next with €2,000.',
    'What are the biggest risks or overlap vulnerabilities in my current holdings?',
  ];

  // Dynamically fetch and execute MCP tools from backend /mcp
  const fetchMCPTools = async () => {
    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      if (res.ok) {
        const json = await res.json();
        const mcpTools = json.result?.tools ?? [];
        return mcpTools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
        }));
      }
    } catch {
      /* fallback */
    }
    return [
      {
        type: 'function',
        function: {
          name: 'search_instruments',
          description: 'Search the 4,000+ ETF catalog by ISIN, ticker, index name, or provider.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Search term e.g. MSCI World, S&P 500, Gold' } },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_diagnostics',
          description: 'Retrieve active portfolio warnings and health diagnostics.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
  };

  const executeMCPToolCall = async (name: string, args: any) => {
    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name, arguments: args || {} },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.result?.content?.[0]?.text) {
          return json.result.content[0].text;
        }
      }
    } catch {
      /* fallback */
    }

    if (name === 'search_instruments' || name === 'search_etf_catalog') {
      const q = String(args?.query || '').toLowerCase();
      const matches = instruments
        .filter(i => i.name.toLowerCase().includes(q) || i.isin.toLowerCase().includes(q))
        .slice(0, 5);
      return JSON.stringify(matches);
    }
    return JSON.stringify(summary.diagnostics ?? []);
  };

  const askAI = async (queryText = prompt) => {
    const textToSend = queryText.trim();
    if (!textToSend || loading) return;

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedMessages = [...messages, userMsg];
    saveMessages(updatedMessages);
    setPrompt('');
    setLoading(true);
    setError('');

    try {
      const activeTools = await fetchMCPTools();

      const systemPrompt = `You are an expert, local-first financial portfolio AI assistant for LOOT. You have full Model Context Protocol (MCP) access to the backend Proto API tools (/mcp). Use tools like search_instruments, rank_instruments, get_summary, list_holdings, list_accounts, list_snapshots, and get_diagnostics to answer questions accurately. Never give legal or binding tax advice. Keep explanations simple, practical, and clear.`;

      const userContent = `Portfolio Summary Context:\n\`\`\`json\n${contextJSON}\n\`\`\`\n\nUser Question: ${textToSend}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (settings.apiKey) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
      }

      const conversationTrajectory: any[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent },
      ];

      const res = await fetch(`${settings.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: settings.model,
          messages: conversationTrajectory,
          tools: activeTools,
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`AI Provider HTTP ${res.status}: ${errText || res.statusText}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];

      if (choice?.finish_reason === 'tool_calls' || choice?.message?.tool_calls?.length > 0) {
        const toolCalls = choice.message.tool_calls;
        const toolConversation = [...conversationTrajectory, choice.message];
        const executedRecords: MCPToolCallRecord[] = [];

        for (const tc of toolCalls) {
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(tc.function.arguments); } catch { /* optional */ }
          const toolResult = await executeMCPToolCall(tc.function.name, parsedArgs);
          executedRecords.push({
            name: tc.function.name,
            args: parsedArgs,
            result: toolResult,
          });
          toolConversation.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
        }

        const secondRes = await fetch(`${settings.endpoint.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: settings.model,
            messages: toolConversation,
            temperature: 0.3,
          }),
        });

        if (secondRes.ok) {
          const secondData = await secondRes.json();
          const assistantReply = secondData.choices?.[0]?.message?.content || 'No response generated.';
          saveMessages([
            ...updatedMessages,
            {
              id: String(Date.now() + 1),
              role: 'assistant',
              content: assistantReply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              toolCalls: executedRecords,
            },
          ]);
          return;
        }
      }

      const answer = choice?.message?.content || 'No response generated.';
      saveMessages([
        ...updatedMessages,
        {
          id: String(Date.now() + 1),
          role: 'assistant',
          content: answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to reach AI provider. Please check your AI settings endpoint (e.g. Local OpenAI http://localhost:8080/v1 or Ollama http://localhost:11434/v1).'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void askAI();
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Box>
          <Group gap="xs">
            <Title order={2}>AI Portfolio Assistant</Title>
            <Badge color="teal" variant="light">
              MCP Proto API Enabled
            </Badge>
          </Group>
          <Text c="dimmed">
            Ask questions about fee reduction, rebalancing strategy, and risk concentration.
          </Text>
        </Box>
        <Group gap="xs">
          {messages.length > 0 && (
            <Button variant="subtle" color="red" size="xs" onClick={clearChat}>
              🗑 Clear Chat Session
            </Button>
          )}
          <Button variant="default" size="xs" onClick={() => setSettingsOpened(true)}>
            ⚙️ AI Settings ({settings.provider})
          </Button>
        </Group>
      </Group>

      {error && <Alert color="red">{error}</Alert>}

      {messages.length === 0 ? (
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
      ) : (
        <Stack gap="md">
          {messages.map(msg => (
            <Card
              key={msg.id}
              className="metric"
              p="md"
              radius="lg"
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                backgroundColor:
                  msg.role === 'user'
                    ? 'var(--mantine-color-teal-9, rgba(32, 201, 151, 0.12))'
                    : undefined,
                border: msg.role === 'user' ? '1px solid rgba(32, 201, 151, 0.3)' : undefined,
              }}
            >
              <Group justify="space-between" mb="xs">
                <Text size="xs" fw={700} c={msg.role === 'user' ? 'teal' : 'dimmed'}>
                  {msg.role === 'user' ? '👤 You' : '🤖 AI Assistant'}
                </Text>
                <Text size="xs" c="dimmed">
                  {msg.timestamp}
                </Text>
              </Group>

              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <Accordion variant="contained" radius="md" chevronPosition="right" mb="xs">
                  <Accordion.Item value="mcp-calls">
                    <Accordion.Control style={{ padding: '6px 10px' }}>
                      <Group gap="xs" align="center">
                        <Badge color="teal" size="xs" variant="filled">
                          🛠️ MCP Tool Call{msg.toolCalls.length > 1 ? 's' : ''} ({msg.toolCalls.length})
                        </Badge>
                        <Text size="xs" c="dimmed" ff="monospace" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {msg.toolCalls.map(tc => tc.name).join(', ')}
                        </Text>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="xs" pt="xs">
                        {msg.toolCalls.map((tc, idx) => {
                          let prettyResult = tc.result;
                          try {
                            prettyResult = JSON.stringify(JSON.parse(tc.result), null, 2);
                          } catch {
                            /* optional */
                          }
                          return (
                            <Paper key={idx} withBorder p="xs" radius="sm" style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
                              <Group justify="space-between" mb={4}>
                                <Group gap="xs">
                                  <Code color="teal" fw={700}>POST /mcp → {tc.name}</Code>
                                </Group>
                                <Badge size="xs" color="gray" variant="outline">JSON-RPC 2.0</Badge>
                              </Group>

                              <Text size="xs" fw={700} c="dimmed" mt={4}>Input Arguments:</Text>
                              <Code block style={{ fontSize: '11px', maxHeight: '120px', overflow: 'auto', padding: '6px' }}>
                                {JSON.stringify(tc.args, null, 2)}
                              </Code>

                              <Text size="xs" fw={700} c="dimmed" mt={4}>Response Payload:</Text>
                              <Code block style={{ fontSize: '11px', maxHeight: '200px', overflow: 'auto', padding: '6px' }}>
                                {prettyResult}
                              </Code>
                            </Paper>
                          );
                        })}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}

              <Box style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, fontSize: 14 }}>
                {msg.content}
              </Box>
            </Card>
          ))}
        </Stack>
      )}

      <Paper className="metric" p="md" radius="lg">
        <Stack gap="sm">
          <Textarea
            placeholder="Type any question about your holdings, allocation, rebalancing, or fees... (Press Enter to send, Shift+Enter for new line)"
            rows={2}
            value={prompt}
            onChange={e => setPrompt(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />

          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">
              Press <Text span fw={600} ff="monospace">Enter</Text> to send · Active Model: <Text span fw={700} c="teal">{settings.model}</Text> ({settings.provider})
            </Text>
            <Button loading={loading} color="teal" onClick={() => void askAI()}>
              Send Message
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

  const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
  const [downloadInput, setDownloadInput] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState('');
  const [downloadError, setDownloadError] = useState('');

  const loadModels = async () => {
    try {
      const models = await listAIModels();
      setAvailableModels(models);
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    if (!opened) return;
    setProvider(settings.provider);
    setEndpoint(settings.endpoint);
    setModel(settings.model);
    setApiKey(settings.apiKey);
    void loadModels();
    const interval = setInterval(() => {
      void loadModels();
    }, 1000);
    return () => clearInterval(interval);
  }, [opened, settings]);

  const handleProviderChange = (val: string | null) => {
    const next = (val as AISettings['provider']) || 'local';
    setProvider(next);
    if (next === 'local') {
      setEndpoint('http://localhost:8080/v1');
    } else if (next === 'ollama') {
      setEndpoint('http://localhost:11434/v1');
      if (!model || model.startsWith('deepseek') || model.startsWith('qwen')) {
        setModel('llama3.2');
      }
    } else if (next === 'openai') {
      setEndpoint('https://api.openai.com/v1');
      if (!model || !model.startsWith('gpt-')) {
        setModel('gpt-4o-mini');
      }
    }
  };

  const handleDownload = async (targetName = downloadInput) => {
    const query = targetName.trim();
    if (!query) return;
    setDownloading(true);
    setDownloadError('');
    setDownloadNotice('');
    try {
      const res = await downloadAIModel(query);
      if (res.success) {
        setDownloadNotice(res.message);
        setDownloadInput('');
        await loadModels();
        if (res.modelId) {
          setModel(res.modelId);
        }
      }
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloading(false);
    }
  };

  const modelOptions = [
    {
      group: 'Downloaded Local GGUF Models (./data/models/)',
      items: availableModels
        .filter(m => m.is_downloaded)
        .map(m => ({
          value: m.id,
          label: `✓ ${m.name} (${m.size_bytes > 0 ? `${(m.size_bytes / (1024 * 1024 * 1024)).toFixed(1)}GB` : 'Saved'})`,
        })),
    },
    {
      group: 'Recommended Open-Weights Math & Reasoning Models',
      items: availableModels
        .filter(m => !m.is_downloaded)
        .map(m => ({
          value: m.id,
          label: m.is_downloading ? `⏳ [${m.download_percent}%] ${m.name}` : `⬇️ ${m.name}`,
        })),
    },
    {
      group: 'Standard Cloud Models',
      items: [
        { value: 'gpt-4o-mini', label: 'OpenAI gpt-4o-mini' },
        { value: 'gpt-4o', label: 'OpenAI gpt-4o' },
        { value: 'llama3.2', label: 'Ollama llama3.2' },
        { value: 'qwen2.5:3b', label: 'Ollama qwen2.5:3b' },
      ],
    },
  ].filter(g => g.items.length > 0);

  return (
    <Modal opened={opened} onClose={onClose} title="AI Assistant & Model Settings" size="lg">
      <Stack gap="md">
        {downloadError && <Alert color="red" withCloseButton onClose={() => setDownloadError('')}>{downloadError}</Alert>}
        {downloadNotice && <Alert color="teal" withCloseButton onClose={() => setDownloadNotice('')}>{downloadNotice}</Alert>}

        <Paper withBorder p="md" radius="md">
          <Text fw={700} size="sm" mb={4}>Select Active AI Model</Text>
          <Text size="xs" c="dimmed" mb="sm">
            Choose an enabled open-weights model or select a custom model downloaded into <Text span ff="monospace">./data/models/</Text>.
          </Text>

          <Stack gap="sm">
            <Select
              label="Active AI Model"
              placeholder="Pick or type model ID..."
              searchable
              data={modelOptions}
              value={model}
              onChange={val => {
                if (val) {
                  setModel(val);
                  const found = availableModels.find(m => m.id === val);
                  if (found && !found.is_downloaded && !found.is_downloading) {
                    void handleDownload(val);
                  }
                }
              }}
            />

            <Select
              label="AI Provider & API Engine"
              value={provider}
              data={[
                { value: 'local', label: 'Local OpenAI Server (llama-server / Metal GPU @ http://localhost:8080/v1)' },
                { value: 'ollama', label: 'Local Ollama (http://localhost:11434/v1)' },
                { value: 'openai', label: 'OpenAI API (https://api.openai.com/v1)' },
                { value: 'custom', label: 'Custom OpenAI-Compatible API Endpoint' },
              ]}
              onChange={handleProviderChange}
            />

            <TextInput
              label="API Endpoint URL"
              placeholder="http://localhost:8080/v1"
              value={endpoint}
              onChange={e => setEndpoint(e.currentTarget.value)}
            />

            {provider !== 'ollama' && (
              <PasswordInput
                label="API Key (Optional for local servers)"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => setApiKey(e.currentTarget.value)}
              />
            )}
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="md" style={{ backgroundColor: 'rgba(32, 201, 151, 0.04)' }}>
          <Text fw={700} size="sm" mb={4}>🧠 Recommended Reasoning & Financial Math Models</Text>
          <Text size="xs" c="dimmed" mb="md">
            Open-weights models with chain-of-thought verification for portfolio math, fee drag calculations, and zero hallucinations.
          </Text>

          <Stack gap="sm" mb="md">
            {availableModels.map(m => {
              const isSelected = model === m.id;
              return (
                <Card key={m.id} withBorder padding="xs" radius="sm">
                  <Group justify="space-between" align="start">
                    <Box style={{ flex: 1 }}>
                      <Group gap={6} align="center">
                        <Text fw={700} size="xs">{m.name}</Text>
                        {m.is_downloaded && <Badge color="teal" size="xs" variant="light">✓ Downloaded</Badge>}
                        {isSelected && <Badge color="blue" size="xs">Active Model</Badge>}
                      </Group>
                      <Text size="xs" c="dimmed" mt={2}>{m.description}</Text>
                      {m.is_downloaded && m.size_bytes > 0 && (
                        <Text size="xs" c="dimmed" ff="monospace" mt={2}>
                          📁 {m.filename} ({(m.size_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB)
                        </Text>
                      )}
                    </Box>

                    <Box style={{ textAlign: 'right' }}>
                      {m.is_downloaded ? (
                        <Button
                          size="xs"
                          variant={isSelected ? 'filled' : 'outline'}
                          color={isSelected ? 'blue' : 'teal'}
                          onClick={() => setModel(m.id)}
                        >
                          {isSelected ? 'Active' : 'Use Model'}
                        </Button>
                      ) : m.is_downloading ? (
                        <Badge color="orange" size="sm" variant="filled">
                          Downloading {m.download_percent}%
                        </Badge>
                      ) : (
                        <Button
                          size="xs"
                          color="teal"
                          variant="light"
                          loading={downloading}
                          onClick={() => void handleDownload(m.id)}
                        >
                          📥 Download
                        </Button>
                      )}
                    </Box>
                  </Group>

                  {m.is_downloading && (
                    <Stack gap={4} mt="xs">
                      <Group justify="space-between" align="center">
                        <Text size="xs" fw={700} c="teal">Downloading model file into ./data/models/...</Text>
                        <Text size="xs" fw={700} c="teal">{m.download_percent}%</Text>
                      </Group>
                      <Progress value={m.download_percent} animated color="teal" size="sm" radius="xl" />
                    </Stack>
                  )}
                </Card>
              );
            })}
          </Stack>

          <Divider my="sm" label="Download Custom Model" labelPosition="center" />

          <Text size="xs" c="dimmed" mb="xs">
            Enter a Hugging Face repository (e.g. <Text span ff="monospace">Qwen/Qwen2.5-Math-7B-Instruct-GGUF</Text>) or direct GGUF URL:
          </Text>
          <Group align="end" gap="xs">
            <TextInput
              placeholder="e.g. Qwen/Qwen2.5-Math-7B-Instruct-GGUF"
              value={downloadInput}
              onChange={e => setDownloadInput(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              color="teal"
              loading={downloading}
              disabled={!downloadInput.trim()}
              onClick={() => handleDownload()}
            >
              Download Custom
            </Button>
          </Group>
        </Paper>

        <Group justify="end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="teal"
            onClick={() =>
              onSave({
                provider,
                endpoint,
                model,
                apiKey,
              })
            }
          >
            Save AI Settings
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
