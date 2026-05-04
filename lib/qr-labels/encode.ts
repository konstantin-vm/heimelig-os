// Story 3.7 — QR payload encoder.
//
// SINGLE SOURCE OF TRUTH for what gets serialized into the QR module of a
// printed label. Q5 (QR-format compatibility with Blue Office, see
// docs/internal/open-questions/2026-04-30_review.md) was OPEN at story
// creation (2026-05-04). This story ships with the documented assumption
// that the QR payload is the device's existing `qr_code` value when set,
// or — for newly-registered devices whose `qr_code` is still NULL — the
// plaintext `serial_number`.
//
// If Q5 later lands as option B ("formats different but mappable"), this
// is the ONE file that needs to change — e.g.:
//
//   return device.qr_code ?? formatHeimeligSerial(device.serial_number);
//
// Downstream consumers (lib/qr-labels/render.ts, lib/queries/qr-labels.ts,
// scripts/smoke-3-7.sql) MUST never inline the encoding logic.

export type EncodableDevice = {
  serial_number: string;
  qr_code: string | null;
};

/**
 * Returns the string that gets serialized into a label's QR module.
 *
 * Pre-print, callers MUST also persist this value back to `devices.qr_code`
 * (when null) via the `set_device_qr_code` RPC so subsequent scans through
 * Story 3.5 / 8.3 land back on the same row.
 *
 * Empty string `qr_code` is treated as nullish so a stale Blue-Office row
 * with `qr_code = ''` falls back to `serial_number` instead of crashing
 * `QRCode.toDataURL("")` (which throws "No input text").
 */
export function encodeDevicePayload(device: EncodableDevice): string {
  return device.qr_code && device.qr_code.length > 0
    ? device.qr_code
    : device.serial_number;
}
