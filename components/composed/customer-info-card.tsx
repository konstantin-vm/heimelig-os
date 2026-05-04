"use client";

import { useEffect, useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { customerKeys, useCustomer } from "@/lib/queries/customers";
import {
  formatDate,
  formatPhone,
  formatPrimaryAddressLine,
} from "@/lib/utils/format";

import { DefinitionRow } from "./definition-row";

export type CustomerInfoCardProps = {
  customerId: string;
  /** Click handler — opens the shared <CustomerEditForm> modal in edit mode. */
  onEdit: () => void;
};

export function CustomerInfoCard({ customerId, onEdit }: CustomerInfoCardProps) {
  const { data: customer, isLoading, isError } = useCustomer(customerId);
  const queryClient = useQueryClient();
  const channelSuffix = useId();

  // Realtime — invalidate the detail cache when this customer's row changes
  // in another session. <BexioContactCard> reads from the same detail cache,
  // so a single channel covers both cards on the profile page.
  useEffect(() => {
    if (!customerId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`customers:detail:${customerId}:${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customers",
          filter: `id=eq.${customerId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: customerKeys.detail(customerId),
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerId, channelSuffix, queryClient]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle>Kundeninformationen</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Kunde bearbeiten"
          title="Kunde bearbeiten"
          onClick={onEdit}
        >
          <Pencil aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">
            Daten werden geladen…
          </p>
        ) : isError || !customer ? (
          <p className="py-4 text-sm text-destructive">
            Kundendaten konnten nicht geladen werden.
          </p>
        ) : (
          <>
            <DefinitionRow
              label="Name"
              value={
                customer.customer_type === "private"
                  ? [customer.first_name, customer.last_name]
                      .filter(Boolean)
                      .join(" ")
                  : customer.company_name
              }
            />
            <DefinitionRow
              label="Adresse"
              value={
                customer.primary_address
                  ? formatPrimaryAddressLine(customer.primary_address)
                  : null
              }
            />
            <DefinitionRow label="Telefon" value={formatPhoneOrNull(customer.phone)} />
            <DefinitionRow label="E-Mail" value={customer.email} />
            <DefinitionRow
              label="Geburtsdatum"
              value={
                customer.customer_type === "private"
                  ? formatDateOrNull(customer.date_of_birth)
                  : null
              }
              emptyPlaceholder={
                customer.customer_type === "institution"
                  ? "—"
                  : "nicht erfasst"
              }
            />
            {/*
              Story 2.5.1 — Notizen row moved into the dedicated
              <CustomerNotesCard> (Backoffice section). Keeping a duplicate
              here would let the two views drift; the notes-card hydrates
              from the same `useCustomer` cache so realtime invalidations
              propagate to both displays.
            */}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatPhoneOrNull(input: string | null | undefined): string | null {
  if (!input) return null;
  const formatted = formatPhone(input);
  return formatted === "—" ? null : formatted;
}

function formatDateOrNull(input: string | null | undefined): string | null {
  if (!input) return null;
  const formatted = formatDate(input);
  return formatted === "—" ? null : formatted;
}
