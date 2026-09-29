// Omitted fields must stay omitted: protobuf optional fields drive partial updates.
export function holdingPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [source, target] of Object.entries({ account_id: 'accountId', instrument_id: 'instrumentId', invested_minor: 'investedMinor', value_minor: 'valueMinor', tax_bps: 'taxBps', pac_bps: 'pacBps' })) {
    if (body[source] !== undefined) patch[target] = BigInt(body[source] as string | number | bigint);
  }
  if (body.is_pac !== undefined) patch.isPac = Boolean(body.is_pac);
  if (body.pac_frequency !== undefined) patch.pacFrequency = body.pac_frequency;
  if (body.notes !== undefined) patch.notes = body.notes;
  return patch;
}
