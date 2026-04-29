"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import {
  CustomerEditForm,
  CustomerTable,
  PageHeader,
  PageShell,
} from "@/components/composed";
import { Button } from "@/components/ui/button";
import { CUSTOMER_LIST_LIMIT, useCustomersList } from "@/lib/queries/customers";

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; customerId: string };

export default function CustomersPage() {
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const { data } = useCustomersList();
  const totalCount = data?.length ?? null;

  // D2 (Round 3) — interim warning until Story 2.5 ships pagination. The
  // list query caps at CUSTOMER_LIST_LIMIT rows; if we hit the cap, more
  // customers exist and the office user must be told.
  const isTruncated =
    totalCount !== null && totalCount >= CUSTOMER_LIST_LIMIT;

  const handleOpenChange = (open: boolean) => {
    if (!open) setModal({ mode: "closed" });
  };

  return (
    <PageShell title="Kunden">
      <PageHeader
        title="Kunden"
        count={totalCount}
        actions={
          <>
            <Button onClick={() => setModal({ mode: "create" })}>
              <Plus className="h-4 w-4" />
              Neuer Kunde
            </Button>
            {/* P17 (Round 3) — drop the implementation-detail aria-label;
                visible button text already announces the action, and the
                disabled state is conveyed by the native attribute. */}
            <Button variant="outline" disabled>
              <Plus className="h-4 w-4" />
              Neuer Auftrag
            </Button>
          </>
        }
      />

      {isTruncated ? (
        <div
          role="status"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
        >
          Liste gekürzt — nur die ersten {CUSTOMER_LIST_LIMIT} Kunden werden angezeigt.
          Suche / Filter folgen mit Story 2.5.
        </div>
      ) : null}

      <CustomerTable
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
    </PageShell>
  );
}
