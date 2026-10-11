import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/domain/quiz.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm' });
const { validateQuizDraft, gradeQuiz, validateQuizAttempt, compareNumericAnswers,
  questionKind, answerKeyForQuestion } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function draft() {
  const question = (id, kind, marks, number, session = 'CS-1', section = 'CS') => ({
    id, kind, marks, number, session, section, problem: `Question ${id}: $x^2$.`,
    options: kind === 'nat' ? [] : ['First', 'Second', 'Third', 'Fourth'], images: [],
  });
  return {
    schemaVersion: 2, title: 'GATE CS', question: [
      question('q1', 'mcq', 1, '1'), question('q2', 'msq', 2, '2'),
      question('q3', 'nat', 2, '3'), question('q4', 'mcq', 2, '1', 'CS-2'),
    ], key: [
      { questionId: 'q3', kind: 'nat', minValue: '0.1', maxValue: '0.3' },
      { questionId: 'q1', kind: 'mcq', acceptedOptionIndices: [3, 2] },
      { questionId: 'q4', kind: 'mcq', acceptedOptionIndices: [1] },
      { questionId: 'q2', kind: 'msq', correctOptionIndices: [2, 0] },
    ], source: { paperPath: 'users/alice/quiz-imports/gate-2021/paper.pdf',
      answerKeyPath: 'users/alice/quiz-imports/gate-2021/answer-key.pdf' },
    parsing: { model: 'Gemini Flash', warnings: [] },
  };
}

test('schema 2 preserves question types, session numbering, marks and normalized answer keys', () => {
  const quiz = validateQuizDraft(draft(), 'alice');
  assert.equal(quiz.schemaVersion, 2);
  assert.deepEqual(quiz.question.map(q => q.kind), ['mcq', 'msq', 'nat', 'mcq']);
  assert.deepEqual(quiz.key.map(k => k.questionId), ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(quiz.key[0].acceptedOptionIndices, [2, 3]);
  assert.deepEqual(quiz.key[1].correctOptionIndices, [0, 2]);
  assert.deepEqual(answerKeyForQuestion(quiz, 'q3'),
    { questionId: 'q3', kind: 'nat', minValue: '0.1', maxValue: '0.3' });
  assert.deepEqual(quiz.question[2].options, []);
  assert.equal(questionKind(quiz.question[2]), 'nat');
});

test('MCQ alternate answers are alternatives, MSQ exact sets ignore order, NAT bounds are inclusive', () => {
  const quiz = validateQuizDraft(draft());
  for (const answer of [2, 3]) {
    for (const number of ['0.1', '0.3', '.2', '2e-1', '+0.20']) {
      const grade = gradeQuiz(quiz, [answer, [2, 0], number, 1]);
      assert.equal(grade.correct, 4);
      assert.equal(grade.score, 7);
      assert.equal(grade.maxScore, 7);
      assert.equal(grade.unanswered, 0);
      assert.deepEqual(grade.results[0].acceptedOptionIndices, [2, 3]);
      assert.deepEqual(grade.results[2].numericRange, { minValue: '0.1', maxValue: '0.3' });
    }
  }
});

test('MCQ wrong answers deduct one third while partial MSQ and wrong NAT award zero', () => {
  const quiz = validateQuizDraft(draft());
  const grade = gradeQuiz(quiz, [0, [0], '0.4', 0]);
  assert.equal(grade.score, -1);
  assert.deepEqual(grade.results.map(result => result.marksAwarded), [-1 / 3, 0, 0, -2 / 3]);
  assert.equal(grade.correct, 0);
  for (const selections of [[0], [2], [0, 1, 2], [1, 3]]) {
    assert.equal(gradeQuiz(quiz, [null, selections, null, null]).score, 0);
  }
});

test('blank answers never incur penalties, including an empty MSQ and empty numeric field', () => {
  const quiz = validateQuizDraft(draft());
  for (const answers of [[null, null, null, null], [null, [], '  ', null]]) {
    const grade = gradeQuiz(quiz, answers);
    assert.equal(grade.score, 0);
    assert.equal(grade.unanswered, 4);
    assert.equal(grade.correct, 0);
    assert.ok(grade.results.every(result => result.unanswered));
  }
});

test('exact decimal comparison avoids binary rounding and handles negative/scientific bounds', () => {
  const cases = [
    ['0.3000000000000000001', '0.3', 1], ['0.09999999999999999999', '0.1', -1],
    ['1.234567890123456789', '1.234567890123456788', 1],
    ['100000000000000000001', '100000000000000000000', 1],
    ['-2', '-1', -1], ['-0', '+0.000e-999', 0],
    ['2.50e-3', '0.0025', 0], ['1e1000', '10e999', 0],
  ];
  for (const [left, right, expected] of cases) assert.equal(compareNumericAnswers(left, right), expected);
  const quiz = validateQuizDraft(draft());
  for (const answer of ['0.3000000000000000001', '0.09999999999999999999']) {
    assert.equal(gradeQuiz(quiz, [null, null, answer, null]).correct, 0);
  }
  const value = draft();
  Object.assign(value.key[0], { minValue: '-2e-1', maxValue: '-.1' });
  assert.equal(gradeQuiz(validateQuizDraft(value), [null, null, '-0.15', null]).correct, 1);
});

test('NAT alternative ranges accept every inclusive interval and reject the gaps between them', () => {
  const value = draft();
  Object.assign(value.key[0], { minValue: '819', maxValue: '820',
    additionalRanges: [{ minValue: '205', maxValue: '205' }] });
  const quiz = validateQuizDraft(value);
  assert.deepEqual(answerKeyForQuestion(quiz, 'q3'), { questionId: 'q3', kind: 'nat',
    minValue: '819', maxValue: '820', additionalRanges: [{ minValue: '205', maxValue: '205' }] });
  for (const answer of ['819', '819.5', '820', '205', '2.05e2']) {
    const grade = gradeQuiz(quiz, [null, null, answer, null]);
    assert.equal(grade.correct, 1);
    assert.equal(grade.score, 2);
    assert.deepEqual(grade.results[2].numericRange, { minValue: '819', maxValue: '820' });
    assert.deepEqual(grade.results[2].additionalNumericRanges, [{ minValue: '205', maxValue: '205' }]);
  }
  for (const answer of ['204.9999999999999999999', '205.0000000000000000001',
    '818.9999999999999999999', '820.0000000000000000001', '300']) {
    assert.equal(gradeQuiz(quiz, [null, null, answer, null]).correct, 0);
  }
  const grade = gradeQuiz(quiz, [null, null, '205', null]);
  grade.results[2].additionalNumericRanges[0].minValue = '999';
  assert.equal(quiz.key[2].additionalRanges[0].minValue, '205');
});

test('NAT keys allow seven additional exact decimal ranges and reject duplicates or malformed intervals', () => {
  const valid = draft();
  valid.key[0].additionalRanges = Array.from({ length: 7 }, (_, index) => ({
    minValue: `${index + 1}`, maxValue: `${index + 1}.5`,
  }));
  const quiz = validateQuizDraft(valid);
  for (const answer of ['1', '1.5', '7', '7.5']) {
    assert.equal(gradeQuiz(quiz, [null, null, answer, null]).correct, 1);
  }
  for (const additionalRanges of [
    null, {}, Array(1), [...valid.key[0].additionalRanges, { minValue: '8', maxValue: '8' }],
    [{ minValue: '0.10', maxValue: '3e-1' }],
    [{ minValue: '205', maxValue: '205' }, { minValue: '2.05e2', maxValue: '205.0' }],
    [{ minValue: '2', maxValue: '1' }], [{ minValue: 'NaN', maxValue: '1' }],
    [{ minValue: '1', maxValue: 'Infinity' }], [{ minValue: '1e1001', maxValue: '1e1001' }],
    [{ minValue: 1, maxValue: '2' }], [{ minValue: '1' }],
    [{ minValue: '1', maxValue: '2', answer: 'A' }],
  ]) {
    const invalid = draft(); invalid.key[0].additionalRanges = additionalRanges;
    assert.throws(() => validateQuizDraft(invalid));
  }
  const wrongKind = draft(); wrongKind.key[1].additionalRanges = [];
  assert.throws(() => validateQuizDraft(wrongKind));
  const empty = draft(); empty.key[0].additionalRanges = [];
  assert.doesNotThrow(() => validateQuizDraft(empty));
  assert.equal('additionalNumericRanges' in gradeQuiz(validateQuizDraft(empty), [null, null, null, null]).results[2], false);
});

test('saved GATE attempts regrade numeric alternative ranges and reject forged alternative scores', () => {
  const value = draft();
  Object.assign(value.key[0], { minValue: '819', maxValue: '820',
    additionalRanges: [{ minValue: '205', maxValue: '205' }] });
  const quiz = validateQuizDraft(value);
  const answers = [null, null, '205', null];
  const grade = gradeQuiz(quiz, answers);
  const attempt = { id: 'nat-alternative', quizId: 'gate-2021', answers,
    correct: 1, total: 4, submittedAt: 123456789, score: 2, maxScore: 7 };
  assert.equal(grade.score, 2);
  assert.deepEqual(validateQuizAttempt(attempt, quiz, 'gate-2021'), attempt);
  assert.throws(() => validateQuizAttempt({ ...attempt, score: 0 }, quiz, 'gate-2021'));
  assert.throws(() => validateQuizAttempt({ ...attempt, answers: [null, null, '300', null] }, quiz, 'gate-2021'));
});

test('non-decimal numeric values and unbounded exponents are rejected', () => {
  const quiz = validateQuizDraft(draft());
  for (const answer of ['NaN', 'Infinity', '-Infinity', '0x10', '1/2', '1,000',
    '1.2junk', '.', '1e', '1e1001', '1e-1001', '9'.repeat(201)]) {
    assert.throws(() => gradeQuiz(quiz, [null, null, answer, null]));
  }
  for (const answer of [NaN, Infinity, 0.2, {}, []]) {
    assert.throws(() => gradeQuiz(quiz, [null, null, answer, null]));
  }
});

test('question selections require the correct type, unique indices and valid option bounds', () => {
  const quiz = validateQuizDraft(draft());
  for (const answers of [
    [[2, 3], [0, 2], '0.2', 1], ['2', [0, 2], '0.2', 1],
    [2, 0, '0.2', 1], [2, [0, 0, 2], '0.2', 1],
    [2, [0, 4], '0.2', 1], [2, [-1, 2], '0.2', 1],
    [2, [0, 1.5], '0.2', 1], [2, ['0', 2], '0.2', 1],
    [2, [0, 2], 0.2, 1], [2, [0, 2], '0.2', 4],
    [undefined, [], '', null], [null],
  ]) assert.throws(() => gradeQuiz(quiz, answers));
  assert.throws(() => gradeQuiz(quiz, [null, Array(1), null, null]));
});

test('question numbering must be unique within the same session and section', () => {
  const valid = draft();
  valid.question[3].session = 'CS-1';
  valid.question[3].section = 'GA';
  assert.doesNotThrow(() => validateQuizDraft(valid));
  valid.question[3].section = 'CS';
  assert.throws(() => validateQuizDraft(valid), /unique/);
  valid.question[3].session = 'CS-2';
  valid.question[3].id = 'q1';
  assert.throws(() => validateQuizDraft(valid), /unique/);
});

test('GATE keys must match question kinds and cannot be empty, duplicated, unknown or mixed', () => {
  for (const mutate of [
    value => { value.key = []; },
    value => { value.key[1].acceptedOptionIndices = []; },
    value => { value.key[1].acceptedOptionIndices = [2, 2]; },
    value => { value.key[1].acceptedOptionIndices = [4]; },
    value => { value.key[1].acceptedOptionIndices = ['2']; },
    value => { value.key[3].correctOptionIndices = []; },
    value => { value.key[3].correctOptionIndices = [0, 0]; },
    value => { value.key[3].kind = 'mcq'; },
    value => { value.key[1].correctOptionIndex = 2; },
    value => { value.key[2].questionId = 'unknown'; },
    value => { value.key[2].questionId = 'q1'; },
    value => { value.key[0].minValue = '0.4'; },
    value => { value.key[0].maxValue = 'NaN'; },
    value => { value.key[0].minValue = 0.1; },
  ]) {
    const value = draft(); mutate(value);
    assert.throws(() => validateQuizDraft(value));
  }
  const quiz = validateQuizDraft(draft());
  assert.throws(() => gradeQuiz({ ...quiz, key: quiz.key.slice(1) }, [null, null, null, null]));
});

test('GATE questions require metadata, valid marks and type-specific options', () => {
  for (const mutate of [
    value => { value.question[0].kind = 'essay'; },
    value => { value.question[0].session = ''; },
    value => { delete value.question[0].section; },
    value => { value.question[0].marks = 3; },
    value => { value.question[0].marks = '1'; },
    value => { value.question[2].options = ['None']; },
    value => { value.question[0].options = []; },
    value => { value.question[0].id = 'x'.repeat(81); },
  ]) {
    const value = draft(); mutate(value);
    assert.throws(() => validateQuizDraft(value));
  }
});

test('schema 2 diagrams can reference pages up to 200 while owner and import paths remain strict', () => {
  const value = draft();
  value.question[2].problem = 'Read ![figure](quiz-asset:fig200).';
  value.question[2].images = [{ id: 'fig200', page: 200,
    storagePath: 'users/alice/quiz-imports/gate-2021/assets/lease/fig200.png' }];
  assert.doesNotThrow(() => validateQuizDraft(value, 'alice'));
  assert.throws(() => validateQuizDraft(value, 'bob'));
  for (const page of [0, 201, 1.5]) {
    const invalid = structuredClone(value); invalid.question[2].images[0].page = page;
    assert.throws(() => validateQuizDraft(invalid));
  }
  const foreign = structuredClone(value);
  foreign.question[2].images[0].storagePath = 'users/alice/quiz-imports/other/assets/fig200.png';
  assert.throws(() => validateQuizDraft(foreign));
});

test('GATE history regrades typed answers and rejects forged marks or malformed records', () => {
  const quiz = validateQuizDraft(draft());
  const answers = [2, [2, 0], '0.2', 0];
  const grade = gradeQuiz(quiz, answers);
  const attempt = { id: 'attempt-gate', quizId: 'gate-2021', answers,
    correct: grade.correct, total: grade.total, submittedAt: 123456789,
    score: grade.score, maxScore: grade.maxScore };
  const result = validateQuizAttempt(attempt, quiz, 'gate-2021');
  assert.deepEqual(result, attempt);
  result.answers[1].push(3);
  assert.deepEqual(attempt.answers[1], [2, 0]);
  for (const fields of [
    { score: 7 }, { score: NaN }, { score: undefined }, { maxScore: 8 }, { maxScore: undefined },
    { correct: 4 }, { total: 5 }, { quizId: 'other' }, { submittedAt: Infinity },
    { answers: [2, [0, 0], '0.2', 0] }, { answers: [2, [0, 2], 'NaN', 0] },
  ]) assert.throws(() => validateQuizAttempt({ ...attempt, ...fields }, quiz, 'gate-2021'));
});

test('legacy quizzes retain their exact result and attempt shapes and reject new answer types', () => {
  const quiz = validateQuizDraft({ schemaVersion: 1, title: 'Legacy',
    question: [{ id: 'q1', number: '1', problem: 'Choose A.', options: ['A', 'B'], images: [] }],
    key: [{ questionId: 'q1', correctOptionIndex: 0 }], source: draft().source, parsing: draft().parsing });
  assert.deepEqual(gradeQuiz(quiz, [0]), { correct: 1, total: 1, unanswered: 0,
    results: [{ questionId: 'q1', selectedOptionIndex: 0, correctOptionIndex: 0, correct: true }] });
  assert.equal(questionKind(quiz.question[0]), 'mcq');
  assert.deepEqual(answerKeyForQuestion(quiz, 'q1'), { questionId: 'q1', kind: 'mcq', acceptedOptionIndices: [0] });
  for (const answer of [[0], '0', ' ', []]) assert.throws(() => gradeQuiz(quiz, [answer]));
  const attempt = { id: 'legacy-1', quizId: 'gate-2021', answers: [0], correct: 1,
    total: 1, submittedAt: 1 };
  assert.deepEqual(validateQuizAttempt(attempt, quiz, 'gate-2021'), attempt);
});

test('question count and Firestore size limits apply to the complete GATE quiz', () => {
  const value = draft();
  value.question = Array.from({ length: 200 }, (_, index) => ({ ...value.question[0],
    id: `q${index}`, number: `${index + 1}` }));
  value.key = value.question.map(q => ({ questionId: q.id, kind: 'mcq', acceptedOptionIndices: [0] }));
  assert.doesNotThrow(() => validateQuizDraft(value));
  value.question.push({ ...value.question[0], id: 'q201', number: '201' });
  value.key.push({ questionId: 'q201', kind: 'mcq', acceptedOptionIndices: [0] });
  assert.throws(() => validateQuizDraft(value), /200/);
  value.question.pop(); value.key.pop();
  value.question.forEach(q => { q.problem = 'x'.repeat(10_000); });
  assert.throws(() => validateQuizDraft(value), /too large/);
});
