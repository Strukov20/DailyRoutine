import { z } from 'zod';

/**
 * Validation only — no translated messages here. Zod's own `message`
 * strings are for developer logs, never shown to users; components map
 * `error.type`/field name to a translated string instead (see
 * app/(auth)/sign-in.tsx), so this schema has no i18n dependency and stays
 * reusable from anywhere (including a future server-side function).
 */
export const signInSchema = z.object({
  email: z.string().min(1, 'email_required').pipe(z.email('email_invalid')),
  password: z.string().min(8, 'password_too_short'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = signInSchema.extend({
  name: z.string().min(1, 'name_required'),
});
export type SignUpInput = z.infer<typeof signUpSchema>;
