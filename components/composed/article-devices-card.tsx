"use client";

// <ArticleDevicesCard> — Story 3.2 / Epic AC1 + AC2.
//
// Replaces the Story-3.1 `<DevicesStubCard>` on the article-detail page when
// the article is rentable. Owns:
//   * The local search-term state (lifted out of the URL like in Story 3.1's
//     article list — debounced inside `<DeviceListFilters>`).
//   * The `<DeviceEditForm>` modal state (mode + targeted device id).
//   * The "Neues Gerät" CTA, hidden for technician role.
//
// Data comes from `useArticleDevices` (shared with `<DeviceTable>`) plus a
// dedicated total-count call so the header `<CountBadge>` shows the real
// catalog size, not the post-filter slice.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Plus, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { isSprint5Enabled } from "@/lib/feature-flags";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useArticleDevices } from "@/lib/queries/devices";

import { CountBadge } from "./count-badge";
import { DeviceEditForm } from "./device-edit-form";
import { DeviceListFilters } from "./device-list-filters";
import { DeviceTable } from "./device-table";
import { PrintLabelsBatchDialog } from "./print-labels-batch-dialog";

export type ArticleDevicesCardProps = {
  articleId: string;
};

export function ArticleDevicesCard({ articleId }: ArticleDevicesCardProps) {
  const { data: role } = useAppRole();
  const canCreate =
    role === "admin" || role === "office" || role === "warehouse";
  // "Etiketten drucken" + "Sammelregistrierung" target Sprint-5 surfaces
  // (Stories 3.6 / 3.7) — hide the entry buttons while the flag is off so
  // the article-detail card matches the demo nav.
  const showSprint5Actions = isSprint5Enabled();

  // Card-level total (active devices for this article — independent of filters).
  // Mirrors the Story-3.1 separation between filtered list count and overall
  // catalog count in the page header.
  const totalQuery = useArticleDevices(articleId, { pageSize: 1, page: 1 });
  const total = totalQuery.data?.total ?? null;

  const [searchTerm, setSearchTerm] = useState("");

  const [editMode, setEditMode] = useState<
    | { kind: "create" }
    | { kind: "edit"; deviceId: string }
    | { kind: "closed" }
  >({ kind: "closed" });

  const [printOpen, setPrintOpen] = useState(false);

  const open = editMode.kind !== "closed";

  const props = useMemo(
    () => ({
      open,
      onOpenChange: (next: boolean) => {
        if (!next) setEditMode({ kind: "closed" });
      },
    }),
    [open],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Geräte</h3>
          <CountBadge count={total} />
        </div>
        {canCreate ? (
          <div className="flex items-center gap-2">
            {showSprint5Actions ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPrintOpen(true)}
                  aria-label="Etiketten für diesen Artikel drucken"
                >
                  <Printer className="h-4 w-4" aria-hidden />
                  Etiketten drucken
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/articles/batch?articleId=${articleId}`}
                    aria-label="Sammelregistrierung für diesen Artikel öffnen"
                  >
                    <Boxes className="h-4 w-4" aria-hidden />
                    Sammelregistrierung
                  </Link>
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={() => setEditMode({ kind: "create" })}
              aria-label="Neues Gerät anlegen"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Neues Gerät
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DeviceListFilters
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
        />
        <DeviceTable
          articleId={articleId}
          searchTerm={searchTerm}
          onClearSearchTerm={() => setSearchTerm("")}
          onEdit={(deviceId) => setEditMode({ kind: "edit", deviceId })}
        />
      </CardContent>

      {editMode.kind === "create" ? (
        <DeviceEditForm
          mode="create"
          defaultArticleId={articleId}
          {...props}
        />
      ) : editMode.kind === "edit" ? (
        <DeviceEditForm
          mode="edit"
          deviceId={editMode.deviceId}
          {...props}
        />
      ) : null}

      {canCreate ? (
        <PrintLabelsBatchDialog
          articleId={articleId}
          open={printOpen}
          onOpenChange={setPrintOpen}
        />
      ) : null}
    </Card>
  );
}
