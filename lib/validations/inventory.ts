import { z } from "zod";

import { articleCategorySchema } from "./article";
import { uuidSchema } from "./common";

// Mirrors `public.inventory_overview` (migration 00053, Story 3.4).
//
// The view exposes per-article rollup columns + two derived enums
// (`availability_bucket`, `stock_warning`) whose wire values are produced
// by SQL `case` expressions in the view body. These Zod enums are the
// runtime guard at the response boundary — `useInventoryOverview` runs
// `z.array(inventoryRowSchema).safeParse(...)` and soft-fails with a
// `VALIDATION` `error_log` row on drift (consistent with the Story 3.2
// pattern in `lib/queries/devices.ts`).

export const availabilityBucketValues = [
  "green",
  "yellow",
  "red",
] as const;
export const availabilityBucketSchema = z.enum(availabilityBucketValues);
export type AvailabilityBucket = z.infer<typeof availabilityBucketSchema>;

export const stockWarningValues = ["none", "low", "critical"] as const;
export const stockWarningSchema = z.enum(stockWarningValues);
export type StockWarning = z.infer<typeof stockWarningSchema>;

// PostgREST returns `bigint` aggregate columns (count) as JS numbers via
// the JSON parser when the value fits in `Number.MAX_SAFE_INTEGER` (which
// it always does for device counts — bounded by table size, capped well
// below 2^53). The schema declares `z.number().int().nonnegative()` so a
// future driver change that sends them as strings would surface here.
const countSchema = z
  .number()
  .int()
  .nonnegative();

export const inventoryRowSchema = z.object({
  article_id: uuidSchema,
  article_number: z.string(),
  name: z.string(),
  category: articleCategorySchema,
  variant_label: z.string().nullable(),
  manufacturer: z.string().nullable(),
  min_stock: z.number().int().nonnegative().nullable(),
  critical_stock: z.number().int().nonnegative().nullable(),
  is_active: z.boolean(),
  total_devices: countSchema,
  available_devices: countSchema,
  rented_devices: countSchema,
  cleaning_devices: countSchema,
  repair_devices: countSchema,
  sold_devices: countSchema,
  retired_devices: countSchema,
  availability_bucket: availabilityBucketSchema,
  stock_warning: stockWarningSchema,
});

export type InventoryRow = z.infer<typeof inventoryRowSchema>;
