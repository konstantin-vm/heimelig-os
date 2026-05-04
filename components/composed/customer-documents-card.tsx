"use client";

import { useCustomerDocuments } from "@/lib/queries/customers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type CustomerDocumentsCardProps = {
  customerId: string;
};

/**
 * Story 2.5.1 — Epic-5 stub. Card structure ready for Epic 5 Story 5.4 to
 * wire the live `customer_documents` query (Arztzeugnisse + Lieferscheine)
 * into `useCustomerDocuments`. The shape mirrors `<CustomerDevicesCard>` so
 * Epic 5 can reuse the file-list layout decisions.
 */
export function CustomerDocumentsCard({ customerId }: CustomerDocumentsCardProps) {
  // Mount the stub query so the cache slot exists for Epic 5 to swap into.
  useCustomerDocuments(customerId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Dokumente</CardTitle>
          <p className="text-xs text-muted-foreground">0 Dokumente</p>
        </div>
      </CardHeader>
      <CardContent>
        {/* TODO(Epic 5) — wire customer_documents (Arztzeugnisse, Lieferscheine). */}
        <p className="py-4 text-center text-sm text-muted-foreground">
          Verfügbar mit Epic 5 — Arztzeugnisse, Lieferscheine
        </p>
      </CardContent>
    </Card>
  );
}
