// Canonical autoprompt stage definitions. Shared by server, settings, and UI so they cannot drift.

export interface StageDef {
  id: string;
  label: string;
  description: string;
  file: string;        // autoprompts/<file>
  requiresMutation: boolean;
}

export const STAGE_DEFS: StageDef[] = [
  { id: 'review', label: 'Review', description: 'Double-check the work for real bugs and fix them.', file: 'review.md', requiresMutation: false },
  { id: 'completeness', label: 'Completeness', description: 'Diff the original request against what exists; fill gaps.', file: 'completeness.md', requiresMutation: false },
  { id: 'senior_review', label: 'Senior Review', description: 'Architecture, boundaries, security, real-use survival.', file: 'senior_review.md', requiresMutation: false },
  { id: 'run_fix', label: 'Run / Fix', description: 'Actually run the deliverable, read errors, fix until it runs clean.', file: 'run_fix.md', requiresMutation: true },
];

export const STAGE_ORDER: string[] = STAGE_DEFS.map((s) => s.id);

export function stageById(id: string): StageDef | undefined {
  return STAGE_DEFS.find((s) => s.id === id);
}

/** Validate, dedupe, and order stage ids against the canonical list. Unknown ids are dropped. */
export function canonicalizeStages(ids: unknown): string[] {
  const set = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  return STAGE_ORDER.filter((id) => set.has(id));
}
