import {
  appRoleSchema,
  ROLE_LANDING_PATH,
  type AppRole,
} from "@/lib/constants/roles";

export function getSessionRole(claims: unknown): AppRole | null {
  if (typeof claims !== "object" || claims === null) return null;
  const appMeta = (claims as { app_metadata?: unknown }).app_metadata;
  if (typeof appMeta !== "object" || appMeta === null) return null;
  const raw = (appMeta as { app_role?: unknown }).app_role;
  const parsed = appRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function landingPathFor(role: AppRole | null): string {
  if (role === null) return "/auth/error?error=no_role_assigned";
  return ROLE_LANDING_PATH[role];
}
