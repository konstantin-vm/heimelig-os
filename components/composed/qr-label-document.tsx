// Story 3.7 — React-PDF document tree.
//
// Pure presentational. One <Page> per device. Uses the React-PDF default
// `Helvetica` font (no CDN fetch — works offline + during Vercel build).
// Fixed black/white colors so labels print correctly on any thermal
// printer regardless of toner/ribbon color (AC-DF clause).
//
// IMPORTANT: this file imports `@react-pdf/renderer` at the module level.
// The library is browser-only and explodes during Next.js' React Server
// Components serialization pass — even though this file already declares
// `"use client"`, transitive imports still get walked. Embed via
// `dynamic(() => import('...'), { ssr: false })` when used inside a
// `<PDFViewer>` preview. `lib/qr-labels/render.ts` imports it lazily
// inside the print mutation for the same reason.

"use client";

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { LabelFormat } from "@/lib/qr-labels/format";
import type { QrLabelDeviceData } from "@/lib/qr-labels/render";

export type QrLabelDocumentProps = {
  /** Devices paired with their pre-rendered QR PNG data-URLs. */
  devices: Array<{ device: QrLabelDeviceData; qrDataUrl: string }>;
  format: LabelFormat;
};

export function QrLabelDocument({ devices, format }: QrLabelDocumentProps) {
  const styles = buildStyles(format);

  return (
    <Document
      title="Heimelig OS — QR-Etiketten"
      creator="Heimelig OS"
      producer="Heimelig OS"
    >
      {devices.map(({ device, qrDataUrl }) => (
        <Page
          key={device.id}
          size={[mmToPt(format.width), mmToPt(format.height)]}
          orientation="portrait"
          style={styles.page}
        >
          <View style={styles.row}>
            <Image src={qrDataUrl} style={styles.qr} />
            <View style={styles.textColumn}>
              <Text style={styles.serial}>{device.serial_number}</Text>
              <Text style={styles.articleLine}>
                {device.article_number} {device.name}
              </Text>
              {device.variant_label ? (
                <Text style={styles.variantLine}>
                  {device.variant_label}
                </Text>
              ) : null}
            </View>
          </View>
        </Page>
      ))}
    </Document>
  );
}

// React-PDF measures in points (1pt = 1/72 inch). The format constants
// are in millimetres. 1 mm = 72/25.4 pt — let the compiler produce the
// constant rather than hand-typing 12 decimal digits.
function mmToPt(mm: number): number {
  return mm * (72 / 25.4);
}

function buildStyles(format: LabelFormat) {
  return StyleSheet.create({
    page: {
      padding: mmToPt(format.margin),
      backgroundColor: "#FFFFFF",
      color: "#000000",
    },
    row: {
      flexDirection: "row",
      width: mmToPt(format.width - format.margin * 2),
    },
    qr: {
      width: mmToPt(format.qrSize),
      height: mmToPt(format.qrSize),
    },
    textColumn: {
      marginLeft: mmToPt(format.qrPosition.x),
      width: mmToPt(format.textBlock.width),
      flexDirection: "column",
      justifyContent: "flex-start",
    },
    serial: {
      fontSize: mmToPt(2.5),
      fontWeight: 600,
      marginBottom: mmToPt(0.6),
    },
    articleLine: {
      fontSize: format.textBlock.fontSize,
      marginBottom: mmToPt(0.4),
    },
    variantLine: {
      fontSize: format.textBlock.fontSize,
      color: "#333333",
    },
  });
}
