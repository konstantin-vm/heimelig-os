"use client";

import { useState } from "react";
import Link from "next/link";

import {
  ArticleEditForm,
  ArticleInfoCard,
  ArticleProfileHeader,
  PriceListCard,
} from "@/components/composed";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppRole } from "@/lib/hooks/use-app-role";

export type ArticleProfileShellProps = {
  articleId: string;
  /** Title-line label (article_number — name [variant]) computed server-side. */
  label: string;
  isRentable: boolean;
};

export function ArticleProfileShell({
  articleId,
  label,
  isRentable,
}: ArticleProfileShellProps) {
  const [editOpen, setEditOpen] = useState(false);
  const { data: role } = useAppRole();
  const showPrices = role !== "warehouse" && role !== "technician";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/articles">Artikel</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ArticleProfileHeader
        articleId={articleId}
        onEdit={() => setEditOpen(true)}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ArticleInfoCard articleId={articleId} onEdit={() => setEditOpen(true)} />
          {showPrices ? <PriceListCard articleId={articleId} /> : null}
        </div>
        <div className="flex flex-col gap-6">
          {isRentable ? <DevicesStubCard /> : null}
        </div>
      </div>

      {editOpen ? (
        <ArticleEditForm
          mode="edit"
          articleId={articleId}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}
    </div>
  );
}

function DevicesStubCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Geräte</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Verfügbar mit Story 3.2 — Geräte-Tracking.
        </p>
        {/* TODO(Story 3.2) — wire <ArticleDevicesCard articleId={articleId} /> */}
      </CardContent>
    </Card>
  );
}
