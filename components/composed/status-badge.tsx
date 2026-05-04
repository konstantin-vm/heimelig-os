// <StatusBadge> — generic status colourer declared in
// `docs/design/desktop/component-map.md`. Story 3.1 ships the `'article'`
// entity (Aktiv / Inaktiv); Story 3.2 extends with `'device'` (5 statuses)
// and `'device-condition'` (3 conditions); Story 3.7 adds `'qr-label-run'`
// (completed / failed); Story 3.4 adds `'availability'` (3 buckets) and
// `'stock-warning'` (3 levels — `none` renders as `null`). Use this in
// place of raw `<Badge>` so the entity-specific German labels + token
// mapping live in one place. The discriminated union forces an exhaustive
// switch on `props.entity` — adding a new entity will surface as a TS
// compile error here instead of silently falling through.
//
// Accessibility: every rendered span carries an `aria-label` of the
// entity + label so screen-reader users do not rely on colour alone
// (Story 3.4 AC-AX). The `data-*` attributes preserve the underlying
// status / entity for testing + styling hooks.

import { cn } from "@/lib/utils";
import {
  deviceConditionLabels,
  deviceStatusLabels,
} from "@/lib/constants/device";
import {
  availabilityBucketLabels,
  stockWarningLabels,
} from "@/lib/constants/inventory";
import {
  qrLabelRunStatusValues,
} from "@/lib/validations/qr-label-run";
// Value import (not `import type`): the runtime needs the array literals so
// `(typeof ...)[number]` resolves the union. Under `verbatimModuleSyntax`
// the `import type` form would erase the bindings and `typeof X` would
// resolve to `typeof undefined`.
import {
  deviceConditionValues,
  deviceStatusValues,
} from "@/lib/validations/device";
import {
  availabilityBucketValues,
  stockWarningValues,
} from "@/lib/validations/inventory";

export type ArticleStatus = "active" | "inactive";
export type DeviceStatus = (typeof deviceStatusValues)[number];
export type DeviceCondition = (typeof deviceConditionValues)[number];
export type QrLabelRunStatus = (typeof qrLabelRunStatusValues)[number];
export type AvailabilityStatus = (typeof availabilityBucketValues)[number];
export type StockWarningLevel = (typeof stockWarningValues)[number];

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
    }
  | {
      entity: "qr-label-run";
      status: QrLabelRunStatus;
      className?: string;
    }
  | {
      entity: "availability";
      status: AvailabilityStatus;
      className?: string;
    }
  | {
      entity: "stock-warning";
      status: StockWarningLevel;
      className?: string;
    };

const ARTICLE_LABELS: Record<ArticleStatus, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
};

const ARTICLE_CLASSES: Record<ArticleStatus, string> = {
  active: "bg-success-soft text-success-foreground",
  inactive: "bg-muted text-muted-foreground",
};

// Token mapping: full semantic-token coverage as of v1.3 of the design
// system — `success-soft`/`info-soft` for on-brand greens + Helsana blue,
// `warning-soft` for cleaning/maintenance amber, `destructive-soft` for
// repair/failure red. Provisional warning hue (golden amber 80°) pending
// Lilian sign-off in the next UX-alignment-pass.
const DEVICE_CLASSES: Record<DeviceStatus, string> = {
  available: "bg-success-soft text-success-foreground",
  rented: "bg-info-soft text-info-foreground",
  cleaning: "bg-warning-soft text-warning-foreground",
  repair: "bg-destructive-soft text-destructive",
  sold: "bg-muted text-muted-foreground",
};

const DEVICE_CONDITION_CLASSES: Record<DeviceCondition, string> = {
  gut: "bg-success-soft text-success-foreground",
  gebrauchsspuren: "bg-warning-soft text-warning-foreground",
  reparaturbeduerftig: "bg-destructive-soft text-destructive",
};

const QR_LABEL_RUN_LABELS: Record<QrLabelRunStatus, string> = {
  completed: "Erstellt",
  failed: "Fehlgeschlagen",
};

const QR_LABEL_RUN_CLASSES: Record<QrLabelRunStatus, string> = {
  completed: "bg-success-soft text-success-foreground",
  failed: "bg-destructive-soft text-destructive",
};

// Story 3.4 — availability bucket (derived view column). Boundaries fixed
// by SQL `case` in migration 00053: red=0, yellow=1..5, green>5.
const AVAILABILITY_CLASSES: Record<AvailabilityStatus, string> = {
  green: "bg-success-soft text-success-foreground",
  yellow: "bg-warning-soft text-warning-foreground",
  red: "bg-destructive-soft text-destructive",
};

// Story 3.4 — stock warning (derived view column). Critical wins over low
// (per the SQL `case` ordering); `none` renders no badge at all (the
// switch returns `null` early).
const STOCK_WARNING_CLASSES: Record<
  Exclude<StockWarningLevel, "none">,
  string
> = {
  low: "bg-warning-soft text-warning-foreground",
  critical: "bg-destructive-soft text-destructive",
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
    case "qr-label-run":
      label = QR_LABEL_RUN_LABELS[props.status] ?? props.status;
      classes = QR_LABEL_RUN_CLASSES[props.status] ?? FALLBACK_CLASSES;
      break;
    case "availability":
      label = availabilityBucketLabels[props.status] ?? props.status;
      classes = AVAILABILITY_CLASSES[props.status] ?? FALLBACK_CLASSES;
      break;
    case "stock-warning":
      // `none` renders nothing — caller controls the absence visually.
      if (props.status === "none") return null;
      label = stockWarningLabels[props.status] ?? props.status;
      classes = STOCK_WARNING_CLASSES[props.status] ?? FALLBACK_CLASSES;
      break;
    default: {
      const _exhaustive: never = props;
      throw new Error(`Unhandled StatusBadge entity: ${JSON.stringify(_exhaustive)}`);
    }
  }

  // German prefix for screen readers — keeps the entity discriminator
  // (`availability`, `stock-warning`, …) out of the aria-label, which
  // a German screen reader would otherwise read out as English.
  const ariaPrefix = ENTITY_ARIA_PREFIX_DE[props.entity];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        classes,
        props.className,
      )}
      data-status={props.status}
      data-entity={props.entity}
      aria-label={`${ariaPrefix}: ${label}`}
    >
      {label}
    </span>
  );
}

const ENTITY_ARIA_PREFIX_DE: Record<StatusBadgeProps["entity"], string> = {
  article: "Artikelstatus",
  device: "Gerätestatus",
  "device-condition": "Gerätezustand",
  "qr-label-run": "QR-Etikett",
  availability: "Verfügbarkeit",
  "stock-warning": "Lagerwarnung",
};
