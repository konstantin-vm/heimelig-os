// Story 3.7 — Storage upload + qr_label_runs persistence + signed URL.
//
// `persistAndOpen` is the single sanctioned writer for the qr-labels bucket
// from the application layer (Service-Role calls would bypass the bucket
// RLS — anti-pattern per CLAUDE.md). Sequence:
//
//   1. Compute the canonical Storage path: qr-labels/{articleId}/{batchId}.pdf
//      (matches the CHECK constraint in migration 00050).
//   2. Upload the Blob with `upsert: false` so a duplicate `batch_id`
//      (e.g. a double-submit) collides on the unique batch_id constraint
//      at the qr_label_runs row insert step.
//   3. Insert the qr_label_runs row (article_id + batch_id + device_ids +
//      status + storage_path). RLS allows admin/office/warehouse INSERT.
//   4. Generate a 60-second signed URL that the dialog uses for the
//      browser-side print / download actions.
//   5. On Storage failure or RLS deny, route to `logError` (IDs only — no
//      PII per Story 1.5 AC14) and bubble a typed error so the calling
//      hook can toast a German message.

import type { SupabaseClient } from "@supabase/supabase-js";

import { logError } from "@/lib/utils/error-log";

export class QrLabelPersistError extends Error {
  readonly code:
    | "storage_upload_failed"
    | "rls_denied"
    | "signed_url_failed"
    | "run_insert_failed";
  readonly httpStatus?: number;

  constructor(
    code: QrLabelPersistError["code"],
    message: string,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "QrLabelPersistError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type PersistAndOpenArgs = {
  blob: Blob;
  articleId: string;
  batchId: string;
  deviceIds: string[];
  status: "completed" | "failed";
  failureReason?: string | null;
  supabase: SupabaseClient;
};

export type PersistAndOpenResult = {
  runId: string;
  storagePath: string;
  signedUrl: string;
};

/**
 * Mints `qr-labels/{articleId}/{batchId}.pdf`, uploads the blob, inserts the
 * `qr_label_runs` row, and returns a 60-second signed URL.
 *
 * Throws `QrLabelPersistError` on any step that fails. The error is also
 * routed through `logError` with structured codes so the admin error
 * dashboard surfaces the failure.
 */
export async function persistAndOpen({
  blob,
  articleId,
  batchId,
  deviceIds,
  status,
  failureReason = null,
  supabase,
}: PersistAndOpenArgs): Promise<PersistAndOpenResult> {
  // The `upload()` / `createSignedUrl()` path arg is bucket-relative — it must
  // NOT include the `qr-labels/` prefix or the blob lands at
  // `qr-labels/qr-labels/{article_id}/{batch_id}.pdf` and the
  // `storage_first_segment_is_uuid(name)` RLS gate from 00018 denies the upload
  // (first folder = literal "qr-labels", not a UUID). The DB column +
  // CHECK constraint store the bucket-qualified value `qr-labels/<a>/<b>.pdf`
  // so the audit row remains self-describing.
  const objectPath = `${articleId}/${batchId}.pdf`;
  const storagePath = `qr-labels/${objectPath}`;

  // Pre-flight: bucket cap is 5 MB (00018). Catch oversized batches client-
  // side before the full Storage round-trip so the user sees a precise
  // German message instead of the generic upload-failed toast.
  if (blob.size > 5 * 1024 * 1024) {
    throw new QrLabelPersistError(
      "storage_upload_failed",
      `PDF zu groß (${(blob.size / 1024 / 1024).toFixed(1)} MB) — bitte in mehreren Chargen drucken`,
    );
  }

  // Step 1 — upload to Storage.
  const upload = await supabase.storage
    .from("qr-labels")
    .upload(objectPath, blob, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (upload.error) {
    // RLS-deny detection: prefer the HTTP status (`StorageError.status`).
    // Some Supabase Storage errors don't surface a permission keyword in
    // the message ("new row violates row-level security policy …"), so
    // matching on text alone misclassifies real RLS denies as generic
    // upload failures. Status 403 is the authoritative signal.
    const msg = upload.error.message ?? "";
    const httpStatus = (upload.error as { status?: number }).status;
    const code =
      httpStatus === 403 || /unauthor|permission|policy|row-level/i.test(msg)
        ? "rls_denied"
        : "storage_upload_failed";

    await logError(
      {
        errorType: code === "rls_denied" ? "RLS_VIOLATION" : "OTHER",
        severity: "error",
        source: "qr-label-print",
        message: code === "rls_denied"
          ? "qr-labels Storage RLS denied upload"
          : "qr-labels Storage upload failed",
        details: {
          article_id: articleId,
          batch_id: batchId,
          device_count: deviceIds.length,
          operation: "upload",
          code,
        },
        entity: "storage",
        entityId: articleId,
      },
      supabase,
    );

    throw new QrLabelPersistError(code, msg || "qr-label upload failed");
  }

  // Step 2 — insert the qr_label_runs row.
  const { data: runRow, error: runError } = await supabase
    .from("qr_label_runs")
    .insert({
      article_id: articleId,
      batch_id: batchId,
      device_ids: deviceIds,
      storage_path: storagePath,
      status,
      failure_reason: failureReason,
    })
    .select("id")
    .single();

  if (runError || !runRow) {
    await logError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "qr-label-print",
        message: "qr_label_runs insert failed",
        details: {
          article_id: articleId,
          batch_id: batchId,
          device_count: deviceIds.length,
          operation: "run-insert",
          code: runError?.code ?? null,
        },
        entity: "qr_label_runs",
        entityId: articleId,
      },
      supabase,
    );

    // Best-effort: try to remove the just-uploaded blob so the bucket
    // doesn't accumulate orphans whose run row never landed. Failure is
    // ignored — the next idempotency sweep (out of scope) would catch it.
    void supabase.storage.from("qr-labels").remove([objectPath]);

    throw new QrLabelPersistError(
      "run_insert_failed",
      runError?.message ?? "qr_label_runs insert failed",
    );
  }

  // Step 3 — sign a short-lived URL for the print/download path.
  const signed = await supabase.storage
    .from("qr-labels")
    .createSignedUrl(objectPath, 60);

  if (signed.error || !signed.data?.signedUrl) {
    await logError(
      {
        errorType: "OTHER",
        severity: "warning",
        source: "qr-label-print",
        message: "qr-label signed URL generation failed",
        details: {
          article_id: articleId,
          batch_id: batchId,
          run_id: runRow.id,
          operation: "sign",
          code: "signed_url_failed",
        },
        entity: "qr_label_runs",
        entityId: runRow.id,
      },
      supabase,
    );

    throw new QrLabelPersistError(
      "signed_url_failed",
      signed.error?.message ?? "signed URL generation failed",
    );
  }

  return {
    runId: runRow.id,
    storagePath,
    signedUrl: signed.data.signedUrl,
  };
}
