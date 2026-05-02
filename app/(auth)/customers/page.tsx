"use client";

import { Suspense, useState } from "react";
import { Plus } from "lucide-react";

import {
  CustomerEditForm,
  CustomerListFilters,
  CustomerTable,
  PageHeader,
  PageShell,
} from "@/components/composed";
import { Button } from "@/components/ui/button";
import { useCustomersTotalCount } from "@/lib/queries/customers";

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; customerId: string };

export default function CustomersPage() {
  return (
    <PageShell title="Kunden">
      <Suspense
        fallback={
          <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
            Lade Kunden…
          </p>
        }
      >
        <CustomersPageBody />
      </Suspense>
    </PageShell>
  );
}

function CustomersPageBody() {
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  // Search term lives in component state — never enters the URL — so customer
  // names typed into the search box don't leak to Vercel Frankfurt access logs
  // (nDSG: PII must not cross Frankfurt). All other filters stay URL-synced
  // because they're non-PII and remain shareable.
  const [searchTerm, setSearchTerm] = useState("");
  const { data: totalCount } = useCustomersTotalCount();

  const handleOpenChange = (open: boolean) => {
    if (!open) setModal({ mode: "closed" });
  };

  return (
    <>
      <PageHeader
        title="Kunden"
        count={totalCount ?? null}
        actions={
          <>
            <Button onClick={() => setModal({ mode: "create" })}>
              <Plus className="h-4 w-4" />
              Neuer Kunde
            </Button>
            <Button variant="outline" disabled>
              <Plus className="h-4 w-4" />
              Neuer Auftrag
            </Button>
          </>
        }
      />

      <CustomerListFilters
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
      />

      <CustomerTable
        searchTerm={searchTerm}
        onClearSearchTerm={() => setSearchTerm("")}
        onEdit={(customerId) => setModal({ mode: "edit", customerId })}
      />

      {modal.mode !== "closed" ? (
        <CustomerEditForm
          // P15 — re-key on customerId so a click on a different row while
          // the modal is loading remounts the form (no stale-data leak).
          key={modal.mode === "edit" ? modal.customerId : "create"}
          mode={modal.mode}
          customerId={modal.mode === "edit" ? modal.customerId : null}
          open
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </>
  );
}
