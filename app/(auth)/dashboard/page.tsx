import { PageShell } from "@/components/composed";

// TODO(Story 3.5 follow-up): once the dashboard role-variants land
// (post Story 1.4 wiring), expose a "Scannen" primary CTA on the
// warehouse variant linking to `/scan`. The route + sidebar entry are
// already live from Story 3.5 — only the dashboard surface is stubbed.
// Note: warehouse role's landing path is `/articles` (see ROLE_LANDING_PATH),
// so admin / office are the only roles who land here today; the CTA still
// matters for them as occasional support users of the scan flow.

export default function DashboardPage() {
  return (
    <PageShell title="Dashboard">
      <p className="text-sm text-muted-foreground">
        Dashboard-Inhalte werden in späteren Epics umgesetzt.
      </p>
    </PageShell>
  );
}
