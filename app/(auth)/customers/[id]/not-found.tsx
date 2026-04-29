import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/composed";

export default function CustomerNotFound() {
  return (
    <PageShell title="Kunde nicht gefunden" backHref="/customers">
      <div className="flex flex-col items-start gap-4 rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Der angeforderte Kunde existiert nicht oder wurde gelöscht.
        </p>
        <Button asChild variant="outline">
          <Link href="/customers">Zurück zur Kundenliste</Link>
        </Button>
      </div>
    </PageShell>
  );
}
