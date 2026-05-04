"use client";

// <DeviceStatusTransitionDialog> — Story 3.3.
//
// Surface for the device status state machine. Renders the valid next
// statuses computed from `deviceStatusTransitions[currentStatus]` (the UI
// SSOT — mirrored byte-identical inside `transition_device_status` in
// migration 00049). The RPC re-validates as the authoritative gate, so
// devtools tampering with the button list (or a stale optimistic render)
// just surfaces a German error inline rather than corrupting the audit
// trail.
//
// Story-3.3 design follow-up: there is no Pencil frame for this surface
// yet — Lilian's UX-alignment-pass story (Story 3.2 follow-up) will polish
// the entire device profile once the frames land. shadcn defaults are the
// floor until then. The codebase does not currently ship a `<Sheet>`
// primitive or `useIsMobile()` hook, so the desktop-on-mobile fallback in
// the spec collapses to a responsive `<Dialog>` with `sm:max-w-md` —
// matches `<PriceListEditDialog>` / `<ConfirmDialog>` for visual
// consistency. Note in story Completion Notes.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deviceStatusLabels,
  deviceStatusTransitions,
  isTerminalDeviceStatus,
} from "@/lib/constants/device";
import { useDeviceStatusTransition } from "@/lib/queries/devices";
import type { Device } from "@/lib/validations/device";

import { ConfirmDialog } from "./confirm-dialog";
import { StatusBadge } from "./status-badge";

const NOTE_MAX_LEN = 500;

export type DeviceStatusTransitionDialogProps = {
  device: {
    id: string;
    status: Device["status"];
    article_id: string;
    serial_number: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Fired only on a successful RPC. Story 3.5 wires its scan-result auto-clear
  // here so cancel-by-Escape does not yank the worker back to the camera.
  onSuccess?: (newStatus: Device["status"]) => void;
};

export function DeviceStatusTransitionDialog({
  device,
  open,
  onOpenChange,
  onSuccess,
}: DeviceStatusTransitionDialogProps) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The "are you sure?" gate fires only for terminal/destructive transitions
  // (currently just `→ sold`). For non-destructive transitions, the button
  // click submits directly.
  const [pendingSold, setPendingSold] = useState<boolean>(false);
  // Track which button the user clicked so we can show the spinner on it
  // and disable the rest.
  const [activeNext, setActiveNext] = useState<Device["status"] | null>(null);

  // Reset local state every time the dialog opens — the parent reuses the
  // same component instance across opens. React's "adjust state on prop
  // change" pattern (https://react.dev/learn/you-might-not-need-an-effect):
  // compare during render, schedule a re-render with the reset state, no
  // useEffect needed.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setNote("");
      setError(null);
      setPendingSold(false);
      setActiveNext(null);
    }
  }

  const transition = useDeviceStatusTransition({
    onSuccess: (_data, vars) => {
      toast.success(`Status auf „${deviceStatusLabels[vars.newStatus]}“ geändert.`);
      onOpenChange(false);
      onSuccess?.(vars.newStatus);
    },
    onError: (err) => {
      // Keep the dialog open. Surface the (already-mapped German) message
      // inline; the toast would be redundant + easy to miss while the
      // dialog covers the focus.
      setError(err.message);
      setActiveNext(null);
      setPendingSold(false);
    },
  });

  // Runtime drift guard: a 6th status value reaching the UI before the TS
  // rebuild lands in prod would yield `undefined` from the constant lookup
  // and crash `.map`/`.length` at render. Coerce to an empty array and
  // collapse the "no allowed transitions" branch onto the terminal-state
  // copy so the user sees a neutral message rather than a white screen.
  const allowed = deviceStatusTransitions[device.status] ?? [];
  const terminal = isTerminalDeviceStatus(device.status) || allowed.length === 0;

  function submit(next: Device["status"]) {
    setError(null);
    setActiveNext(next);
    transition.mutate({
      deviceId: device.id,
      newStatus: next,
      context: note.trim().length > 0 ? { note: note.trim() } : undefined,
    });
  }

  function handleClick(next: Device["status"]) {
    if (transition.isPending) return;
    if (next === "sold") {
      // Open the nested ConfirmDialog gate; submission happens in onConfirm.
      setActiveNext(next);
      setPendingSold(true);
      return;
    }
    submit(next);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Allow Escape / explicit close even while the mutation is in
        // flight — Supabase's `statement_timeout` (8s) bounds the wait,
        // and the consumer's `onError` resets local state. Blocking
        // dismissal here can leave the dialog wedged on a hung RPC.
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={(e) => {
          // Outside-click while pending is almost always accidental — keep
          // the user's note + dialog state until the mutation settles or
          // they explicitly press Escape / the close button.
          if (transition.isPending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Status ändern</DialogTitle>
          <DialogDescription>
            Seriennummer{" "}
            <span className="font-mono">{device.serial_number}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Aktueller Status</span>
            <div>
              <StatusBadge entity="device" status={device.status} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Neuer Status</span>
            {terminal ? (
              <p className="rounded-md border border-input bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                Dies ist ein Endzustand. Keine weiteren Statuswechsel möglich.
              </p>
            ) : (
              <div
                className="flex flex-col gap-2"
                role="group"
                aria-label="Verfügbare Status-Übergänge"
              >
                {allowed.map((next) => {
                  const isActive = activeNext === next && transition.isPending;
                  return (
                    <Button
                      key={next}
                      type="button"
                      variant={next === "sold" ? "outline" : "default"}
                      className={
                        // Min tap target ≥ 44×44px (Story 3.3 AC-AX). Default
                        // shadcn button is 36px tall — bump on this surface.
                        "min-h-11 justify-start"
                      }
                      onClick={() => handleClick(next)}
                      disabled={transition.isPending}
                      aria-label={`Auf „${deviceStatusLabels[next]}“ setzen`}
                    >
                      {isActive ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : null}
                      {deviceStatusLabels[next]}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          {!terminal ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="device-status-note">
                Begründung (optional)
              </Label>
              <Textarea
                id="device-status-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX_LEN))}
                rows={3}
                maxLength={NOTE_MAX_LEN}
                placeholder="Optional: Begründung oder Kontext…"
                disabled={transition.isPending}
              />
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >
                {note.length}/{NOTE_MAX_LEN}
              </span>
            </div>
          ) : null}

          {error ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>

      <ConfirmDialog
        open={pendingSold}
        onOpenChange={(next) => {
          setPendingSold(next);
          if (!next) setActiveNext(null);
        }}
        title="Gerät als verkauft markieren?"
        description="Dieser Statuswechsel ist endgültig — verkaufte Geräte können nicht mehr in den Mietpool zurück."
        confirmLabel="Als verkauft markieren"
        variant="destructive"
        onConfirm={async () => {
          await new Promise<void>((resolve, reject) => {
            // Defensive — if mutate's callbacks never fire (shouldn't
            // happen given PostgREST's `statement_timeout`), surface as a
            // rejection so ConfirmDialog stops showing the pending state.
            // Captured so we can clear it on settle and avoid a dangling
            // 30s closure over `device` / `note` / etc.
            const timer = setTimeout(
              () => reject(new Error("timeout")),
              30_000,
            );
            transition.mutate(
              {
                deviceId: device.id,
                newStatus: "sold",
                context:
                  note.trim().length > 0 ? { note: note.trim() } : undefined,
              },
              {
                onSuccess: () => {
                  clearTimeout(timer);
                  // Close the inner ConfirmDialog explicitly — the outer
                  // Dialog closes via the hook's `options.onSuccess`
                  // (`onOpenChange(false)`), but `pendingSold` would
                  // otherwise stay `true` and leave the destructive
                  // confirmation overlay lingering on screen alongside
                  // the success toast.
                  setPendingSold(false);
                  resolve();
                },
                onError: () => {
                  clearTimeout(timer);
                  setPendingSold(false);
                  resolve();
                },
              },
            );
          }).catch(() => {
            /* swallowed — onError already wrote `error` state */
          });
        }}
      />
    </Dialog>
  );
}
