// <SprintGateBanner> — full-page placeholder rendered when a Sprint-5 feature
// (Story 3.5 mobile QR scan, Story 3.6 batch register, Story 3.7 QR-label
// print/history) is gated off via the `NEXT_PUBLIC_SHOW_SPRINT5_FEATURES`
// flag. The underlying code stays in the repo — this banner just replaces
// the page body so a stakeholder hitting the route directly during a demo
// sees a calm "coming next sprint" message instead of a broken-looking page.
//
// Server-component-safe: no hooks, no client APIs.
import Link from "next/link";
import { Construction } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type SprintGateBannerProps = {
  /** Sprint number the feature is scheduled for (e.g. 5). */
  sprint: number;
  /** Short German feature label, e.g. "QR-Code-Scanning für Geräte". */
  feature: string;
  /** Optional ETA string. Defaults to "Ende Juni 2026". */
  eta?: string;
};

export function SprintGateBanner({
  sprint,
  feature,
  eta,
}: SprintGateBannerProps) {
  const etaText = eta && eta.trim().length > 0 ? eta : "Ende Juni 2026";
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-4 py-10">
      <Card className="max-w-lg w-full">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <div
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"
            aria-hidden="true"
          >
            <Construction className="h-5 w-5" />
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle>Verfügbar in Sprint {sprint}</CardTitle>
            <CardDescription>
              {feature} wird im nächsten Sprint freigegeben. Voraussichtlich{" "}
              {etaText}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/">Zurück zur Übersicht</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
