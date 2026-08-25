import { useState, useEffect, useRef } from 'react';
import { IconSquareFilled, IconTrash, IconSettings } from '@tabler/icons-react';
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
import type { Account, Holding, Instrument, Summary, AIModelInfo, OllamaModelInfo } from '../api';
import { ViewShell } from '../components/ViewShell';
import { SectionHeader } from '../components/SectionHeader';
import { listAIModels, downloadAIModel, streamChat, listOllamaModels, loadOllamaModel, restartLocalServer } from '../api';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { money, percent } from '../utils/format';

type AISettings = {
  provider: 'local' | 'ollama' | 'openai' | 'custom';
  endpoint: string;
  model: string;
  apiKey: string;
  contextSize: number;
};

const defaultSettings: AISettings = {
  provider: 'local',
  endpoint: 'http://localhost:8080/v1',
  model: 'deepseek-r1-distill-qwen-7b',
  apiKey: '',
  contextSize: 16384,
};

function getSavedSettings(): AISettings {
  try {
    const raw = localStorage.getItem('loot.aiSettings');
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    return {
      ...defaultSettings,
      ...parsed,
      contextSize: parsed.contextSize ? Number(parsed.contextSize) : defaultSettings.contextSize,
    };
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
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  timestamp: string;
  toolName?: string;
  toolCalls?: MCPToolCallRecord[];
};

export function AIConsultantView({
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
  const [detectedNCtx, setDetectedNCtx] = useState<number>(0);

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
    setError('');
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

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const stopAI = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
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

    const assistantMsgId = String(Date.now() + 1);
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    let currentMessages = [...updatedMessages, initialAssistantMsg];
    saveMessages(currentMessages);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let accumulatedText = '';
      const toolRecords: MCPToolCallRecord[] = [];
      const detectLoop = (text: string): boolean => {
        if (text.length < 240) return false;
        const tail = text.slice(-300);
        const seg = tail.slice(0, 60).trim();
        if (seg.length < 20) return false;
        const escaped = seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = tail.match(new RegExp(escaped, 'g'));
        return (matches?.length ?? 0) >= 4;
      };

      const stream = streamChat(
        {
          provider: settings.provider,
          endpoint: settings.endpoint,
          model: settings.model,
          apiKey: settings.apiKey,
          contextSize: settings.contextSize || 16384,
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          portfolioContextJson: contextJSON,
        },
        { signal: controller.signal }
      );

      for await (const chunk of stream) {
        if (chunk.actualNCtx && chunk.actualNCtx > 0) {
          setDetectedNCtx(chunk.actualNCtx);
        }
        if (chunk.isMcpToolCall && chunk.toolName) {
          let args = {};
          try { args = JSON.parse(chunk.toolArgsJson); } catch { /* optional */ }
          toolRecords.push({
            name: chunk.toolName,
            args,
            result: chunk.toolResultJson,
          });
        }
        if (chunk.deltaText) {
          accumulatedText += chunk.deltaText;
          if (detectLoop(accumulatedText)) {
            controller.abort();
            accumulatedText = accumulatedText.slice(0, -300).trimEnd() + '\n\n*(generation stopped: repetition loop detected)*';
          }
          currentMessages = currentMessages.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: accumulatedText,
                  toolCalls: toolRecords.length > 0 ? toolRecords : undefined,
                }
              : m
          );
          saveMessages(currentMessages);
        }
      }
    } catch (cause) {
      if (cause instanceof Error && (cause.name === 'AbortError' || cause.message.toLowerCase().includes('abort'))) {
        return;
      }

      const errMsg =
        cause instanceof Error
          ? cause.message
          : 'Failed to stream from AI provider. Please check your AI settings endpoint (e.g. Local OpenAI http://localhost:8080/v1 or Ollama http://localhost:11434/v1).';
      setError(errMsg);

      const errorMsg: ChatMessage = {
        id: String(Date.now() + 2),
        role: 'error',
        content: errMsg,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const filtered = currentMessages.filter(m => m.id !== assistantMsgId || m.content.trim().length > 0);
      saveMessages([...filtered, errorMsg]);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void askAI();
    }
  };

  return (
    <ViewShell error={error} onCloseError={() => setError('')}>
      <SectionHeader
        title="AI Portfolio Consultant"
        subtitle="Interactive portfolio analysis and financial planning assistant."
        badge={<Badge color="teal" variant="light">MCP Proto API Enabled</Badge>}
        actions={
          <Group gap="xs">
            {messages.length > 0 && (
              <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={clearChat}>
                Clear Chat Session
              </Button>
            )}
            <Button variant="default" size="xs" leftSection={<IconSettings size={14} />} onClick={() => setSettingsOpened(true)}>
              AI Settings ({settings.provider} · {settings.contextSize >= 1024 ? `${Math.round(settings.contextSize / 1024)}K` : settings.contextSize})
            </Button>
          </Group>
        }
      />

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
          {messages.map(msg => {
            if (msg.role === 'error') {
              return (
                <Alert
                  key={msg.id}
                  color="red"
                  variant="light"
                  radius="lg"
                  title="AI Execution Error"
                  style={{ maxWidth: '85%', alignSelf: 'flex-start', borderLeft: '4px solid var(--mantine-color-red-6)' }}
                >
                  <Group justify="space-between" align="start" mb={6}>
                    <Text size="xs" c="dimmed">{msg.timestamp}</Text>
                  </Group>
                  <Text size="xs" mb="sm" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {msg.content}
                  </Text>
                  <Group gap="xs">
                    <Button size="xs" color="red" variant="filled" onClick={() => setSettingsOpened(true)}>
                      Configure AI Settings
                    </Button>
                  </Group>
                </Alert>
              );
            }

            return (
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
                      ? 'light-dark(var(--mantine-color-teal-1), var(--mantine-color-teal-9))'
                      : 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))',
                  border: msg.role === 'user'
                    ? '1px solid light-dark(var(--mantine-color-teal-3), rgba(32,201,151,0.3))'
                    : '1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))',
                }}
              >
                <Group justify="space-between" mb="xs">
                  <Text size="xs" fw={700} c={msg.role === 'user' ? 'teal.7' : 'dimmed'}>
                    {msg.role === 'user' ? 'You' : 'AI Consultant'}
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
                            MCP Tool Call{msg.toolCalls.length > 1 ? 's' : ''} ({msg.toolCalls.length})
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
                              <Paper key={idx} withBorder p="xs" radius="sm" style={{ backgroundColor: 'light-dark(var(--mantine-color-gray-1), rgba(0,0,0,0.2))' }}>
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

                <Box style={{ lineHeight: 1.5, fontSize: 14 }}>
                  <MarkdownRenderer content={msg.content} />
                </Box>
              </Card>
            );
          })}
        </Stack>
      )}
      <div ref={messagesEndRef} style={{ height: 1 }} />

      <Paper
        className="metric"
        p="md"
        radius="lg"
        style={{
          position: 'sticky',
          bottom: 12,
          zIndex: 100,
          backgroundColor: 'light-dark(white, var(--mantine-color-dark-7))',
          border: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
          boxShadow: 'light-dark(0 4px 24px rgba(0,0,0,0.10), 0 -4px 20px rgba(0,0,0,0.4))',
        }}
      >
        <Stack gap="sm">
          <Textarea
            placeholder="Type any question about your investment portfolio, allocation, rebalancing, or fee drag... (Press Enter to send, Shift+Enter for new line)"
            rows={2}
            value={prompt}
            onChange={e => setPrompt(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />

          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">
              Press <Text span fw={600} ff="monospace">Enter</Text> to send · Active Model: <Text span fw={700} c="teal">{settings.model}</Text> ({settings.provider} · {detectedNCtx > 0 && detectedNCtx !== settings.contextSize ? (
                <Text span>
                  <Text span fw={700} c="orange">{detectedNCtx >= 1024 ? `${Math.round(detectedNCtx / 1024)}K` : detectedNCtx} Context</Text>
                  <Text span c="dimmed" size="xs"> (server limit; configured {settings.contextSize >= 1024 ? `${Math.round(settings.contextSize / 1024)}K` : settings.contextSize}K — restart server with <Text span ff="monospace">just ai-start</Text>)</Text>
                </Text>
              ) : (
                <Text span fw={700} c="teal">{settings.contextSize >= 1024 ? `${Math.round(settings.contextSize / 1024)}K` : settings.contextSize} Context</Text>
              )})
            </Text>
            {loading ? (
              <Button
                color="red"
                variant="filled"
                leftSection={<IconSquareFilled size={14} />}
                onClick={stopAI}
              >
                Stop Generation
              </Button>
            ) : (
              <Button
                color="teal"
                disabled={!prompt.trim()}
                onClick={() => void askAI()}
              >
                Send Message
              </Button>
            )}
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
    </ViewShell>
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
  const [contextSize, setContextSize] = useState(settings.contextSize || 16384);

  const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaLoadNotice, setOllamaLoadNotice] = useState('');
  const [ollamaLoadError, setOllamaLoadError] = useState('');
  const [localServerLoading, setLocalServerLoading] = useState(false);
  const [localServerNotice, setLocalServerNotice] = useState('');
  const [localServerError, setLocalServerError] = useState('');
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

  const fetchOllamaModels = async (ep: string) => {
    try {
      const models = await listOllamaModels(ep);
      setOllamaModels(models);
    } catch {
      setOllamaModels([]);
    }
  };

  const handleLoadOllamaModel = async () => {
    setOllamaLoading(true);
    setOllamaLoadError('');
    setOllamaLoadNotice('');
    try {
      const res = await loadOllamaModel(endpoint, model, contextSize);
      if (res.success) {
        setOllamaLoadNotice(res.message);
      } else {
        setOllamaLoadError(res.message || 'Failed to load model');
      }
    } catch (cause) {
      setOllamaLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOllamaLoading(false);
    }
  };

  useEffect(() => {
    if (!opened) return;
    setProvider(settings.provider);
    setEndpoint(settings.endpoint);
    setModel(settings.model);
    setApiKey(settings.apiKey);
    setContextSize(settings.contextSize || 16384);
    void loadModels();
    if (settings.provider === 'ollama') {
      void fetchOllamaModels(settings.endpoint);
    }
    const interval = setInterval(() => {
      void loadModels();
    }, 1000);
    return () => clearInterval(interval);
  }, [opened, settings]);

  const handleRestartLocalServer = async () => {
    const found = availableModels.find(m => m.id === model);
    const filename = found?.filename ?? (model.endsWith('.gguf') ? model : model + '.gguf');
    setLocalServerLoading(true);
    setLocalServerError('');
    setLocalServerNotice('');
    try {
      const portNum = endpoint.match(/:(\d+)/)?.[1];
      const res = await restartLocalServer(filename, contextSize, portNum ? Number(portNum) : 8080);
      if (res.success) {
        setLocalServerNotice(res.message);
      } else {
        setLocalServerError(res.message || 'Failed to restart server');
      }
    } catch (cause) {
      setLocalServerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLocalServerLoading(false);
    }
  };

  const handleProviderChange = (val: string | null) => {
    const next = (val as AISettings['provider']) || 'local';
    setProvider(next);
    if (next === 'local') {
      setEndpoint('http://localhost:8080/v1');
    } else if (next === 'ollama') {
      const ollamaEndpoint = 'http://localhost:11434/v1';
      setEndpoint(ollamaEndpoint);
      void fetchOllamaModels(ollamaEndpoint);
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

  const modelOptions = provider === 'ollama'
    ? [
        {
          group: ollamaModels.length > 0 ? 'Ollama Models (from running instance)' : 'Ollama Models',
          items: ollamaModels.length > 0
            ? ollamaModels.map(m => ({
                value: m.name,
                label: `${m.name} (${m.size_bytes > 0 ? `${(m.size_bytes / (1024 * 1024 * 1024)).toFixed(1)}GB` : 'local'})`,
              }))
            : [
                { value: 'llama3.2', label: 'llama3.2' },
                { value: 'qwen2.5:3b', label: 'qwen2.5:3b' },
                { value: 'deepseek-r1:7b', label: 'deepseek-r1:7b' },
              ],
        },
      ]
    : [
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
          ],
        },
      ].filter(g => g.items.length > 0);

  return (
    <Modal opened={opened} onClose={onClose} title="AI Consultant & Model Settings" size="lg">
      <Stack gap="md">
        {downloadError && <Alert color="red" withCloseButton onClose={() => setDownloadError('')}>{downloadError}</Alert>}
        {downloadNotice && <Alert color="teal" withCloseButton onClose={() => setDownloadNotice('')}>{downloadNotice}</Alert>}

        <Paper withBorder p="md" radius="md">
          <Text fw={700} size="sm" mb={4}>Select Active AI Model & Server Context</Text>
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
              label="Context Window Limit (Tokens)"
              description="Maximum context window allocated for prompt trajectory & portfolio context. Automatic trajectory pruning prevents overflow errors."
              value={String(contextSize)}
              data={[
                { value: '4096', label: '4,096 Tokens (4K)' },
                { value: '8192', label: '8,192 Tokens (8K)' },
                { value: '16384', label: '16,384 Tokens (16K - Recommended Default)' },
                { value: '32768', label: '32,768 Tokens (32K)' },
                { value: '65536', label: '65,536 Tokens (64K)' },
                { value: '131072', label: '131,072 Tokens (128K)' },
              ]}
              onChange={val => val && setContextSize(Number(val))}
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

            {provider === 'local' && (
              <Box>
                {localServerError && (
                  <Alert color="red" mb="xs" withCloseButton onClose={() => setLocalServerError('')}>
                    {localServerError}
                  </Alert>
                )}
                {localServerNotice && (
                  <Alert color="teal" mb="xs" withCloseButton onClose={() => setLocalServerNotice('')}>
                    {localServerNotice}
                  </Alert>
                )}
                <Button
                  size="xs"
                  variant="light"
                  color="blue"
                  loading={localServerLoading}
                  onClick={handleRestartLocalServer}
                >
                  Reload Server with Model & Context
                </Button>
                <Text size="xs" c="dimmed" mt={4}>
                  Kills and restarts llama-server with <Text span ff="monospace">{availableModels.find(m => m.id === model)?.filename ?? model}</Text> and {contextSize >= 1024 ? `${Math.round(contextSize / 1024)}K` : contextSize} token context. Server will be unavailable for ~5–10 seconds.
                </Text>
              </Box>
            )}

            {provider === 'ollama' && (
              <Box>
                {ollamaLoadError && (
                  <Alert color="red" mb="xs" withCloseButton onClose={() => setOllamaLoadError('')}>
                    {ollamaLoadError}
                  </Alert>
                )}
                {ollamaLoadNotice && (
                  <Alert color="teal" mb="xs" withCloseButton onClose={() => setOllamaLoadNotice('')}>
                    {ollamaLoadNotice}
                  </Alert>
                )}
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="light"
                    color="teal"
                    loading={ollamaLoading}
                    onClick={handleLoadOllamaModel}
                  >
                    Load Model with Context
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => void fetchOllamaModels(endpoint)}
                  >
                    Refresh Models
                  </Button>
                </Group>
                <Text size="xs" c="dimmed" mt={4}>
                  Preloads <Text span ff="monospace">{model}</Text> in Ollama with {contextSize >= 1024 ? `${Math.round(contextSize / 1024)}K` : contextSize} token context window. Required when the model is already loaded with a smaller context.
                </Text>
              </Box>
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
                contextSize,
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
