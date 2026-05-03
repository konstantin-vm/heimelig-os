// <StatusBadge> — generic status colourer declared in
// `docs/design/desktop/component-map.md`. Story 3.1 ships the `'article'`
// entity (Aktiv / Inaktiv); Story 3.2 will extend it with device statuses.
// Use this in place of raw `<Badge>` so the entity-specific German labels +
// token mapping live in one place.

import { cn } from "@/lib/utils";

export type ArticleStatus = "active" | "inactive";

export type StatusBadgeProps =
  | {
      entity: "article";
      status: ArticleStatus;
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

export function StatusBadge(props: StatusBadgeProps) {
  // Sprint-1 only ships the `'article'` entity; Story 3.2 will extend the
  // discriminated union with a `'device'` arm. TypeScript will then force a
  // new branch here via the exhaustive switch on `props.entity`.
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        ARTICLE_CLASSES[props.status],
        props.className,
      )}
      data-status={props.status}
      data-entity={props.entity}
    >
      {ARTICLE_LABELS[props.status]}
    </span>
  );
}
