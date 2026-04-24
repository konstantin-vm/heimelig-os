"use client";

import { User } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS_DE, type AppRole } from "@/lib/constants/roles";

import { LogoutButton } from "./logout-button";

export type UserMenuProps = {
  role: AppRole;
  displayName: string;
  email: string;
  showRoleBadge?: boolean;
};

function getInitials(displayName: string, email: string): string {
  const source = displayName.trim() || email.split("@")[0] || "";
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second) {
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
  if (source.length >= 2) return source.slice(0, 2).toUpperCase();
  return source.toUpperCase() || "?";
}

export function UserMenu({
  role,
  displayName,
  email,
  showRoleBadge = true,
}: UserMenuProps) {
  const initials = getInitials(displayName, email);
  const roleLabel = ROLE_LABELS_DE[role];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Benutzermenü"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-input bg-background text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initials ? (
          <span aria-hidden="true">{initials}</span>
        ) : (
          <User className="h-5 w-5" aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{displayName}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        {showRoleBadge ? (
          <DropdownMenuLabel className="pt-0 text-xs font-normal text-muted-foreground">
            {roleLabel}
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuSeparator />
        <div className="px-1 py-1">
          <LogoutButton />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
