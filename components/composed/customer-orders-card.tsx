"use client";

import { useRecentOrders } from "@/lib/queries/customers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type CustomerOrdersCardProps = {
  customerId: string;
};

/**
 * Story 2.5 — Epic-4 stub. Card structure ready for Epic 4 Story 4.6 to wire
 * the live `orders` query into `useRecentOrders`. The shape (props, header,
 * empty body, "Alle anzeigen" link slot) matches the right-column composition
 * of the S-004 design.
 */
export function CustomerOrdersCard({ customerId }: CustomerOrdersCardProps) {
  // Mount the stub query so the cache slot exists for Epic 4 to swap into.
  useRecentOrders(customerId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle>Aufträge</CardTitle>
        <span
          role="link"
          aria-disabled="true"
          className="text-xs text-muted-foreground"
          title="Verfügbar mit Epic 4"
        >
          Alle anzeigen →
        </span>
      </CardHeader>
      <CardContent>
        {/* TODO(Epic 4) — wire orders list from public.orders. */}
        <p className="py-4 text-center text-sm text-muted-foreground">
          Verfügbar mit Epic 4 — Auftragserfassung
        </p>
      </CardContent>
    </Card>
  );
}
