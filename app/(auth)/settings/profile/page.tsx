import { PageShell } from "@/components/composed";

export default function SettingsProfilePage() {
  return (
    <PageShell title="Persönliche Einstellungen">
      <p className="text-sm text-muted-foreground">
        Im MVP nicht vorgesehen — User-Verwaltung läuft über das Supabase
        Dashboard (siehe <code>docs/internal/user-onboarding.md</code>).
        Eine in-app Profilseite wird ggf. Post-MVP nachgezogen.
      </p>
    </PageShell>
  );
}
