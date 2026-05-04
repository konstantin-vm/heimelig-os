"use client";

import { useState } from "react";

import {
  BexioContactCard,
  CustomerAddressesCard,
  CustomerContactsCard,
  CustomerDevicesCard,
  CustomerDocumentsCard,
  CustomerEditForm,
  CustomerInfoCard,
  CustomerInsuranceCard,
  CustomerInvoicesCard,
  CustomerNotesCard,
  CustomerOrdersCard,
  CustomerProfileHeader,
  CustomerRevenueCard,
} from "@/components/composed";
import {
  PAGE_HEADER_PRIORITY,
  useSetPageHeader,
} from "@/lib/contexts/page-header-context";

export type CustomerProfileShellProps = {
  customerId: string;
  fullName: string;
};

export function CustomerProfileShell({
  customerId,
  fullName,
}: CustomerProfileShellProps) {
  const [editOpen, setEditOpen] = useState(false);

  // Top bar: "Kunden / Huber, Margrit" (entity name in current-page slot).
  // The auto-resolver can't know the customer name, so the page provides it.
  useSetPageHeader(
    {
      breadcrumb: [
        { label: "Kunden", href: "/customers" },
        { label: fullName },
      ],
    },
    PAGE_HEADER_PRIORITY.override,
  );

  return (
    <div className="flex flex-col gap-6">
      <CustomerProfileHeader
        customerId={customerId}
        onEdit={() => setEditOpen(true)}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-6">
          <CustomerInfoCard
            customerId={customerId}
            onEdit={() => setEditOpen(true)}
          />
          <CustomerInsuranceCard
            customerId={customerId}
            customerLabel={fullName}
          />
          {/* Story 2.5.1 — MTG-008 add-on, kept compact in the left column. */}
          <CustomerRevenueCard customerId={customerId} />
          <BexioContactCard customerId={customerId} />
        </div>
        <div className="flex flex-col gap-6">
          <CustomerDevicesCard customerId={customerId} />
          <CustomerContactsCard
            customerId={customerId}
            customerLabel={fullName}
          />
          <CustomerAddressesCard
            customerId={customerId}
            customerLabel={fullName}
          />
          {/* Story 2.5.1 — Backoffice notes (live) + Monteur stub. */}
          <CustomerNotesCard customerId={customerId} />
          <CustomerOrdersCard customerId={customerId} />
          {/* Story 2.5.1 — Epic-6 invoices stub + Epic-5 documents stub. */}
          <CustomerInvoicesCard customerId={customerId} />
          <CustomerDocumentsCard customerId={customerId} />
        </div>
      </div>

      {editOpen ? (
        <CustomerEditForm
          // Re-key on customerId — if the user navigates between profiles
          // fast, the modal must remount on each open per Story 2.1 P15.
          key={customerId}
          mode="edit"
          customerId={customerId}
          open={editOpen}
          onOpenChange={(open) => setEditOpen(open)}
        />
      ) : null}
    </div>
  );
}
