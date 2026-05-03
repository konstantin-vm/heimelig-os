"use client";

import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { getSessionRole } from "@/lib/supabase/session";
import type { AppRole } from "@/lib/constants/roles";

/**
 * Returns the current user's app role from the JWT claims.
 *
 * Server-side equivalent: `loadShellSession()` in `components/composed/
 * shell-session.ts`. The role is stable for the session, so the query has a
 * long staleTime; it is invalidated only by sign-out / sign-in.
 *
 * Returns:
 * - `data: null` while loading or if no role is present
 * - `data: AppRole` once the JWT is resolved
 *
 * Use cases (Story 3.1): `<ArticleInfoCard>` hides Einkaufspreis for
 * warehouse; `<NewArticleButton>` is hidden for warehouse; `<PriceListCard>`
 * is not rendered for warehouse.
 */
export function useAppRole() {
  return useQuery({
    queryKey: ["session", "app-role"],
    staleTime: Infinity,
    queryFn: async (): Promise<AppRole | null> => {
      const supabase = createClient();
      const { data } = await supabase.auth.getClaims();
      return getSessionRole(data?.claims ?? null);
    },
  });
}
