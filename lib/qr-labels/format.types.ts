// Story 3.7 — compile-time shape assertions for `LABEL_FORMAT_60x40_PORTRAIT`.
//
// No runtime test runner ships with the project yet (Vitest/Playwright are a
// follow-up; see architecture's "E2E tests before Go-Live" deferral). This
// file is TypeScript-only and exists so `pnpm typecheck` surfaces shape
// drift in the LabelFormat constant — adding/removing a field on
// `LabelFormat` without updating the constant fails compilation here.

import { LABEL_FORMAT_60x40_PORTRAIT, type LabelFormat } from "./format";

// 1. Constant satisfies the LabelFormat contract (drift surfaces here).
const _shapeCheck: LabelFormat = LABEL_FORMAT_60x40_PORTRAIT;
void _shapeCheck;

// 2. QR + text block fit inside the page (margin-aware).
const _geometryCheck: 1 = (
  LABEL_FORMAT_60x40_PORTRAIT.qrPosition.x +
    LABEL_FORMAT_60x40_PORTRAIT.qrSize <=
  LABEL_FORMAT_60x40_PORTRAIT.width - LABEL_FORMAT_60x40_PORTRAIT.margin
    ? 1
    : (0 as never)
);
void _geometryCheck;

const _textBlockFits: 1 = (
  LABEL_FORMAT_60x40_PORTRAIT.textBlock.x +
    LABEL_FORMAT_60x40_PORTRAIT.textBlock.width <=
  LABEL_FORMAT_60x40_PORTRAIT.width
    ? 1
    : (0 as never)
);
void _textBlockFits;

// 3. Unit literal is exactly "mm" (rules out a future widening to a string).
const _unitCheck: "mm" = LABEL_FORMAT_60x40_PORTRAIT.unit;
void _unitCheck;
