"use client";

// <DeviceInfoCard> — Story 3.2.
//
// S-013 left-column info card. Renders the device's structured fields via
// `<DefinitionRow>`. Warehouse role does not see Anschaffungspreis (UI-level
// defense-in-depth — RLS does not column-redact for warehouse on the table;
// the technician path uses the `technician_devices` view which excludes the
// column entirely).

import Link from "next/link";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deviceConditionLabels,
  deviceIsNewLabels,
  deviceStatusLabels,
} from "@/lib/constants/device";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useDevice } from "@/lib/queries/devices";
import { formatChf, formatDate } from "@/lib/utils/format";

import { DefinitionRow } from "./definition-row";

export type DeviceInfoCardProps = {
  deviceId: string;
  /** Click handler — opens `<DeviceEditForm>` in edit mode. */
  onEdit: () => void;
};

function customerLabel(c: {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
} | null) {
  if (!c) return null;
  if (c.company_name) return c.company_name;
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

export function DeviceInfoCard({ deviceId, onEdit }: DeviceInfoCardProps) {
  const { data: device, isLoading, isError } = useDevice(deviceId);
  const { data: role } = useAppRole();
  // Realtime: <DeviceProfileShell> mounts the central `useDeviceRealtime` so
  // both this card and <DeviceAuditTrailCard> share a single subscription
  // instead of stacking duplicates.

  const isWarehouse = role === "warehouse";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle>Geräteinformationen</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Gerät bearbeiten"
          title="Gerät bearbeiten"
          onClick={onEdit}
        >
          <Pencil aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">
            Daten werden geladen…
          </p>
        ) : isError || !device ? (
          <p className="py-4 text-sm text-destructive">
            Gerätedaten konnten nicht geladen werden.
          </p>
        ) : (
          <>
            <DefinitionRow label="Seriennummer" value={device.serial_number} />
            <DefinitionRow
              label="QR-Code"
              value={
                device.qr_code ? (
                  <span className="font-mono text-xs">{device.qr_code}</span>
                ) : null
              }
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Status"
              value={deviceStatusLabels[device.status]}
            />
            <DefinitionRow
              label="Zustand"
              value={deviceConditionLabels[device.condition]}
            />
            <DefinitionRow
              label="Neu"
              value={
                device.is_new ? deviceIsNewLabels.true : deviceIsNewLabels.false
              }
            />
            <DefinitionRow
              label="Artikel"
              value={
                device.articles ? (
                  <Link
                    href={`/articles/${device.article_id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {[
                      device.articles.article_number,
                      device.articles.name,
                      device.articles.variant_label,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </Link>
                ) : null
              }
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Lager"
              value={
                device.warehouses
                  ? `${device.warehouses.code} — ${device.warehouses.name}`
                  : null
              }
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Lieferant"
              value={device.suppliers?.name ?? null}
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Eingang"
              value={formatDate(device.inbound_date)}
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Ausgang"
              value={formatDate(device.outbound_date)}
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Anschaffung am"
              value={formatDate(device.acquired_at)}
              emptyPlaceholder="—"
            />
            {!isWarehouse ? (
              <DefinitionRow
                label="Anschaffungspreis"
                value={formatChf(device.acquisition_price)}
                emptyPlaceholder="—"
              />
            ) : null}
            <DefinitionRow
              label="Reserviert für"
              value={
                device.reserved_for_customer_id && device.customers ? (
                  <Link
                    href={`/customers/${device.reserved_for_customer_id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {customerLabel(device.customers) ?? "—"}
                  </Link>
                ) : null
              }
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Reserviert seit"
              value={formatDate(device.reserved_at)}
              emptyPlaceholder="—"
            />
            {device.retired_at ? (
              <DefinitionRow
                label="Außer Betrieb seit"
                value={formatDate(device.retired_at)}
              />
            ) : null}
            <DefinitionRow
              label="Notizen"
              value={device.notes}
              preserveWhitespace
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
