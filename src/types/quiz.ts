export interface QuizAsset {
  id: string;
  storagePath: string;
  page: number;
}

export interface LegacyQuizQuestion {
  id: string;
  number: string;
  problem: string;
  options: string[];
  images: QuizAsset[];
}

export type QuizQuestionKind = 'mcq' | 'msq' | 'nat';
export type QuizAnswer = number | number[] | string | null;

export interface GateQuizQuestion extends LegacyQuizQuestion {
  kind: QuizQuestionKind;
  session: string;
  section: string;
  marks: 1 | 2;
}

export type QuizQuestion = LegacyQuizQuestion | GateQuizQuestion;

export interface NumericAnswerRange {
  minValue: string;
  maxValue: string;
}

export type GateKeyEntry =
  | { questionId: string; kind: 'mcq'; acceptedOptionIndices: number[] }
  | { questionId: string; kind: 'msq'; correctOptionIndices: number[] }
  | { questionId: string; kind: 'nat'; minValue: string; maxValue: string;
    additionalRanges?: NumericAnswerRange[] };

interface QuizDraftMetadata {
  title: string;
  source: { paperPath: string; answerKeyPath?: string };
  parsing: { model: string; warnings: string[] };
}

export interface LegacyQuizDraft extends QuizDraftMetadata {
  schemaVersion: 1;
  question: LegacyQuizQuestion[];
  key: { questionId: string; correctOptionIndex: number }[];
}

export interface GateQuizDraft extends QuizDraftMetadata {
  schemaVersion: 2;
  question: GateQuizQuestion[];
  key: GateKeyEntry[];
}

export type QuizDraft = LegacyQuizDraft | GateQuizDraft;

export type QuizDocument = QuizDraft & {
  id: string;
  createdAt: number;
};

export type QuizImportStatus =
  | 'queued'
  | 'reading-paper'
  | 'reading-key'
  | 'storing-images'
  | 'structuring'
  | 'validating'
  | 'ready'
  | 'failed';

export interface QuizImport {
  id: string;
  title: string;
  status: QuizImportStatus;
  createdAt: number;
  message?: string;
  error?: string;
  draft?: QuizDraft;
  savedQuizId?: string;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  answers: QuizAnswer[];
  correct: number;
  total: number;
  submittedAt: number;
  score?: number;
  maxScore?: number;
}
