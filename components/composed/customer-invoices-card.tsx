"use client";

import { useCustomerInvoices } from "@/lib/queries/customers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type CustomerInvoicesCardProps = {
  customerId: string;
};

/**
 * Story 2.5.1 — Epic-6 stub. Card structure mirrors `<CustomerOrdersCard>`
 * (Story 2.5) so Epic 6 Story 6.2 can wire the live `invoices` × bexio
 * query into `useCustomerInvoices` without re-doing the layout. The
 * empty-state copy + the four-column table header preview the final shape
 * for the MTG-008 sprint review.
 */
export function CustomerInvoicesCard({ customerId }: CustomerInvoicesCardProps) {
  // Mount the stub query so the cache slot exists for Epic 6 to swap into.
  useCustomerInvoices(customerId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Rechnungen</CardTitle>
          <p className="text-xs text-muted-foreground">0 Rechnungen</p>
        </div>
      </CardHeader>
      <CardContent>
        {/* TODO(Epic 6) — wire invoices list from public.invoices + bexio. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="py-2 pr-3">Rechnungs-Nr.</th>
                <th className="py-2 pr-3">Datum</th>
                <th className="py-2 pr-3">Betrag</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  Verfügbar mit Epic 6 — Rechnungen &amp; bexio Integration
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
