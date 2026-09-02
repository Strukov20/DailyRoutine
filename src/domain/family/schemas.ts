import { z } from 'zod';

/**
 * Validation only — no translated messages here, same convention as
 * src/domain/auth/schemas.ts. Components map `error.type`/field name to a
 * translated string instead.
 */
export const createFamilySchema = z.object({
  name: z.string().trim().min(1, 'name_required'),
});
export type CreateFamilyInput = z.infer<typeof createFamilySchema>;

export const inviteMemberSchema = z.object({
  email: z.string().min(1, 'email_required').pipe(z.email('email_invalid')),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const createChildProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'display_name_required'),
  dateOfBirth: z.string().optional(),
});
export type CreateChildProfileInput = z.infer<typeof createChildProfileSchema>;

export const updateChildProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'display_name_required'),
  dateOfBirth: z.string().optional(),
});
export type UpdateChildProfileInput = z.infer<typeof updateChildProfileSchema>;
