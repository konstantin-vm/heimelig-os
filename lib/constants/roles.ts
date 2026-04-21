import { z } from "zod";

export const APP_ROLE_VALUES = [
  "admin",
  "office",
  "technician",
  "warehouse",
] as const;

export const appRoleSchema = z.enum(APP_ROLE_VALUES);

export type AppRole = z.infer<typeof appRoleSchema>;

export const ROLE_LANDING_PATH: Record<AppRole, "/dashboard" | "/articles" | "/tour"> = {
  admin: "/dashboard",
  office: "/dashboard",
  warehouse: "/articles",
  technician: "/tour",
};

export const ROLE_ALLOWED_PATHS: Record<AppRole, readonly string[]> = {
  admin: [
    "/dashboard",
    "/customers",
    "/articles",
    "/orders",
    "/contracts",
    "/invoices",
    "/tours",
    "/settings",
    "/errors",
  ],
  office: [
    "/dashboard",
    "/customers",
    "/articles",
    "/orders",
    "/contracts",
    "/invoices",
    "/tours",
  ],
  warehouse: ["/articles"],
  technician: ["/tour", "/stop"],
};
