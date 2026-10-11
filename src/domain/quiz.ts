import type {
  GateKeyEntry, GateQuizDraft, GateQuizQuestion, LegacyQuizDraft, NumericAnswerRange, QuizAnswer, QuizAsset,
  QuizAttempt, QuizDraft, QuizQuestion, QuizQuestionKind,
} from '../types/quiz';

export const MAX_QUIZ_BYTES = 800_000;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const safeId = /^[A-Za-z0-9_-]{1,80}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} must contain text (maximum ${max} characters).`);
  }
  return value.trim();
}

function id(value: unknown, label: string): string {
  const result = text(value, label, 80);
  if (!safeId.test(result)) throw new Error(`${label} contains unsupported characters.`);
  return result;
}

// Compare integer coefficients exactly, including bounded scientific notation.
function decimal(value: unknown, label: string): { coefficient: bigint; scale: number } {
  const input = text(value, label, 200);
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match) throw new Error(`${label} must be a finite decimal number.`);
  const exponent = match[5] === undefined ? 0 : Number(match[5]);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000) {
    throw new Error(`${label} has an unsupported decimal exponent.`);
  }
  const fraction = match[3] ?? match[4] ?? '';
  const digits = `${match[2] ?? '0'}${fraction}`;
  return { coefficient: BigInt(`${match[1] === '-' ? '-' : ''}${digits}`),
    scale: fraction.length - exponent };
}

export function compareNumericAnswers(left: string, right: string): number {
  const a = decimal(left, 'Numeric answer');
  const b = decimal(right, 'Numeric answer');
  const scale = Math.max(a.scale, b.scale);
  const aValue = a.coefficient * (10n ** BigInt(scale - a.scale));
  const bValue = b.coefficient * (10n ** BigInt(scale - b.scale));
  return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
}

export function questionKind(question: QuizQuestion): QuizQuestionKind {
  return 'kind' in question ? question.kind : 'mcq';
}

function optionIndices(value: unknown, question: QuizQuestion, label: string): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > question.options.length
    || Array.from(value).some(index => !Number.isInteger(index) || index < 0 || index >= question.options.length)
    || new Set(value).size !== value.length) {
    throw new Error(`${label} for question ${question.number} must contain unique valid options.`);
  }
  return [...value].sort((a, b) => a - b) as number[];
}

function numericRange(input: unknown, questionNumber: string): NumericAnswerRange {
  const range = object(input, 'Numeric answer range');
  if (Object.keys(range).some(field => field !== 'minValue' && field !== 'maxValue')) {
    throw new Error(`The numeric answer range for question ${questionNumber} contains unsupported fields.`);
  }
  const minValue = text(range.minValue, 'Minimum numeric answer', 200);
  const maxValue = text(range.maxValue, 'Maximum numeric answer', 200);
  if (compareNumericAnswers(minValue, maxValue) > 0) {
    throw new Error(`The numeric answer range for question ${questionNumber} is reversed.`);
  }
  return { minValue, maxValue };
}

function gateKeyEntry(input: unknown, question: GateQuizQuestion): GateKeyEntry {
  if (question.kind !== 'mcq' && question.kind !== 'msq' && question.kind !== 'nat') {
    throw new Error(`Question ${question.number} has an invalid type.`);
  }
  const entry = object(input, 'Answer key entry');
  const questionId = id(entry.questionId, 'Answer key question ID');
  if (entry.kind !== question.kind) throw new Error(`The answer key type for question ${question.number} does not match.`);
  const allowed = entry.kind === 'mcq' ? ['questionId', 'kind', 'acceptedOptionIndices']
    : entry.kind === 'msq' ? ['questionId', 'kind', 'correctOptionIndices']
      : ['questionId', 'kind', 'minValue', 'maxValue', 'additionalRanges'];
  if (Object.keys(entry).some(field => !allowed.includes(field))) {
    throw new Error(`The answer key for question ${question.number} contains unsupported fields.`);
  }
  if (entry.kind === 'mcq') return { questionId, kind: 'mcq', acceptedOptionIndices:
    optionIndices(entry.acceptedOptionIndices, question, 'Accepted answers') };
  if (entry.kind === 'msq') return { questionId, kind: 'msq', correctOptionIndices:
    optionIndices(entry.correctOptionIndices, question, 'Correct answers') };
  const primary = numericRange({ minValue: entry.minValue, maxValue: entry.maxValue }, question.number);
  let additionalRanges: NumericAnswerRange[] | undefined;
  if (entry.additionalRanges !== undefined) {
    if (!Array.isArray(entry.additionalRanges) || entry.additionalRanges.length > 7) {
      throw new Error(`Question ${question.number} may have at most seven additional numeric answer ranges.`);
    }
    additionalRanges = Array.from(entry.additionalRanges).map(range => numericRange(range, question.number));
    const ranges = [primary, ...additionalRanges];
    if (ranges.some((range, index) => ranges.slice(0, index).some(previous =>
      compareNumericAnswers(range.minValue, previous.minValue) === 0
      && compareNumericAnswers(range.maxValue, previous.maxValue) === 0))) {
      throw new Error(`The numeric answer ranges for question ${question.number} must be unique.`);
    }
  }
  return { questionId, kind: 'nat', ...primary, ...(additionalRanges ? { additionalRanges } : {}) };
}

function gateKeys(input: unknown, question: GateQuizQuestion[]): GateKeyEntry[] {
  if (!Array.isArray(input) || input.length !== question.length) {
    throw new Error('Provide exactly one answer-key entry for every question.');
  }
  const questions = new Map(question.map(q => [q.id, q]));
  const keyed = new Map<string, GateKeyEntry>();
  for (const item of input) {
    const entry = object(item, 'Answer key entry');
    const questionId = id(entry.questionId, 'Answer key question ID');
    const q = questions.get(questionId);
    if (!q || keyed.has(questionId)) throw new Error('The answer key contains an unknown or repeated question.');
    keyed.set(questionId, gateKeyEntry(entry, q));
  }
  return question.map(q => keyed.get(q.id)!);
}

export function answerKeyForQuestion(quiz: QuizDraft, questionId: string): GateKeyEntry {
  if (quiz.schemaVersion === 2) {
    const question = quiz.question.find(q => q.id === questionId);
    const key = quiz.key.find(entry => entry.questionId === questionId);
    if (!question || !key) throw new Error('The answer key is incomplete.');
    return gateKeyEntry(key, question);
  }
  const question = quiz.question.find(q => q.id === questionId);
  const entry = quiz.key.find(entry => entry.questionId === questionId);
  if (!question || !entry || !Number.isInteger(entry.correctOptionIndex)
    || entry.correctOptionIndex < 0 || entry.correctOptionIndex >= question.options.length) {
    throw new Error('The answer key is incomplete.');
  }
  return { questionId, kind: 'mcq', acceptedOptionIndices: [entry.correctOptionIndex] };
}

export function validateQuizDraft(input: unknown, ownerId?: string): QuizDraft {
  const data = object(input, 'Quiz');
  if (data.schemaVersion !== 1 && data.schemaVersion !== 2) throw new Error('This quiz format is not supported.');
  const version = data.schemaVersion;
  const source = object(data.source, 'PDF sources');
  const paperPath = text(source.paperPath, 'Question paper path', 300);
  const pathMatch = /^users\/([^/]+)\/quiz-imports\/([A-Za-z0-9_-]{1,80})\/paper\.pdf$/.exec(paperPath);
  if (!pathMatch || (ownerId && pathMatch[1] !== ownerId)) {
    throw new Error('The question paper does not belong to this account.');
  }
  const prefix = paperPath.slice(0, -'paper.pdf'.length);
  const answerKeyPath = source.answerKeyPath === undefined
    ? undefined : text(source.answerKeyPath, 'Answer key path', 300);
  if (answerKeyPath && answerKeyPath !== `${prefix}answer-key.pdf`) {
    throw new Error('The answer key must belong to the same PDF import.');
  }
  if (!Array.isArray(data.question) || data.question.length < 1 || data.question.length > 200) {
    throw new Error('A quiz must contain between 1 and 200 questions.');
  }
  const ids = new Set<string>();
  const numbers = new Set<string>();
  const assetPaths = new Map<string, string>();
  const question: QuizQuestion[] = data.question.map((item, index) => {
    const q = object(item, `Question ${index + 1}`);
    const qId = id(q.id, 'Question ID');
    const number = text(q.number, 'Question number', 80);
    const kind = version === 2 ? q.kind : 'mcq';
    if (kind !== 'mcq' && kind !== 'msq' && kind !== 'nat') throw new Error(`Question ${number} has an invalid type.`);
    const session = version === 2 ? text(q.session, 'Exam session', 160) : '';
    const section = version === 2 ? text(q.section, 'Exam section', 160) : '';
    const naturalKey = version === 2 ? JSON.stringify([session, section, number]) : number;
    if (ids.has(qId) || numbers.has(naturalKey)) {
      throw new Error(version === 2 ? 'Question IDs and numbers within each session and section must be unique.'
        : 'Question IDs and numbers must be unique.');
    }
    ids.add(qId);
    numbers.add(naturalKey);
    if (!Array.isArray(q.options) || (kind === 'nat' ? q.options.length !== 0
      : q.options.length < 2 || q.options.length > 8)) {
      throw new Error(kind === 'nat' ? `Numeric question ${number} must not have options.`
        : `Question ${number} needs between 2 and 8 options.`);
    }
    const problem = text(q.problem, `Question ${number}`);
    const options = q.options.map((option, i) => text(option, `Question ${number}, option ${i + 1}`));
    if (!Array.isArray(q.images) || q.images.length > 30) {
      throw new Error(`Question ${number} has invalid diagram metadata.`);
    }
    const imageIds = new Set<string>();
    const images: QuizAsset[] = q.images.map((item) => {
      const asset = object(item, 'Diagram');
      const assetId = id(asset.id, 'Diagram ID');
      const storagePath = text(asset.storagePath, 'Diagram path', 500);
      if (!storagePath.startsWith(`${prefix}assets/`) || /[\\?#]/.test(storagePath)
        || storagePath.split('/').some(part => part === '..' || part === '.' || part === '')) {
        throw new Error('A diagram must belong to the same PDF import.');
      }
      if (!Number.isInteger(asset.page) || (asset.page as number) < 1
        || (asset.page as number) > (version === 2 ? 200 : 30)) {
        throw new Error('A diagram has an invalid page number.');
      }
      if (imageIds.has(assetId) || (assetPaths.has(assetId) && assetPaths.get(assetId) !== storagePath)) {
        throw new Error('Diagram IDs must refer to one original image.');
      }
      imageIds.add(assetId);
      assetPaths.set(assetId, storagePath);
      return { id: assetId, storagePath, page: asset.page as number };
    });
    for (const content of [problem, ...options]) {
      for (const match of content.matchAll(/quiz-asset:([A-Za-z0-9_-]+)/g)) {
        if (!imageIds.has(match[1])) throw new Error(`Question ${number} contains a missing diagram reference.`);
      }
    }
    const base = { id: qId, number, problem, options, images };
    if (version === 1) return base;
    if (q.marks !== 1 && q.marks !== 2) throw new Error(`Question ${number} must be worth one or two marks.`);
    return { ...base, kind, session, section, marks: q.marks };
  });
  if (!Array.isArray(data.key) || data.key.length !== question.length) {
    throw new Error('Provide exactly one answer-key entry for every question.');
  }
  const keyed = new Map<string, number>();
  for (const item of version === 1 ? data.key : []) {
    const entry = object(item, 'Answer key entry');
    const questionId = id(entry.questionId, 'Answer key question ID');
    const q = question.find(item => item.id === questionId);
    if (!q || keyed.has(questionId)) throw new Error('The answer key contains an unknown or repeated question.');
    if (!Number.isInteger(entry.correctOptionIndex) || (entry.correctOptionIndex as number) < 0
      || (entry.correctOptionIndex as number) >= q.options.length) {
      throw new Error(`Choose a valid answer for question ${q.number}.`);
    }
    keyed.set(questionId, entry.correctOptionIndex as number);
  }
  const parsing = object(data.parsing, 'Parsing metadata');
  if (!Array.isArray(parsing.warnings) || parsing.warnings.length > 100) {
    throw new Error('Invalid extraction warnings.');
  }
  const metadata = {
    title: text(data.title, 'Quiz title', 160),
    source: { paperPath, ...(answerKeyPath ? { answerKeyPath } : {}) },
    parsing: {
      model: text(parsing.model, 'OCR model', 200),
      warnings: parsing.warnings.map(warning => text(warning, 'Extraction warning', 2000)),
    },
  };
  const draft: QuizDraft = version === 1
    ? { schemaVersion: 1, ...metadata, question,
      key: question.map(q => ({ questionId: q.id, correctOptionIndex: keyed.get(q.id)! })) }
    : { schemaVersion: 2, ...metadata, question: question as GateQuizQuestion[],
      key: gateKeys(data.key, question as GateQuizQuestion[]) };
  if (new TextEncoder().encode(JSON.stringify(draft)).length > MAX_QUIZ_BYTES) {
    throw new Error('This quiz is too large to save. Split the paper into smaller PDFs.');
  }
  return draft;
}

export interface LegacyGradeResult {
  correct: number;
  total: number;
  unanswered: number;
  results: { questionId: string; selectedOptionIndex: number | null; correctOptionIndex: number; correct: boolean }[];
}

export interface GateGradeResult {
  correct: number;
  total: number;
  unanswered: number;
  score: number;
  maxScore: number;
  results: { questionId: string; kind: QuizQuestionKind; answer: QuizAnswer; correct: boolean;
    unanswered: boolean; marksAwarded: number; acceptedOptionIndices?: number[];
    numericRange?: NumericAnswerRange; additionalNumericRanges?: NumericAnswerRange[] }[];
}

export type GradeResult = LegacyGradeResult | GateGradeResult;

export function gradeQuiz(quiz: LegacyQuizDraft, answers: QuizAnswer[]): LegacyGradeResult;
export function gradeQuiz(quiz: GateQuizDraft, answers: QuizAnswer[]): GateGradeResult;
export function gradeQuiz(quiz: QuizDraft, answers: QuizAnswer[]): GradeResult;
export function gradeQuiz(quiz: QuizDraft, answers: QuizAnswer[]): GradeResult {
  if (!Array.isArray(answers) || answers.length !== quiz.question.length) throw new Error('The attempt does not match this quiz.');
  if (quiz.schemaVersion === 1) {
    const key = new Map(quiz.key.map(entry => [entry.questionId, entry.correctOptionIndex]));
    const results = quiz.question.map((q, index) => {
      const selectedOptionIndex = answers[index];
      if (selectedOptionIndex !== null && (typeof selectedOptionIndex !== 'number'
        || !Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0 || selectedOptionIndex >= q.options.length)) {
        throw new Error(`Invalid selection for question ${q.number}.`);
      }
      const correctOptionIndex = key.get(q.id);
      if (correctOptionIndex === undefined || !Number.isInteger(correctOptionIndex)
        || correctOptionIndex < 0 || correctOptionIndex >= q.options.length) {
        throw new Error(`The answer key for question ${q.number} is incomplete.`);
      }
      return { questionId: q.id, selectedOptionIndex, correctOptionIndex,
        correct: selectedOptionIndex === correctOptionIndex };
    });
    return { correct: results.filter(result => result.correct).length, total: results.length,
      unanswered: results.filter(result => result.selectedOptionIndex === null).length, results };
  }
  const key = new Map(gateKeys(quiz.key, quiz.question).map(entry => [entry.questionId, entry]));
  let scoreThirds = 0;
  let maxScore = 0;
  const results: GateGradeResult['results'] = quiz.question.map((q, index) => {
    if (q.marks !== 1 && q.marks !== 2) throw new Error(`Question ${q.number} must be worth one or two marks.`);
    const entry = key.get(q.id)!;
    const answer = answers[index];
    let correct = false;
    let unanswered = answer === null;
    let acceptedOptionIndices: number[] | undefined;
    let numericRange: NumericAnswerRange | undefined;
    let additionalNumericRanges: NumericAnswerRange[] | undefined;
    if (entry.kind === 'mcq') {
      if (answer !== null && (typeof answer !== 'number' || !Number.isInteger(answer)
        || answer < 0 || answer >= q.options.length)) throw new Error(`Invalid selection for question ${q.number}.`);
      acceptedOptionIndices = [...entry.acceptedOptionIndices];
      correct = typeof answer === 'number' && acceptedOptionIndices.includes(answer);
    } else if (entry.kind === 'msq') {
      if (answer !== null && !Array.isArray(answer)) throw new Error(`Choose options for question ${q.number}.`);
      const selections = answer === null ? [] : answer as number[];
      unanswered = selections.length === 0;
      const valid = unanswered ? [] : optionIndices(selections, q, 'Selected answers');
      acceptedOptionIndices = [...entry.correctOptionIndices];
      correct = !unanswered && valid.length === acceptedOptionIndices.length
        && valid.every((value, i) => value === entry.correctOptionIndices[i]);
    } else {
      if (answer !== null && typeof answer !== 'string') throw new Error(`Enter a numeric answer for question ${q.number}.`);
      const numeric = answer === null ? '' : (answer as string).trim();
      unanswered = numeric === '';
      numericRange = { minValue: entry.minValue, maxValue: entry.maxValue };
      additionalNumericRanges = entry.additionalRanges?.map(range => ({ ...range }));
      correct = !unanswered && [numericRange, ...(additionalNumericRanges ?? [])].some(range =>
        compareNumericAnswers(numeric, range.minValue) >= 0 && compareNumericAnswers(numeric, range.maxValue) <= 0);
    }
    const awardedThirds = correct ? q.marks * 3 : entry.kind === 'mcq' && !unanswered ? -q.marks : 0;
    scoreThirds += awardedThirds;
    maxScore += q.marks;
    return { questionId: q.id, kind: entry.kind, answer: Array.isArray(answer) ? [...answer] : answer,
      correct, unanswered, marksAwarded: awardedThirds / 3,
      ...(acceptedOptionIndices ? { acceptedOptionIndices } : {}), ...(numericRange ? { numericRange } : {}),
      ...(additionalNumericRanges?.length ? { additionalNumericRanges } : {}) };
  });
  return { correct: results.filter(result => result.correct).length, total: results.length,
    unanswered: results.filter(result => result.unanswered).length,
    score: scoreThirds / 3, maxScore, results };
}

export function validateQuizAttempt(input: unknown, quiz: QuizDraft, quizId: string): QuizAttempt {
  const data = object(input, 'Saved attempt');
  if (data.quizId !== quizId || !Array.isArray(data.answers)) {
    throw new Error('A saved attempt does not match this quiz.');
  }
  const answers = data.answers as QuizAnswer[];
  const grade = gradeQuiz(quiz, answers);
  if (data.correct !== grade.correct || data.total !== grade.total) {
    throw new Error('A saved attempt has an inconsistent score.');
  }
  if ('score' in grade && (data.score !== grade.score || data.maxScore !== grade.maxScore)) {
    throw new Error('A saved attempt has inconsistent marks.');
  }
  if (!Number.isInteger(data.submittedAt) || (data.submittedAt as number) < 0
    || (data.submittedAt as number) > 8_640_000_000_000_000) {
    throw new Error('A saved attempt has an invalid submission date.');
  }
  return { id: id(data.id, 'Attempt ID'), quizId,
    answers: answers.map(answer => Array.isArray(answer) ? [...answer] : answer), correct: grade.correct,
    total: grade.total, submittedAt: data.submittedAt as number,
    ...('score' in grade ? { score: grade.score, maxScore: grade.maxScore } : {}) };
}
