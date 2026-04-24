import { Suspense } from "react";

import { PageShell } from "@/components/composed";

type StopPageProps = {
  params: Promise<{ id: string }>;
};

async function StopDetail({ params }: StopPageProps) {
  const { id } = await params;
  return (
    <PageShell title={`Stopp ${id}`} backHref="/tour">
      <p className="text-sm text-muted-foreground">
        Stopp-Details werden in Epic 8 umgesetzt.
      </p>
    </PageShell>
  );
}

export default function StopDetailPage(props: StopPageProps) {
  return (
    <Suspense>
      <StopDetail params={props.params} />
    </Suspense>
  );
}
