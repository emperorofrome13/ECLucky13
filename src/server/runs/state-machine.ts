import { ALLOWED_TRANSITIONS, isTerminal, type RunState } from '@/shared/contracts';

export class IllegalTransition extends Error {
  constructor(from: RunState, to: RunState) { super(`Illegal run state transition ${from} -> ${to}`); }
}

export function assertTransition(from: RunState, to: RunState): void {
  if (from === to) return;
  if (isTerminal(from)) throw new IllegalTransition(from, to);
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new IllegalTransition(from, to);
}
