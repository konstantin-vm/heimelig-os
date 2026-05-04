// Story 3.7 — PDF rendering pipeline.
//
// Pure pipeline: `Device[] + LabelFormat → Blob`. Browser-only — the React-
// PDF renderer is bundled for the browser entry, and `qrcode` resolves to
// its browser-safe `qrcode` entry under Next.js 16 + Turbopack.
//
// Sequence:
//   1. For each device, generate a high-DPI QR PNG data-URL via `qrcode`
//      (errorCorrectionLevel 'M' = 15% recovery — sufficient for thermal-
//      printer scratches).
//   2. Build the React-PDF <Document> tree (one <Page> per device).
//   3. Render to Blob.
//   4. On any failure, throw a typed `QrLabelRenderError` with a structured
//      `code` so the calling hook can route to `logError` + a German toast.
//
// Architecture commitment AR14 + the architecture's "no PDF blob ever
// transits Vercel Frankfurt" rule mean this entire pipeline runs in the
// user's browser. No SSR, no Edge Function.

import { createElement } from "react";
import QRCode from "qrcode";

import { encodeDevicePayload, type EncodableDevice } from "./encode";
import { type LabelFormat } from "./format";

export type QrLabelDeviceData = EncodableDevice & {
  id: string;
  /** Article identification rendered alongside the QR. */
  article_number: string;
  name: string;
  variant_label: string | null;
};

export type RenderArgs = {
  devices: QrLabelDeviceData[];
  format: LabelFormat;
};

/** Caller-stable error type so the React layer can toast the right message. */
export class QrLabelRenderError extends Error {
  readonly code: "pdf_render_failed" | "qr_encode_failed";
  readonly cause?: unknown;

  constructor(
    code: QrLabelRenderError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "QrLabelRenderError";
    this.code = code;
    this.cause = cause;
  }
}

export type QrLabelPayload = {
  device: QrLabelDeviceData;
  qrDataUrl: string;
};

/**
 * Encodes each device's QR payload to a high-DPI PNG data-URL using the
 * single-source `encodeDevicePayload`. `Promise.allSettled` so one corrupt
 * device doesn't kill the whole batch — failures collapse into a single
 * `QrLabelRenderError` listing the offending device-ids.
 *
 * Exported so the live `<PDFViewer>` preview in `<QrLabelPreviewDialog>`
 * can reuse the exact same encoding step as the persist path. Pure (no
 * React-PDF import), so the dialog can call it without pulling in the
 * renderer chunk before the user clicks Speichern/Drucken.
 */
export async function prepareQrPayloads(
  devices: QrLabelDeviceData[],
): Promise<QrLabelPayload[]> {
  const settled = await Promise.allSettled(
    devices.map(async (device) => ({
      device,
      qrDataUrl: await QRCode.toDataURL(encodeDevicePayload(device), {
        errorCorrectionLevel: "M",
        margin: 0,
        scale: 8,
        color: { dark: "#000000", light: "#FFFFFF" },
      }),
    })),
  );

  const failedDeviceIds: string[] = [];
  const qrPayloads: QrLabelPayload[] = [];
  settled.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      qrPayloads.push(result.value);
    } else {
      failedDeviceIds.push(devices[idx]!.id);
    }
  });

  if (failedDeviceIds.length > 0) {
    throw new QrLabelRenderError(
      "qr_encode_failed",
      `QR PNG encoding failed for ${failedDeviceIds.length} device(s): ${failedDeviceIds.join(", ")}`,
    );
  }

  return qrPayloads;
}

/**
 * Generates one QR PNG per device, then renders the React-PDF document tree
 * to a Blob. Browser-only. Throws `QrLabelRenderError` on any failure.
 *
 * The React-PDF imports are resolved inline so this module remains
 * tree-shakeable for any non-PDF caller and so the React-PDF chunk loads
 * lazily only when a print action fires.
 */
export async function renderQrLabelPdf({
  devices,
  format,
}: RenderArgs): Promise<Blob> {
  if (devices.length === 0) {
    throw new QrLabelRenderError(
      "pdf_render_failed",
      "renderQrLabelPdf: no devices supplied",
    );
  }

  const qrPayloads = await prepareQrPayloads(devices);

  // Step 2 + 3 — build the document and render to Blob.
  // Lazy import so the renderer chunk only loads when actually printing.
  try {
    const { pdf } = await import("@react-pdf/renderer");
    const { QrLabelDocument } = await import(
      "@/components/composed/qr-label-document"
    );

    const tree = createElement(QrLabelDocument, {
      devices: qrPayloads,
      format,
    });
    // React-PDF's `pdf()` is typed for `ReactElement<DocumentProps>` even
    // though it accepts any element whose render tree resolves to a
    // <Document>. Our wrapper component IS that <Document>; cast through
    // `unknown` to bypass the over-narrow type rather than re-export the
    // entire DocumentProps surface.
    return await (pdf as (el: unknown) => { toBlob(): Promise<Blob> })(
      tree,
    ).toBlob();
  } catch (cause) {
    throw new QrLabelRenderError(
      "pdf_render_failed",
      "React-PDF render failed",
      cause,
    );
  }
}
