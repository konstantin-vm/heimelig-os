"use client";

// Shared helpers for clickable list-table rows. Used by customer/article/
// device/inventory tables so a click anywhere on the row navigates to the
// detail page, while still letting buttons, dropdown menus, and other links
// inside the row capture their own clicks.

import type { KeyboardEvent, MouseEvent } from "react";

type Router = { push: (href: string) => void };

const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, [role="menuitem"], [role="button"], [data-stop-row-click]';

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

export function navigateOnRowClick(
  e: MouseEvent<HTMLElement>,
  router: Router,
  href: string,
): void {
  if (e.defaultPrevented) return;
  // Ignore non-primary clicks so middle-click "open in new tab" and Cmd/Ctrl
  // modifiers fall through to the browser's default link semantics on any
  // <a> within the row.
  if (e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (isInteractiveTarget(e.target)) return;
  router.push(href);
}

export function navigateOnRowKey(
  e: KeyboardEvent<HTMLElement>,
  router: Router,
  href: string,
): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  // Only fire when focus is on the row itself, never when it sits on a
  // descendant button / menu item that already handles the keystroke.
  if (e.target !== e.currentTarget) return;
  e.preventDefault();
  router.push(href);
}
