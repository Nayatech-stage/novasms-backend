import { z } from 'zod';

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email'),
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;
