import { z } from 'zod';

export const RegisterSchema = z.object({
  nom: z.string().min(2, 'Company name must be at least 2 characters'),
  email: z
    .string()
    .email('Invalid professional email address')
    .refine((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), 'Invalid email format')
    .refine((e) => {
      const domain = e.split('@')[1]?.toLowerCase();
      const disposable = [
        'tempmail.com',
        '10minutemail.com',
        'guerrillamail.com',
      ];
      return domain && !disposable.includes(domain);
    }, 'Please use a valid professional email address'),
  motDePasse: z
    .string()
    .min(8, 'Minimum 8 characters required')
    .regex(/[A-Z]/, 'At least 1 uppercase letter required')
    .regex(/[0-9]/, 'At least 1 digit required')
    .regex(/[^A-Za-z0-9]/, 'At least 1 special character required'),
  nomBoutique: z.string().min(2, 'Store name is required'),
  pays: z.string().min(2, 'Country is required'),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
