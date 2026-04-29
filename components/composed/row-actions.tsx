"use client";

import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RowActionsProps = {
  onEdit?: () => void;
  ariaLabel?: string;
  className?: string;
};

export function RowActions({
  onEdit,
  ariaLabel = "Kunde bearbeiten",
  className,
}: RowActionsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onEdit}
        aria-label={ariaLabel}
        className="h-9 w-9 text-muted-foreground hover:text-foreground"
      >
        <Pencil className="h-4 w-4" />
      </Button>
    </div>
  );
}
