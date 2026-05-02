import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BexioStatusLabel } from "@/lib/validations/bexio-credentials";

export type BexioConnectionState = BexioStatusLabel | "disconnected";

interface BexioStatusBadgeProps {
  state: BexioConnectionState;
  className?: string;
}

const CONFIG: Record<
  BexioConnectionState,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; tone: string }
> = {
  valid: {
    label: "Verbunden",
    variant: "secondary",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  expiring_soon: {
    label: "Läuft bald ab",
    variant: "secondary",
    tone: "border-amber-200 bg-amber-50 text-amber-900",
  },
  expired: {
    label: "Abgelaufen",
    variant: "destructive",
    tone: "",
  },
  disconnected: {
    label: "Nicht verbunden",
    variant: "outline",
    tone: "text-muted-foreground",
  },
};

export function BexioStatusBadge({ state, className }: BexioStatusBadgeProps) {
  const cfg = CONFIG[state];
  return (
    <Badge variant={cfg.variant} className={cn(cfg.tone, className)}>
      {cfg.label}
    </Badge>
  );
}
