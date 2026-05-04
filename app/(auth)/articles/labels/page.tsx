"use client";

// Story 3.7 — S-016 print-history page.
//
// Renders the global print-history table for `qr_label_runs`. The
// articles/layout.tsx already redirects technician → /dashboard, so
// route-guarding here is redundant; keeping the page as a Client
// Component lets <ArticleLabelsHistoryTable> own its own filter state
// without an extra Suspense boundary.

import { Suspense } from "react";

import { ArticleLabelsHistoryTable } from "@/components/composed/article-labels-history-table";
import { PageShell } from "@/components/composed/page-shell";

export default function ArticleLabelsPage() {
  return (
    <PageShell title="QR-Etiketten" backHref="/articles">
      <Suspense
        fallback={
          <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
            Druckverlauf wird geladen…
          </p>
        }
      >
        <ArticleLabelsHistoryTable />
      </Suspense>
    </PageShell>
  );
}
