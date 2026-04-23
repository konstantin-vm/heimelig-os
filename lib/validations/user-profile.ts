import { z } from "zod";
import { APP_ROLE_VALUES } from "@/lib/constants/roles";
import {
  emailSchema,
  hexColorSchema,
  isoTimestampSchema,
  phoneSchema,
  uuidSchema,
} from "./common";

// Mirrors `user_profiles` (data-model-spec §5.1). Row fields are nullable where
// the DB allows NULL; server-generated fields are not required on inserts.

export const userProfileSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  display_name: z.string().nullable(),
  initials: z
    .string()
    .min(2, { error: "Initialen müssen 2–4 Zeichen lang sein" })
    .max(4, { error: "Initialen müssen 2–4 Zeichen lang sein" })
    .nullable(),
  app_role: z.enum(APP_ROLE_VALUES),
  phone: phoneSchema.nullable(),
  mobile: phoneSchema.nullable(),
  employee_id: z.string().nullable(),
  is_active: z.boolean(),
  color_hex: hexColorSchema.nullable(),
  settings: z.record(z.string(), z.unknown()),
  notes: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

// Profiles are created by the auth trigger — clients never insert directly.
// CreateSchema is therefore the admin-backfill shape.
export const userProfileCreateSchema = userProfileSchema
  .omit({
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
    is_active: true,
    settings: true,
  })
  .extend({
    is_active: z.boolean().default(true),
    settings: z.record(z.string(), z.unknown()).default({}),
  });

// Self-edit subset exposed via `user_profiles_self` view.
export const userProfileSelfUpdateSchema = z
  .object({
    phone: phoneSchema.nullable().optional(),
    mobile: phoneSchema.nullable().optional(),
    display_name: z.string().min(1).nullable().optional(),
    color_hex: hexColorSchema.nullable().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const userProfileUpdateSchema = userProfileCreateSchema.partial();

export type UserProfile = z.infer<typeof userProfileSchema>;
export type UserProfileCreate = z.infer<typeof userProfileCreateSchema>;
export type UserProfileUpdate = z.infer<typeof userProfileUpdateSchema>;
export type UserProfileSelfUpdate = z.infer<typeof userProfileSelfUpdateSchema>;
