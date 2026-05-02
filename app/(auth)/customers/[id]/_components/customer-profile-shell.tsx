"use client";

import { useState } from "react";
import Link from "next/link";

import {
  BexioContactCard,
  CustomerAddressesCard,
  CustomerContactsCard,
  CustomerDevicesCard,
  CustomerEditForm,
  CustomerInfoCard,
  CustomerInsuranceCard,
  CustomerOrdersCard,
  CustomerProfileHeader,
} from "@/components/composed";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type CustomerProfileShellProps = {
  customerId: string;
  fullName: string;
};

export function CustomerProfileShell({
  customerId,
  fullName,
}: CustomerProfileShellProps) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/customers">Kunden</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{fullName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

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
          <CustomerOrdersCard customerId={customerId} />
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
