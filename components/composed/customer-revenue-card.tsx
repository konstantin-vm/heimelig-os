"use client";

import { useCustomer, useCustomerRevenue } from "@/lib/queries/customers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatChf } from "@/lib/utils/format";

export type CustomerRevenueCardProps = {
  customerId: string;
};

/**
 * Story 2.5.1 — MTG-008 add-on. Compact lifetime-revenue card surfacing
 * "Kunde seit {year}" + total CHF revenue. The CHF figure is an Epic-6 stub
 * (`useCustomerRevenue` returns `null`); the year is read live from
 * `customers.created_at`. Designed small so the left column stays balanced
 * with the right column.
 */
export function CustomerRevenueCard({ customerId }: CustomerRevenueCardProps) {
  const { data: customer, isLoading } = useCustomer(customerId);
  const { data: revenue } = useCustomerRevenue(customerId);

  const sinceYear = customer?.created_at
    ? new Date(customer.created_at).getFullYear()
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Umsatz &amp; Kundenbeziehung</CardTitle>
      </CardHeader>
      <CardContent>
        {/* TODO(Epic 6) — wire lifetime revenue aggregate from invoices. */}
        {isLoading || !customer ? (
          <p className="py-2 text-sm text-muted-foreground">
            Daten werden geladen…
          </p>
        ) : (
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Kunde seit{" "}
              <span className="font-medium text-foreground">
                {sinceYear ?? "—"}
              </span>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Umsatz</span>{" "}
              <span
                className="font-medium text-foreground"
                title={
                  revenue === null || revenue === undefined
                    ? "Verfügbar mit Epic 6"
                    : undefined
                }
              >
                {formatChf(revenue ?? null)}
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
