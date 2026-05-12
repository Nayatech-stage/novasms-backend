import { z } from 'zod';

export const RuleSchema = z.object({
  field: z.enum([
    'email',
    'phone',
    'location',
    'tag',
    'createdAt',
    'lastPurchaseDate',
    'status',
    'firstName',
    'lastName',
  ]),
  operator: z.enum([
    'equals',
    'contains',
    'gt',
    'lt',
    'gte',
    'lte',
    'in',
    'notIn',
    'notEquals',
  ]),
  value: z
    .union([
      z.string().min(1, 'La valeur ne peut pas être vide'),
      z.number(),
      z.array(
        z.string().min(1, 'La valeur dans le tableau ne peut pas être vide'),
      ),
    ])
    .refine(
      (val) => {
        if (typeof val === 'string') return val.trim().length > 0;
        if (Array.isArray(val))
          return val.every((v) => typeof v === 'string' && v.trim().length > 0);
        return true;
      },
      { message: 'La valeur ne peut pas être vide' },
    ),
});

const maxRules = 20;

export const CriteriaSchema = z.object({
  logic: z.enum(['AND', 'OR']),
  rules: z
    .array(RuleSchema)
    .min(1, 'Au moins une règle requise')
    .max(maxRules, `Maximum ${maxRules} règles autorisées`),
});

export const SegmentPreviewSchema = z.object({
  logic: z.enum(['AND', 'OR']).optional().default('AND'),
  criteria: z
    .array(z.any())
    .min(0)
    .max(maxRules, `Maximum ${maxRules} critères autorisés`)
    .optional()
    .default([]),
});

export const SegmentCreateSchema = z.object({
  name: z
    .string()
    .min(1, 'Le nom du segment est requis')
    .max(255, 'Le nom du segment ne doit pas dépasser 255 caractères')
    .regex(
      /^[a-zA-Z0-9À-ÖØ-öø-ÿ\s\-_'()&]+$/,
      'Le nom contient des caractères invalides',
    ),
  logic: z.enum(['AND', 'OR']).optional().default('AND'),
  criteria: z
    .array(z.any())
    .min(0)
    .max(maxRules, `Maximum ${maxRules} critères autorisés`)
    .optional()
    .default([]),
});

export type Rule = z.infer<typeof RuleSchema>;
export type Criteria = z.infer<typeof CriteriaSchema>;
export type SegmentCreateData = z.infer<typeof SegmentCreateSchema>;
