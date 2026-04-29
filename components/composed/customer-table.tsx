"use client";

import { useMemo } from "react";
import { Loader2, Users } from "lucide-react";

import {
  useCustomersList,
  type CustomerListRow,
} from "@/lib/queries/customers";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { RowActions } from "./row-actions";

export type CustomerTableProps = {
  onEdit: (customerId: string) => void;
};

function customerName(row: CustomerListRow): string {
  if (row.customer_type === "institution") {
    return row.company_name ?? "—";
  }
  const parts = [row.first_name, row.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function fullAddress(row: CustomerListRow): string {
  const a = row.primary_address;
  if (!a) return "—";
  const street = [a.street, a.street_number ?? ""].join(" ").trim();
  return [street, [a.zip, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function plzLabel(row: CustomerListRow): string {
  return row.primary_address?.zip ?? "—";
}

export function CustomerTable({ onEdit }: CustomerTableProps) {
  const { data, isLoading, isError, refetch } = useCustomersList();

  const rows = useMemo(() => data ?? [], [data]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed text-left text-sm"
          aria-label="Kundenliste"
        >
          <thead className="bg-muted/50">
            <tr className="border-b border-border">
              <th
                scope="col"
                className="w-[32%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Kunde
              </th>
              <th
                scope="col"
                className="w-[36%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Adresse
              </th>
              <th
                scope="col"
                className="w-[14%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Telefon
              </th>
              <th
                scope="col"
                className="w-[10%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                PLZ
              </th>
              <th
                scope="col"
                className="w-[8%] px-3 py-3 text-right text-sm font-semibold text-muted-foreground"
              >
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Kunden werden geladen…
                  </span>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-12 text-center text-destructive"
                >
                  Kunden konnten nicht geladen werden.{" "}
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="underline underline-offset-2"
                  >
                    Erneut versuchen
                  </button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <span className="inline-flex flex-col items-center gap-2">
                    <Users className="h-8 w-8" aria-hidden />
                    <span className="text-sm font-medium text-foreground">
                      Noch keine Kunden erfasst
                    </span>
                    <span className="text-sm">
                      Lege den ersten Kunden mit dem Button oben rechts an.
                    </span>
                  </span>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    "hover:bg-muted/30",
                  )}
                >
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-foreground">
                        {customerName(row)}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {row.customer_number}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground">
                    {fullAddress(row)}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground">
                    {row.phone ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-sm text-muted-foreground">
                    {plzLabel(row)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <RowActions onEdit={() => onEdit(row.id)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
