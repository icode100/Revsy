import { useEffect, useRef } from 'react';
import type { QuizAnswer, QuizQuestion } from '../../types/quiz';

export const primaryButton = 'rounded-xl bg-purple-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButton = 'rounded-xl border border-gray-200 bg-white/60 px-4 py-2 text-sm font-semibold transition hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900 dark:hover:bg-neutral-800';
export const inputStyle = 'w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-3 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  return alive;
}

export function questionLabel(question: QuizQuestion): string {
  return 'kind' in question ? `${question.session} · ${question.section} · Question ${question.number}` : `Question ${question.number}`;
}

export function hasAnswer(answer: QuizAnswer | undefined): boolean {
  return answer !== null && answer !== undefined
    && (Array.isArray(answer) ? answer.length > 0 : typeof answer === 'string' ? answer.trim().length > 0 : true);
}

export function formatMarks(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
