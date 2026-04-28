import { z } from 'zod';

export const SpecClassificationSchema = z.enum(['light', 'deep']);
export type SpecClassification = z.infer<typeof SpecClassificationSchema>;

export const SpecTypeSchema = z.enum(['feat', 'fix', 'refactor', 'chore', 'perf']);
export type SpecType = z.infer<typeof SpecTypeSchema>;

export const SpecStatusSchema = z.enum(['ready', 'drafting', 'blocked']);
export type SpecStatus = z.infer<typeof SpecStatusSchema>;

export const SpecExemplarSchema = z
  .object({
    path: z.string().min(1, 'path must be a non-empty string'),
    why: z.string().min(1, 'why must be a non-empty string'),
  })
  .strict();
export type SpecExemplar = z.infer<typeof SpecExemplarSchema>;

export const SpecFrontmatterSchema = z
  .object({
    id: z.string().min(1, 'id must be a non-empty string'),
    classification: SpecClassificationSchema,
    type: SpecTypeSchema,
    status: SpecStatusSchema,
    exemplars: z.array(SpecExemplarSchema).default([]),
  })
  .strict();
export type SpecFrontmatter = z.infer<typeof SpecFrontmatterSchema>;

export const SpecScenarioSatisfactionKindSchema = z.enum(['test', 'judge']);
export type SpecScenarioSatisfactionKind = z.infer<typeof SpecScenarioSatisfactionKindSchema>;

export const SpecScenarioSatisfactionSchema = z
  .object({
    kind: SpecScenarioSatisfactionKindSchema,
    value: z.string().min(1),
    line: z.number().int().positive(),
  })
  .strict();
export type ScenarioSatisfaction = z.infer<typeof SpecScenarioSatisfactionSchema>;

export const SpecScenarioKindSchema = z.enum(['scenario', 'holdout']);
export type SpecScenarioKind = z.infer<typeof SpecScenarioKindSchema>;

export interface Scenario {
  id: string;
  name: string;
  given: string;
  when: string;
  then: string;
  satisfaction: ScenarioSatisfaction[];
  line: number;
  kind: SpecScenarioKind;
}

export interface Spec {
  frontmatter: SpecFrontmatter;
  body: string;
  scenarios: Scenario[];
  holdouts: Scenario[];
  raw: { source: string; filename?: string };
}
