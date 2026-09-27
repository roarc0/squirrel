import { Alert, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import type { BtpBond } from '../api';

export function BtpDetailModal({ btp, opened, onClose }: { btp: BtpBond | null; opened: boolean; onClose: () => void }) {
  if (!btp) return null;
  return (
    <Modal opened={opened} onClose={onClose} title={btp.name} size="lg">
      <Stack>
        <Text size="sm">{btp.isin} · {btp.bond_type} · Maturity {btp.expiry_date}</Text>
        <Text size="sm">Quote: {btp.price.toFixed(2)} per 100 nominal · Observed {btp.scraped_at || 'unknown'}</Text>
        <Alert color={btp.analytics_available ? 'blue' : 'orange'} title={btp.analytics_available ? 'Estimated returns' : 'Analytics unavailable'}>
          {btp.analytics_note}
        </Alert>
        {btp.analytics_available && <SimpleGrid cols={2}>
          <div><Text size="xs" c="dimmed">Gross annual effective yield</Text><Text>{btp.ytm_gross.toFixed(2)}%</Text></div>
          <div><Text size="xs" c="dimmed">Net annual effective yield</Text><Text>{btp.ytm_net.toFixed(2)}%</Text></div>
          <div><Text size="xs" c="dimmed">Net return to maturity</Text><Text>{btp.total_return_net.toFixed(2)}%</Text></div>
          <div><Text size="xs" c="dimmed">Modified duration</Text><Text>{btp.duration_mod.toFixed(2)}</Text></div>
        </SimpleGrid>}
      </Stack>
    </Modal>
  );
}
