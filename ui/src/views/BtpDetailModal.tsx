import { useState, useMemo } from 'react';
import {
  Badge,
  Box,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconCalendarEvent,
  IconCoins,
  IconFileCertificate,
  IconTrendingUp,
  IconPigMoney,
  IconReceiptTax,
} from '@tabler/icons-react';
import type { BtpBond } from '../api';
import { Chip } from '../Chip';

type CouponPayment = {
  index: number;
  dateStr: string;
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  cumulativeNet: number;
  isMaturity: boolean;
};

export function BtpDetailModal({
  btp,
  opened,
  onClose,
}: {
  btp: BtpBond | null;
  opened: boolean;
  onClose: () => void;
}) {
  const [investment, setInvestment] = useState<number>(100_000);

  const simulation = useMemo(() => {
    if (!btp || btp.price <= 0) {
      return {
        nominalValue: 0,
        actualCost: 0,
        semiAnnualGross: 0,
        semiAnnualNet: 0,
        annualNet: 0,
        capitalGainNet: 0,
        totalNetProfit: 0,
        schedule: [] as CouponPayment[],
      };
    }

    const inv = investment > 0 ? investment : 100_000;
    // BTPs are quoted as price per 100 nominal (e.g. 98.15 means €98.15 per €100 nominal)
    const nominalValue = Math.floor(inv / (btp.price / 100));
    const actualCost = (nominalValue * btp.price) / 100;

    const semiAnnualCouponPct = btp.coupon / 2.0;
    const semiAnnualGross = (nominalValue * semiAnnualCouponPct) / 100;
    const semiAnnualNet = semiAnnualGross * (1.0 - 0.125);
    const annualNet = semiAnnualNet * 2;

    const totalRedemptionGross = nominalValue;
    const totalCapGainGross = nominalValue - actualCost;
    const totalCapGainNet =
      totalCapGainGross > 0 ? totalCapGainGross * (1.0 - 0.125) : totalCapGainGross;

    // Parse Expiry Date: DD/MM/YYYY
    const parts = btp.expiry_date.split('/');
    const schedule: CouponPayment[] = [];
    let cumulativeNet = 0;

    if (parts.length === 3 && btp.coupon > 0) {
      const expDay = parseInt(parts[0], 10);
      const expMonth = parseInt(parts[1], 10);
      const expYear = parseInt(parts[2], 10);

      const m1 = expMonth;
      const m2 = ((expMonth + 5) % 12) + 1; // 6 months prior

      const now = new Date();
      const currentYear = now.getFullYear();
      let paymentIdx = 1;

      for (let y = currentYear; y <= expYear; y++) {
        // Generate both semester dates in year y
        const monthList = [m2, m1].sort((a, b) => a - b);
        for (const m of monthList) {
          const pDate = new Date(y, m - 1, expDay);
          if (pDate > now) {
            const isMaturity =
              y === expYear && m === expMonth;
            if (pDate <= new Date(expYear, expMonth - 1, expDay + 2)) {
              cumulativeNet += semiAnnualNet;
              const dateFormatted = `${String(expDay).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
              schedule.push({
                index: paymentIdx++,
                dateStr: dateFormatted,
                grossAmount: semiAnnualGross,
                taxAmount: semiAnnualGross * 0.125,
                netAmount: semiAnnualNet,
                cumulativeNet,
                isMaturity,
              });
            }
          }
        }
      }
    }

    const totalNetProfit = cumulativeNet + totalCapGainNet;

    return {
      nominalValue,
      actualCost,
      semiAnnualGross,
      semiAnnualNet,
      annualNet,
      capitalGainNet: totalCapGainNet,
      totalNetProfit,
      schedule,
    };
  }, [btp, investment]);

  if (!btp) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconFileCertificate size={22} color="var(--mantine-color-blue-6)" />
          <Box>
            <Text fw={750} size="lg">
              {btp.name}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace">
              {btp.isin} · {btp.bond_type}
            </Text>
          </Box>
        </Group>
      }
      size="xl"
      radius="lg"
    >
      <Stack gap="md">
        {/* Top Controls: Investment Amount Simulator */}
        <Paper p="md" radius="md" withBorder style={{ background: 'var(--mantine-color-body)' }}>
          <Group justify="space-between" align="center" wrap="wrap" gap="md">
            <Box style={{ flex: 1, minWidth: 200 }}>
              <Text fw={700} size="sm">
                Investment Simulation (€)
              </Text>
              <Text size="xs" c="dimmed">
                Simulate cashflow schedule (cedole) & maturity total net profit
              </Text>
            </Box>
            <NumberInput
              prefix="€ "
              value={investment}
              onChange={val => setInvestment(Number(val || 100_000))}
              min={1_000}
              step={5_000}
              w={200}
              size="sm"
            />
          </Group>
        </Paper>

        {/* Stats Grid */}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          <Card p="sm" radius="md" withBorder>
            <Text size="xs" c="dimmed">Nominal Purchased</Text>
            <Text fw={750} size="md">
              €{simulation.nominalValue.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">Cost: €{simulation.actualCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
          </Card>

          <Card p="sm" radius="md" withBorder>
            <Text size="xs" c="dimmed">Net Coupon / Semester</Text>
            <Text fw={750} size="md" c="teal">
              €{simulation.semiAnnualNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text size="xs" c="dimmed">€{simulation.annualNet.toLocaleString(undefined, { maximumFractionDigits: 0 })} / yr net</Text>
          </Card>

          <Card p="sm" radius="md" withBorder>
            <Text size="xs" c="dimmed">Capital Gain at Maturity</Text>
            <Text fw={750} size="md" c={simulation.capitalGainNet >= 0 ? 'green' : 'red'}>
              {simulation.capitalGainNet >= 0 ? '+' : ''}€
              {simulation.capitalGainNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text size="xs" c="dimmed">Redemption @ 100.0</Text>
          </Card>

          <Card p="sm" radius="md" withBorder>
            <Text size="xs" c="dimmed">Total Lifetime Net Profit</Text>
            <Text fw={750} size="md" c="teal">
              +€{simulation.totalNetProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text size="xs" c="dimmed">Coupons + Cap Gain</Text>
          </Card>
        </SimpleGrid>

        <Divider label="Cashflow Schedule (Tabella Cedole)" labelPosition="center" />

        {/* Coupon Table */}
        {btp.coupon === 0 ? (
          <Paper p="lg" radius="md" withBorder style={{ textAlign: 'center' }}>
            <IconCoins size={32} color="var(--mantine-color-dimmed)" />
            <Text fw={650} mt="xs">
              Zero Coupon Bond (CTZ / Strip)
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              No intermediate coupon payments. 100% of return is earned via capital gain upon maturity redemption on {btp.expiry_date}.
            </Text>
          </Paper>
        ) : (
          <Box style={{ maxHeight: 340, overflowY: 'auto' }}>
            <Table striped highlightOnHover verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>Payment Date</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Gross Coupon</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Tax (12.5%)</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Net Cashflow</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Cumulative Net</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {simulation.schedule.map(item => (
                  <Table.Tr
                    key={item.index}
                    style={
                      item.isMaturity
                        ? { background: 'rgba(18, 184, 134, 0.08)', fontWeight: 600 }
                        : undefined
                    }
                  >
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        #{item.index}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Text size="xs" fw={item.isMaturity ? 700 : 500}>
                          {item.dateStr}
                        </Text>
                        {item.isMaturity && (
                          <Badge size="xs" color="teal">
                            Maturity & Redemption
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs">
                        €{item.grossAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="dimmed">
                        -€{item.taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" fw={700} c="teal">
                        +€{item.netAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" fw={600}>
                        €{item.cumulativeNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Stack>
    </Modal>
  );
}
