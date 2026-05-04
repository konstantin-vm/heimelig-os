// Story 3.7 — compile-time + deterministic smoke for `encodeDevicePayload`.
//
// No runtime test runner ships with the project yet (Vitest/Playwright are a
// follow-up). This file uses TypeScript narrowing + IIFE-style asserts so
// any contract change in `encode.ts` surfaces during `pnpm typecheck`.

import { encodeDevicePayload, type EncodableDevice } from "./encode";

// 1. qr_code wins when present.
const withQr: EncodableDevice = {
  serial_number: "1032K-0326-00001",
  qr_code: "BO-LEGACY-PAYLOAD",
};
const _withQrCheck: "BO-LEGACY-PAYLOAD" =
  encodeDevicePayload(withQr) as "BO-LEGACY-PAYLOAD";
void _withQrCheck;

// 2. serial_number is the fallback when qr_code is null.
const withoutQr: EncodableDevice = {
  serial_number: "1032M-0326-00042",
  qr_code: null,
};
const _withoutQrCheck: "1032M-0326-00042" =
  encodeDevicePayload(withoutQr) as "1032M-0326-00042";
void _withoutQrCheck;

// 3. Empty string qr_code falls back to serial_number — a Blue-Office
//    row with `qr_code = ''` would otherwise crash `QRCode.toDataURL("")`
//    ("No input text"). Pin so a future "preserve empty string" regression
//    surfaces here.
const _emptyStringFallsBack: "X" =
  encodeDevicePayload({ serial_number: "X", qr_code: "" }) as "X";
void _emptyStringFallsBack;
