"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import {
  customerKeys,
  useContactPersons,
  useSoftDeleteContactPerson,
} from "@/lib/queries/customers";
import {
  CONTACT_ROLES,
  type ContactRole,
} from "@/lib/constants/contact-roles";

import { ConfirmDialog } from "./confirm-dialog";
import { ContactDialog, type ContactDialogMode } from "./contact-dialog";
import { ContactRow } from "./contact-row";

export type CustomerContactsCardProps = {
  customerId: string;
  /** Display label used in the delete-confirm body, e.g. "Huber, Margrit". */
  customerLabel?: string;
};

function pluralize(n: number) {
  if (n === 0) return "Noch keine Kontakte";
  if (n === 1) return "1 Kontakt erfasst";
  return `${n} Kontakte erfasst`;
}

function roleLabel(role: ContactRole): string {
  return CONTACT_ROLES.find((r) => r.value === role)?.label ?? role;
}

export function CustomerContactsCard({
  customerId,
  customerLabel,
}: CustomerContactsCardProps) {
  const { data: contacts = [], isLoading } = useContactPersons(customerId);
  const queryClient = useQueryClient();
  const channelSuffix = useId();

  const [dialogState, setDialogState] = useState<{
    open: boolean;
    mode: ContactDialogMode;
    contactId?: string;
  }>({ open: false, mode: "add" });

  // Re-derive the dialog's contact from the live contacts list so realtime
  // updates from a parallel session don't leave the dialog with stale values.
  const dialogContact = useMemo(() => {
    if (!dialogState.contactId) return undefined;
    return contacts.find((c) => c.id === dialogState.contactId);
  }, [contacts, dialogState.contactId]);

  // Per-row delete confirm — opens directly (AC5) without the edit modal.
  const [rowDelete, setRowDelete] = useState<{ id: string } | null>(null);
  const rowDeleteContact = rowDelete
    ? contacts.find((c) => c.id === rowDelete.id)
    : null;

  const softDeleteMutation = useSoftDeleteContactPerson();

  // Realtime — invalidate contacts cache on any change for this customer.
  useEffect(() => {
    if (!customerId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`contact_persons:${customerId}:${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contact_persons",
          filter: `customer_id=eq.${customerId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: customerKeys.contacts(customerId),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerId, queryClient, channelSuffix]);

  function openAdd() {
    setDialogState({ open: true, mode: "add" });
  }

  function openEdit(contactId: string) {
    const c = contacts.find((row) => row.id === contactId);
    if (!c) return;
    setDialogState({ open: true, mode: "edit", contactId });
  }

  function openRowDelete(contactId: string) {
    setRowDelete({ id: contactId });
  }

  async function confirmRowDelete() {
    if (!rowDelete) return;
    const target = rowDelete;
    try {
      await softDeleteMutation.mutateAsync({
        customerId,
        contactId: target.id,
      });
      setRowDelete(null);
      toast.success("Kontakt gelöscht.", {
        action: {
          label: "Rückgängig",
          onClick: () => {
            softDeleteMutation.mutate({
              customerId,
              contactId: target.id,
              restore: true,
            });
          },
        },
      });
    } catch (err) {
      toast.error("Löschen fehlgeschlagen.", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Kontakte</CardTitle>
          <p className="text-xs text-muted-foreground">
            {pluralize(contacts.length)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Kontakt hinzufügen"
          title="Kontakt hinzufügen"
          onClick={openAdd}
        >
          <Plus aria-hidden />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Daten werden geladen…
          </p>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Noch keine Kontakte erfasst.
            </p>
            <Button type="button" variant="outline" onClick={openAdd}>
              Kontakt hinzufügen
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                onEdit={openEdit}
                onDelete={openRowDelete}
              />
            ))}
          </div>
        )}
      </CardContent>

      <ContactDialog
        open={dialogState.open}
        onOpenChange={(next) =>
          setDialogState((prev) => ({ ...prev, open: next }))
        }
        mode={dialogState.mode}
        customerId={customerId}
        customerLabel={customerLabel}
        contact={dialogContact}
      />

      <ConfirmDialog
        open={rowDelete !== null}
        onOpenChange={(next) => {
          if (!next) setRowDelete(null);
        }}
        title="Kontakt löschen?"
        description={(() => {
          if (!rowDeleteContact) return null;
          const fullName = [
            rowDeleteContact.first_name,
            rowDeleteContact.last_name,
          ]
            .filter((s) => s)
            .join(" ");
          const customerHint = customerLabel
            ? ` ${customerLabel}`
            : "";
          return `${fullName} (${roleLabel(rowDeleteContact.role)}) wird vom Kunden${customerHint} entfernt.`;
        })()}
        confirmLabel="Löschen"
        variant="standard"
        onConfirm={confirmRowDelete}
      />
    </Card>
  );
}
