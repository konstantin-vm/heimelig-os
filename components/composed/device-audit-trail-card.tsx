"use client";

// <DeviceAuditTrailCard> — Story 3.2.
//
// Reads `audit_log WHERE entity='devices' AND entity_id=$device_id` ordered
// DESC. Renders one row per audit entry with timestamp, actor, and the
// action label (German). The full diff renderer (before → after per column)
// is intentionally a Sprint-1 "minimal" — Story 3.2.1 follow-up can add a
// schema-aware delta component once we have a few real edits to design
// against. For now the card surfaces the trail without a diff so reviewers
// can verify the audit binding is firing on every mutation.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEVICE_AUDIT_TRAIL_PAGE_SIZE } from "@/lib/constants/device";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useDeviceAuditTrail } from "@/lib/queries/devices";
import { formatDate } from "@/lib/utils/format";

export type DeviceAuditTrailCardProps = {
  deviceId: string;
};

// `audit_log` SELECT is granted to admin + office only (migration 00012).
// Warehouse passes the route guard but reads return `data=[]` silently,
// which would render a misleading "Noch keine Einträge" panel.
const AUDIT_VISIBLE_ROLES = new Set(["admin", "office"]);

const ACTION_LABEL_DE: Record<string, string> = {
  // The trigger function emits both flavours across our migrations:
  devices_created: "Erstellt",
  devices_updated: "Bearbeitet",
  devices_deleted: "Gelöscht",
  INSERT: "Erstellt",
  UPDATE: "Bearbeitet",
  DELETE: "Gelöscht",
};

function actionLabel(action: string): string {
  if (ACTION_LABEL_DE[action]) return ACTION_LABEL_DE[action];
  // Generic fallback — surface a friendly label rather than a raw snake_case
  // / SQL keyword. Unmapped actions keep the prefix for trace-ability.
  return `Aktion (${action})`;
}

function formatTimestamp(input: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const date = formatDate(d);
  const time = d.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
  return `${date} ${time}`;
}

export function DeviceAuditTrailCard({ deviceId }: DeviceAuditTrailCardProps) {
  const [pages, setPages] = useState(1);
  const { data: role, isLoading: isRoleLoading } = useAppRole();
  const canRead = role !== undefined && role !== null && AUDIT_VISIBLE_ROLES.has(role);
  const limit = DEVICE_AUDIT_TRAIL_PAGE_SIZE * pages;
  const { data, isLoading, isError, refetch } = useDeviceAuditTrail(
    canRead ? deviceId : null,
    {
      limit,
      offset: 0,
    },
  );
  const rows = data?.rows ?? [];
  const total = data?.total ?? rows.length;
  // hasMore must tolerate `count: null` from PostgREST (RLS-deny / lookup edge
  // cases). When count is missing, a full page-sized result is the only
  // signal that more rows might exist.
  const hasMore =
    data && rows.length < total
      ? true
      : data && rows.length === limit && data.total === rows.length
        ? true
        : false;

  if (!isRoleLoading && !canRead) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Verlauf</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-sm text-muted-foreground">
            Der Geräte-Verlauf ist nur für Admin- und Office-Rollen sichtbar.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Verlauf</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">
            Verlauf wird geladen…
          </p>
        ) : isError ? (
          <p className="py-4 text-sm text-destructive">
            Verlauf konnte nicht geladen werden.{" "}
            <button
              type="button"
              onClick={() => refetch()}
              className="underline underline-offset-2"
            >
              Erneut versuchen
            </button>
          </p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Noch keine Einträge im Verlauf.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {rows.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-0.5 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {actionLabel(entry.action)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(entry.created_at)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {entry.actor_label ??
                    (entry.actor_user_id
                      ? `Gelöschter Benutzer (${entry.actor_user_id.slice(0, 8)}…)`
                      : entry.actor_system ?? "System")}
                </span>
              </li>
            ))}
          </ol>
        )}

        {hasMore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPages((p) => p + 1)}
            className="self-start"
          >
            Mehr laden
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
