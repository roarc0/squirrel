import type { ReactNode } from 'react';
import { Alert, Stack } from '@mantine/core';

export function ViewShell({
  children,
  error,
  onCloseError,
}: {
  children: ReactNode;
  error?: string;
  onCloseError?: () => void;
}) {
  return (
    <Stack gap="lg">
      {error && (
        <Alert color="red" withCloseButton onClose={onCloseError}>
          {error}
        </Alert>
      )}
      {children}
    </Stack>
  );
}
