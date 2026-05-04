// Story 3.7 — Label format constants.
//
// The default format is a 60×40 mm portrait thermal label, intended for
// continuous-feed label printers (Brother QL-820NWB / DYMO LabelWriter 5XL —
// David's printer model TBC; surfaced as a Sprint-5 follow-up). All
// dimensions are in millimetres so they map 1:1 to React-PDF's `<Page>`
// `unit="mm"` prop.
//
// If David later supplies a Blue-Office-format reference (Q5 resolution),
// add a second constant + a config switch — do NOT replace the default.

export type LabelFormat = {
  /** Page width in mm. */
  width: number;
  /** Page height in mm. */
  height: number;
  /** Unit token consumed by React-PDF's <Page size> + <View style>. */
  unit: "mm";
  /** Outer page margin (all four sides) in mm. */
  margin: number;
  /** Edge length of the QR module square in mm. */
  qrSize: number;
  /** Top-left corner of the QR block, relative to the page origin. */
  qrPosition: { x: number; y: number };
  /** Right-side text block geometry (serial + article identification). */
  textBlock: {
    x: number;
    y: number;
    width: number;
    /** Base font size (points) for the article identification line. Serial
     *  is rendered slightly larger inside the document component. */
    fontSize: number;
  };
};

/**
 * Default 60×40 mm portrait label. Layout:
 *
 *   ┌───────────────────────────────────────────┐
 *   │  ┌──────┐  ┌──────────────────────────┐   │
 *   │  │  QR  │  │  serial (8pt, weight 600) │   │
 *   │  │ 28mm │  │  article# name (6pt)     │   │
 *   │  └──────┘  │  variant (6pt, optional) │   │
 *   │            └──────────────────────────┘   │
 *   └───────────────────────────────────────────┘
 *
 * Margin 2 mm keeps printable content inside the safe-print area for the
 * Brother QL-820NWB (which masks the outer 1 mm of every die-cut label).
 */
export const LABEL_FORMAT_60x40_PORTRAIT: LabelFormat = {
  width: 60,
  height: 40,
  unit: "mm",
  margin: 2,
  qrSize: 28,
  qrPosition: { x: 2, y: 2 },
  textBlock: {
    x: 32,
    y: 4,
    width: 26,
    fontSize: 7,
  },
};
