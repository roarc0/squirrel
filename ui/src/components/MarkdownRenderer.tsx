import { useState } from 'react';
import { ActionIcon, Badge, Box, Code, Group, List, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Paper
      withBorder
      radius="md"
      my="xs"
      style={{
        backgroundColor: '#141517',
        borderColor: '#2c2e33',
        overflow: 'hidden',
      }}
    >
      <Group justify="space-between" px="sm" py={4} style={{ backgroundColor: '#1a1b1e', borderBottom: '1px solid #2c2e33' }}>
        <Badge size="xs" color="teal" variant="light" tt="lowercase" ff="monospace">
          {language || 'code'}
        </Badge>
        <Tooltip label={copied ? 'Copied!' : 'Copy Code'}>
          <ActionIcon size="xs" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copyToClipboard}>
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box p="sm" style={{ overflowX: 'auto' }}>
        <Code block style={{ backgroundColor: 'transparent', padding: 0, margin: 0, fontFamily: 'monospace', fontSize: 13, color: '#e0e0e0', lineHeight: 1.5 }}>
          {code}
        </Code>
      </Box>
    </Paper>
  );
}

export function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  // Split content by code blocks ```lang ... ```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore) {
      elements.push(<TextMarkdown key={`text-${lastIndex}`} text={textBefore} />);
    }

    const language = match[1] ? match[1].trim() : '';
    const code = match[2] ? match[2].replace(/\n$/, '') : '';
    elements.push(<CodeBlock key={`code-${match.index}`} code={code} language={language} />);

    lastIndex = codeBlockRegex.lastIndex;
  }

  const remainingText = content.substring(lastIndex);
  if (remainingText) {
    elements.push(<TextMarkdown key={`text-${lastIndex}`} text={remainingText} />);
  }

  return <Stack gap="xs">{elements}</Stack>;
}

function TextMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const renderedLines: React.ReactNode[] = [];

  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (inList && listItems.length > 0) {
      renderedLines.push(
        <List key={`list-${renderedLines.length}`} size="sm" spacing={3} my={4} withPadding>
          {listItems}
        </List>
      );
      listItems = [];
      inList = false;
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    // Check headings
    if (trimmed.startsWith('# ')) {
      flushList();
      renderedLines.push(<Title key={idx} order={3} mt="xs" mb={4}>{formatInline(trimmed.substring(2))}</Title>);
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      renderedLines.push(<Title key={idx} order={4} mt="xs" mb={4}>{formatInline(trimmed.substring(3))}</Title>);
      return;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      renderedLines.push(<Title key={idx} order={5} mt="xs" mb={4}>{formatInline(trimmed.substring(4))}</Title>);
      return;
    }

    // Check bullet lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      inList = true;
      const bulletText = trimmed.replace(/^([-*]|\d+\.)\s+/, '');
      listItems.push(<List.Item key={idx}>{formatInline(bulletText)}</List.Item>);
      return;
    }

    flushList();
    renderedLines.push(
      <Text key={idx} size="sm" style={{ lineHeight: 1.6, wordBreak: 'break-word' }}>
        {formatInline(line)}
      </Text>
    );
  });

  flushList();

  return <Box>{renderedLines}</Box>;
}

function formatInline(text: string): React.ReactNode[] {
  // Parse inline code `code`, **bold**, *italic*
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((token, i) => {
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <Code key={i} color="teal" variant="light" style={{ padding: '2px 6px', fontSize: '0.85em' }}>
          {token.slice(1, -1)}
        </Code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**')) {
      return <Text span fw={700} key={i}>{token.slice(2, -2)}</Text>;
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <Text span fs="italic" key={i}>{token.slice(1, -1)}</Text>;
    }
    return token;
  });
}
