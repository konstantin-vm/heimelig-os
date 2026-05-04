// <StatusBadge> — generic status colourer declared in
// `docs/design/desktop/component-map.md`. Story 3.1 ships the `'article'`
// entity (Aktiv / Inaktiv); Story 3.2 extends with `'device'` (5 statuses)
// and `'device-condition'` (3 conditions). Use this in place of raw
// `<Badge>` so the entity-specific German labels + token mapping live in
// one place. The discriminated union forces an exhaustive switch on
// `props.entity` — adding a new entity will surface as a TS compile error
// here instead of silently falling through.

import { cn } from "@/lib/utils";
import {
  deviceConditionLabels,
  deviceStatusLabels,
} from "@/lib/constants/device";
// Value import (not `import type`): the runtime needs the array literals so
// `(typeof ...)[number]` resolves the union. Under `verbatimModuleSyntax`
// the `import type` form would erase the bindings and `typeof X` would
// resolve to `typeof undefined`.
import {
  deviceConditionValues,
  deviceStatusValues,
} from "@/lib/validations/device";

export type ArticleStatus = "active" | "inactive";
export type DeviceStatus = (typeof deviceStatusValues)[number];
export type DeviceCondition = (typeof deviceConditionValues)[number];

export type StatusBadgeProps =
  | {
      entity: "article";
      status: ArticleStatus;
      className?: string;
    }
  | {
      entity: "device";
      status: DeviceStatus;
      className?: string;
    }
  | {
      entity: "device-condition";
      status: DeviceCondition;
      className?: string;
    };

const ARTICLE_LABELS: Record<ArticleStatus, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
};

const ARTICLE_CLASSES: Record<ArticleStatus, string> = {
  active: "bg-success-soft text-success",
  inactive: "bg-muted text-muted-foreground",
};

// Token mapping: project ships `success-soft`/`info-soft` semantic tokens
// (globals.css) for the on-brand greens + Helsana-tint blue; warning + a
// repair-red use Tailwind's amber/red soft scale (mirrors the pattern from
// `<BexioStatusBadge>`) since the design tokens don't ship `warning-soft`
// / `destructive-soft` yet. UX-alignment-pass story can swap in dedicated
// tokens once Lilian's frames land.
const DEVICE_CLASSES: Record<DeviceStatus, string> = {
  available: "bg-success-soft text-success-foreground",
  rented: "bg-info-soft text-info-foreground",
  cleaning: "bg-amber-50 text-amber-900",
  repair: "bg-red-50 text-red-900",
  sold: "bg-muted text-muted-foreground",
};

const DEVICE_CONDITION_CLASSES: Record<DeviceCondition, string> = {
  gut: "bg-success-soft text-success-foreground",
  gebrauchsspuren: "bg-amber-50 text-amber-900",
  reparaturbeduerftig: "bg-red-50 text-red-900",
};

// Runtime drift fallback — if the DB ever returns a status outside the Zod
// enum (e.g. a new value added by a future migration before the UI catches up),
// render a muted neutral badge with the raw value rather than an unstyled blob.
const FALLBACK_CLASSES = "bg-muted text-muted-foreground";

export function StatusBadge(props: StatusBadgeProps) {
  // Exhaustive switch: adding a new entity arm above without a branch here
  // is a TS error (the `never` fallthrough catches the omission).
  let label: string;
  let classes: string;
  switch (props.entity) {
    case "article":
      label = ARTICLE_LABELS[props.status] ?? props.status;
      classes = ARTICLE_CLASSES[props.status] ?? FALLBACK_CLASSES;
      break;
    case "device":
      label = deviceStatusLabels[props.status] ?? props.status;
      classes = DEVICE_CLASSES[props.status] ?? FALLBACK_CLASSES;
      break;
    case "device-condition":
      label = deviceConditionLabels[props.status] ?? props.status;
      classes = DEVICE_CONDITION_CLASSES[props.status] ?? FALLBACK_CLASSES;
      break;
    default: {
      const _exhaustive: never = props;
      throw new Error(`Unhandled StatusBadge entity: ${JSON.stringify(_exhaustive)}`);
    }
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        classes,
        props.className,
      )}
      data-status={props.status}
      data-entity={props.entity}
    >
      {label}
    </span>
  );
}
