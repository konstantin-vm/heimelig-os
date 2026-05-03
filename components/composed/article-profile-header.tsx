"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useArticle, useSoftDeleteArticle } from "@/lib/queries/articles";

import { ConfirmDialog } from "./confirm-dialog";
import { StatusBadge } from "./status-badge";

export type ArticleProfileHeaderProps = {
  articleId: string;
  /** Header click handler — opens the shared <ArticleEditForm> modal. */
  onEdit: () => void;
};

export function ArticleProfileHeader({
  articleId,
  onEdit,
}: ArticleProfileHeaderProps) {
  const router = useRouter();
  const { data: article, isLoading } = useArticle(articleId);
  const { data: role } = useAppRole();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const softDelete = useSoftDeleteArticle({
    onSuccess: () => {
      toast.success("Artikel deaktiviert.");
      setDeleteOpen(false);
      router.push("/articles");
    },
    onError: (err) => {
      toast.error("Artikel konnte nicht deaktiviert werden", {
        description: err.message,
      });
      setDeleteOpen(false);
    },
  });

  const title = article
    ? `${article.article_number} — ${article.name}${
        article.variant_label ? ` ${article.variant_label}` : ""
      }`
    : "—";

  const isAdmin = role === "admin";

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-2xl font-bold tracking-tight text-primary">
          {isLoading ? "…" : title}
        </h1>
        {article ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge
              entity="article"
              status={article.is_active ? "active" : "inactive"}
            />
          </div>
        ) : null}
      </div>
      <div
        className="flex flex-wrap items-center gap-2 sm:justify-end"
        role="group"
        aria-label="Artikelaktionen"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          aria-label="Artikel bearbeiten"
          disabled={isLoading || !article}
        >
          <Pencil className="h-4 w-4" aria-hidden />
          Bearbeiten
        </Button>
        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            aria-label="Artikel löschen"
            className="text-destructive hover:text-destructive"
            // Disable while the article query is still loading — the
            // confirmation dialog references `article.article_number` /
            // `article.name`, which would render as "—" otherwise.
            disabled={isLoading || !article}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Löschen
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Artikel deaktivieren?"
        description={
          article
            ? `Der Artikel ${article.article_number} (${article.name}) wird auf inaktiv gesetzt. Bestehende Verträge bleiben unberührt; der Artikel ist für neue Aufträge nicht mehr verfügbar.`
            : null
        }
        confirmLabel="Deaktivieren"
        variant="destructive"
        onConfirm={async () => {
          await softDelete.mutateAsync({ id: articleId });
        }}
      />
    </header>
  );
}
