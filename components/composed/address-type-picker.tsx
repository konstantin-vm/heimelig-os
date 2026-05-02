"use client";

import { useId, useRef } from "react";

import { cn } from "@/lib/utils";
import {
  ADDRESS_TYPE_OPTIONS_NON_PRIMARY,
  type AddressType,
} from "@/lib/constants/address";

// Excludes 'primary' — primary addresses are owned by Story 2.1's S-006
// modal and the atomic create/edit RPCs. The dialog's submit handler also
// rejects 'primary' via Zod refinement; the picker doesn't expose it.
type NonPrimaryAddressType = Exclude<AddressType, "primary">;

export type AddressTypePickerProps = {
  value: NonPrimaryAddressType;
  onChange: (type: NonPrimaryAddressType) => void;
  /** Optional id for the radiogroup, used by labels via aria-labelledby. */
  id?: string;
  /** Set aria-invalid when the type field has a validation error. */
  invalid?: boolean;
  /** When true, render as visually disabled and no-op on click/keyboard. */
  disabled?: boolean;
  className?: string;
};

export function AddressTypePicker({
  value,
  onChange,
  id,
  invalid,
  disabled,
  className,
}: AddressTypePickerProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const len = ADDRESS_TYPE_OPTIONS_NON_PRIMARY.length;
    const last = len - 1;
    const currentIdx = ADDRESS_TYPE_OPTIONS_NON_PRIMARY.findIndex(
      (t) => t.value === value,
    );
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
    const next = ADDRESS_TYPE_OPTIONS_NON_PRIMARY[nextIdx]!;
    onChange(next.value as NonPrimaryAddressType);
    refs.current[nextIdx]?.focus();
  }

  return (
    <div
      role="radiogroup"
      id={groupId}
      aria-invalid={invalid || undefined}
      aria-disabled={disabled || undefined}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {ADDRESS_TYPE_OPTIONS_NON_PRIMARY.map((option, idx) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[idx] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={disabled ? -1 : selected ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(option.value as NonPrimaryAddressType);
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              "min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background text-foreground hover:bg-muted",
              disabled && "cursor-not-allowed opacity-60 hover:bg-background",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
