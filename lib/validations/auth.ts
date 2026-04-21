import { z } from "zod";

// `.trim()` before `.email()` so pasted emails (e.g. from password managers)
// with leading/trailing whitespace validate cleanly.
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email({ error: "Ungültige E-Mail-Adresse" })),
  password: z
    .string()
    .min(8, { error: "Passwort muss mindestens 8 Zeichen haben" }),
});

export type LoginInput = z.infer<typeof loginSchema>;
