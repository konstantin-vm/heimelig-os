"use client";

import { useId, useRef } from "react";

import { cn } from "@/lib/utils";
import {
  CONTACT_ROLES,
  type ContactRole,
} from "@/lib/constants/contact-roles";

export type ContactRolePickerProps = {
  value: ContactRole | null;
  onChange: (role: ContactRole) => void;
  /** Optional id for the radiogroup, used by labels via aria-labelledby. */
  id?: string;
  /** Set aria-invalid when the role field has a validation error. */
  invalid?: boolean;
  className?: string;
};

export function ContactRolePicker({
  value,
  onChange,
  id,
  invalid,
  className,
}: ContactRolePickerProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const currentIdx = CONTACT_ROLES.findIndex((r) => r.value === value);
    const len = CONTACT_ROLES.length;
    const last = len - 1;
    let nextIdx: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % len;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIdx = currentIdx < 0 ? last : (currentIdx - 1 + len) % len;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = last;
        break;
      default:
        return;
    }

    if (nextIdx === null) return;
    event.preventDefault();
    const nextRole = CONTACT_ROLES[nextIdx]!;
    onChange(nextRole.value);
    refs.current[nextIdx]?.focus();
  }

  return (
    <div
      role="radiogroup"
      id={groupId}
      aria-invalid={invalid || undefined}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {CONTACT_ROLES.map((role, idx) => {
        const selected = role.value === value;
        return (
          <button
            key={role.value}
            ref={(node) => {
              refs.current[idx] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (value === null && idx === 0) ? 0 : -1}
            onClick={() => onChange(role.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background text-foreground hover:bg-muted",
            )}
          >
            {role.label}
          </button>
        );
      })}
    </div>
  );
}
