import { z } from 'zod';

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z
    .string()
    .min(8, 'Minimum 8 characters required')
    .regex(/[A-Z]/, 'At least 1 uppercase letter required')
    .regex(/[0-9]/, 'At least 1 digit required')
    .regex(/[^A-Za-z0-9]/, 'At least 1 special character required'),
});

export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
