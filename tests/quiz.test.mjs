import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/domain/quiz.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm' });
const { validateQuizDraft, gradeQuiz, validateQuizAttempt } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function draft() {
  return {
    schemaVersion: 1, title: 'Math paper',
    question: [
      { id: 'q1', number: '1', problem: 'Solve $x^2 = 4$.', options: ['$2$', '$4$'], images: [] },
      { id: 'q2', number: '2', problem: 'Identify the figure. ![figure](quiz-asset:fig1)',
        options: ['Circle', 'Square'], images: [{ id: 'fig1',
          storagePath: 'users/alice/quiz-imports/import-1/assets/lease/fig1.png', page: 1 }] },
    ],
    key: [{ questionId: 'q2', correctOptionIndex: 1 }, { questionId: 'q1', correctOptionIndex: 0 }],
    source: { paperPath: 'users/alice/quiz-imports/import-1/paper.pdf',
      answerKeyPath: 'users/alice/quiz-imports/import-1/answer-key.pdf' },
    parsing: { model: 'PaddleOCR-VL', warnings: [] },
  };
}

test('validated JSON preserves math and original diagram references; maps key by question ID', () => {
  const valid = validateQuizDraft(draft(), 'alice');
  assert.equal(valid.question[0].problem, 'Solve $x^2 = 4$.');
  assert.equal(valid.question[1].images[0].storagePath,
    'users/alice/quiz-imports/import-1/assets/lease/fig1.png');
  assert.deepEqual(valid.key.map(k => k.questionId), ['q1', 'q2']);
  assert.equal(gradeQuiz(valid, [0, 1]).correct, 2);
});

test('grading identifies correct, wrong and unanswered selections without revealing synthetic answers', () => {
  const valid = validateQuizDraft(draft());
  const score = gradeQuiz(valid, [1, null]);
  assert.equal(score.correct, 0);
  assert.equal(score.total, 2);
  assert.equal(score.unanswered, 1);
  assert.deepEqual(score.results[1], { questionId: 'q2', selectedOptionIndex: null,
    correctOptionIndex: 1, correct: false });
  assert.equal(gradeQuiz(valid, [0, null]).correct, 1);
});

test('answer key must cover every question with a unique in-range integer selection', () => {
  for (const key of [[], [{ questionId: 'q1', correctOptionIndex: 0 }],
    [{ questionId: 'q1', correctOptionIndex: 0 }, { questionId: 'q1', correctOptionIndex: 0 }],
    [{ questionId: 'q1', correctOptionIndex: 0 }, { questionId: 'unknown', correctOptionIndex: 1 }],
    [{ questionId: 'q1', correctOptionIndex: 0 }, { questionId: 'q2', correctOptionIndex: 2 }],
    [{ questionId: 'q1', correctOptionIndex: 0 }, { questionId: 'q2', correctOptionIndex: 0.5 }],
  ]) {
    assert.throws(() => validateQuizDraft({ ...draft(), key }));
  }
});

test('malformed attempts and incomplete keys fail instead of producing misleading scores', () => {
  const valid = validateQuizDraft(draft());
  for (const answers of [[0], [0, 2], [0, -1], [0, 0.5], [undefined, 1], [0, '1']]) {
    assert.throws(() => gradeQuiz(valid, answers));
  }
  assert.throws(() => gradeQuiz({ ...valid, key: [] }, [0, 1]));
});

test('source files and diagram paths stay inside the owner and import', () => {
  assert.throws(() => validateQuizDraft(draft(), 'bob'));
  const value = draft();
  value.source.answerKeyPath = 'users/alice/quiz-imports/other/answer-key.pdf';
  assert.throws(() => validateQuizDraft(value, 'alice'));
  for (const storagePath of ['https://example.com/diagram.png',
    'users/bob/quiz-imports/import-1/assets/fig1.png',
    'users/alice/quiz-imports/import-1/assets/../paper.pdf',
    'users/alice/quiz-imports/import-1/assets/fig1.png?token=secret',
    'users/alice/quiz-imports/other/assets/fig1.png',
  ]) {
    const value = draft();
    value.question[1].images[0].storagePath = storagePath;
    assert.throws(() => validateQuizDraft(value, 'alice'));
  }
});

test('missing diagram references and conflicting IDs cannot be saved silently', () => {
  const missing = draft();
  missing.question[1].images = [];
  assert.throws(() => validateQuizDraft(missing));
  const conflict = draft();
  conflict.question[0].images = [{ ...conflict.question[1].images[0],
    storagePath: 'users/alice/quiz-imports/import-1/assets/different.png' }];
  assert.throws(() => validateQuizDraft(conflict));
});

test('empty content, duplicate IDs/numbers, unsupported versions and option counts are rejected', () => {
  for (const mutate of [
    v => { v.schemaVersion = 2; }, v => { v.title = ' '; },
    v => { v.question[0].problem = ''; }, v => { v.question[0].options = ['Only']; },
    v => { v.question[0].options = Array(9).fill('Too many'); },
    v => { v.question[1].id = v.question[0].id; },
    v => { v.question[1].number = v.question[0].number; },
    v => { v.question[1].images[0].page = 31; },
  ]) {
    const value = draft(); mutate(value);
    assert.throws(() => validateQuizDraft(value));
  }
});

test('large quiz JSON fails with a split-paper message before Firestore document limits', () => {
  const value = draft();
  value.question = Array.from({ length: 80 }, (_, i) => ({ id: `q${i}`, number: `${i + 1}`,
    problem: 'x'.repeat(12_000), options: ['A', 'B'], images: [] }));
  value.key = value.question.map(q => ({ questionId: q.id, correctOptionIndex: 0 }));
  assert.throws(() => validateQuizDraft(value), /too large/);
});

test('persisted history validates answers, key-derived scores, IDs and dates before rendering', () => {
  const quiz = validateQuizDraft(draft());
  const attempt = { id: 'attempt-1', quizId: 'import-1', answers: [0, null],
    correct: 1, total: 2, submittedAt: 123456789 };
  assert.deepEqual(validateQuizAttempt(attempt, quiz, 'import-1'), attempt);
  for (const fields of [
    { answers: [99, null] }, { answers: [{ value: 0 }, null] }, { answers: [0] },
    { correct: 2 }, { total: 3 }, { quizId: 'other' }, { id: '../other' },
    { submittedAt: 'yesterday' }, { submittedAt: -1 }, { submittedAt: Infinity },
  ]) {
    assert.throws(() => validateQuizAttempt({ ...attempt, ...fields }, quiz, 'import-1'));
  }
});
