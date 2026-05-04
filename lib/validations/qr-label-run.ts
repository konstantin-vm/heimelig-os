// Story 3.7 — Zod schemas for `qr_label_runs`.
//
// Mirrors migration 00050 column-by-column. The storage_path regex is the
// EXACT shape the database CHECK constraint enforces — drift here would
// surface as a 23514 from PostgREST instead of a friendly Zod message.

import { z } from "zod";

import { isoTimestampSchema, uuidSchema } from "./common";

export const qrLabelRunStatusValues = ["completed", "failed"] as const;
export const qrLabelRunStatusSchema = z.enum(qrLabelRunStatusValues, {
  error: "Ungültiger Status für QR-Etiketten-Druck",
});

export type QrLabelRunStatus = z.infer<typeof qrLabelRunStatusSchema>;

// `qr-labels/{article_id}/{batch_id}.pdf` — both segments are UUIDs (lowercase
// hex with hyphens; the DB CHECK uses ::text concat which produces lowercase).
const QR_LABEL_STORAGE_PATH_REGEX =
  /^qr-labels\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

export const qrLabelStoragePathSchema = z.string().regex(
  QR_LABEL_STORAGE_PATH_REGEX,
  {
    error:
      "Storage-Pfad muss dem Schema qr-labels/{article_id}/{batch_id}.pdf entsprechen",
  },
);

export const qrLabelRunCreateSchema = z
  .object({
    article_id: uuidSchema,
    batch_id: uuidSchema,
    device_ids: z
      .array(uuidSchema)
      .min(1, { error: "Mindestens ein Gerät erforderlich" }),
    storage_path: qrLabelStoragePathSchema,
    status: qrLabelRunStatusSchema.default("completed"),
    failure_reason: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const expected = `qr-labels/${data.article_id}/${data.batch_id}.pdf`;
    if (data.storage_path !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["storage_path"],
        message:
          "storage_path muss aus article_id + batch_id zusammengesetzt sein",
      });
    }
  });

export type QrLabelRunCreate = z.infer<typeof qrLabelRunCreateSchema>;

export const qrLabelRunSchema = z.object({
  id: uuidSchema,
  article_id: uuidSchema,
  batch_id: uuidSchema,
  device_ids: z.array(uuidSchema),
  device_count: z.number().int().nonnegative(),
  status: qrLabelRunStatusSchema,
  failure_reason: z.string().nullable(),
  storage_path: qrLabelStoragePathSchema,
  created_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
});

export type QrLabelRun = z.infer<typeof qrLabelRunSchema>;
