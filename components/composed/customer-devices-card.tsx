"use client";

import { useActiveDevices } from "@/lib/queries/customers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type CustomerDevicesCardProps = {
  customerId: string;
};

/**
 * Story 2.5 — Epic-5 stub. Card structure ready for Epic 5 Story 5.2 to wire
 * the live `rental_contracts` × `devices` query into `useActiveDevices`. The
 * shape (props, header, empty body) matches the right-column composition of
 * the S-004 design.
 */
export function CustomerDevicesCard({ customerId }: CustomerDevicesCardProps) {
  // Mount the stub query so the cache slot exists for Epic 5 to swap into.
  useActiveDevices(customerId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Aktuelle Geräte beim Kunden</CardTitle>
          <p className="text-xs text-muted-foreground">0 Geräte aktiv</p>
        </div>
      </CardHeader>
      <CardContent>
        {/* TODO(Epic 5) — wire live device list from rental_contracts. */}
        <p className="py-4 text-center text-sm text-muted-foreground">
          Verfügbar mit Epic 5 — Mietverträge &amp; Devices
        </p>
      </CardContent>
    </Card>
  );
}
