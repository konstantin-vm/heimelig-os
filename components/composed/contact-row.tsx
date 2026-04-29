"use client";

import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ContactPerson } from "@/lib/validations/customer";

import { ContactAvatar } from "./contact-avatar";
import { ContactRoleBadge } from "./contact-role-badge";

export type ContactRowProps = {
  contact: ContactPerson;
  onEdit: (contactId: string) => void;
  onDelete: (contactId: string) => void;
  className?: string;
};

function formatFullName(contact: ContactPerson): string {
  const parts = [contact.title, contact.first_name, contact.last_name].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return parts.join(" ").trim() || "—";
}

function formatMeta(contact: ContactPerson): string {
  const phone = contact.phone?.trim();
  const email = contact.email?.trim();
  if (phone && email) return `${phone} · ${email}`;
  return phone ?? email ?? "";
}

export function ContactRow({
  contact,
  onEdit,
  onDelete,
  className,
}: ContactRowProps) {
  const fullName = formatFullName(contact);
  const meta = formatMeta(contact);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-transparent px-2 py-2 hover:border-border hover:bg-muted/30",
        className,
      )}
    >
      <ContactAvatar
        firstName={contact.first_name}
        lastName={contact.last_name}
        role={contact.role}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {fullName}
          </span>
          <ContactRoleBadge role={contact.role} />
          {contact.is_primary_contact ? (
            <Badge variant="default">Hauptkontakt</Badge>
          ) : null}
        </div>
        {contact.organization?.trim() ? (
          <span className="text-xs text-muted-foreground">
            {contact.organization}
          </span>
        ) : null}
        {meta ? (
          <span className="text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Kontakt ${fullName} bearbeiten`}
          title="Bearbeiten"
          onClick={() => onEdit(contact.id)}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Kontakt ${fullName} löschen`}
          title="Löschen"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onDelete(contact.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}
