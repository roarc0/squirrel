import { notifications } from '@mantine/notifications';

export function copyToClipboard(text: string, label = 'ISIN') {
  if (!text) return;
  void navigator.clipboard.writeText(text);
  notifications.show({
    color: 'teal',
    title: 'Copied to Clipboard',
    message: `${label}: ${text}`,
    autoClose: 2500,
  });
}
