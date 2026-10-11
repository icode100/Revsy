import { useEffect, useRef, useState } from 'react';
import QuizContent, { QuizDiagrams } from '../../components/QuizContent';
import { gradeQuiz, questionKind, validateQuizAttempt } from '../../domain/quiz';
import { getQuizAttempts, saveQuizAttempt } from '../../services/quiz';
import type { QuizAnswer, QuizAttempt, QuizDocument } from '../../types/quiz';
import { ErrorNotice, SourceFiles } from './controls';
import { errorMessage, formatMarks, hasAnswer, inputStyle, primaryButton, questionLabel, secondaryButton, useAlive } from './helpers';

export default function QuizPlayer({ quiz, userId, onClose }: { quiz: QuizDocument; userId: string; onClose: () => void }) {
  const [answers, setAnswers] = useState<QuizAnswer[]>(() => quiz.question.map(() => null));
  const [current, setCurrent] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const alive = useAlive();
  const saveLock = useRef(false);
  const attemptId = useRef(crypto.randomUUID());
  const question = quiz.question[current];
  const result = submitted ? gradeQuiz(quiz, answers) : null;
  const gateResult = result && 'score' in result ? result : null;
  const selectedResult = result?.results[current];
  const selectedGateResult = gateResult?.results[current];
  const answered = answers.filter(hasAnswer).length;

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    setHistoryError(null);
    getQuizAttempts(userId, quiz.id).then(data => {
      if (active) setAttempts(previous => [...data, ...previous.filter(item => !data.some(stored => stored.id === item.id))].sort((a, b) => b.submittedAt - a.submittedAt));
    }).catch(err => { if (active) setHistoryError(errorMessage(err)); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [userId, quiz.id, historyRefresh]);

  const setAnswer = (answer: QuizAnswer) => {
    setAnswers(previous => previous.map((value, index) => index === current ? answer : value));
    setError(null);
  };
  const persistAttempt = async () => {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const attempt = await saveQuizAttempt(userId, quiz, answers, attemptId.current);
      if (alive.current) {
        setSaved(true);
        setAttempts(previous => [attempt, ...previous.filter(item => item.id !== attempt.id)]);
      }
    } catch (err) {
      if (alive.current) setError(`Your answers have been graded, but the attempt could not be saved. ${errorMessage(err)}`);
    } finally {
      saveLock.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const submit = () => {
    if (saveLock.current) return;
    try {
      // Reject incomplete numeric input before entering the graded view.
      gradeQuiz(quiz, answers);
      setSubmitted(true);
      void persistAttempt();
    } catch (err) { setError(errorMessage(err)); }
  };
  const retry = () => {
    attemptId.current = crypto.randomUUID();
    setAnswers(quiz.question.map(() => null));
    setCurrent(0);
    setSubmitted(false);
    setSaved(false);
    setError(null);
  };
  const viewAttempt = (attempt: QuizAttempt) => {
    try {
      const validated = validateQuizAttempt(attempt, quiz, quiz.id);
      setAnswers(structuredClone(validated.answers));
      setCurrent(0);
      setSubmitted(true);
      setSaved(true);
      setError(null);
    } catch (err) { setHistoryError(errorMessage(err)); }
  };

  if (!question) return <ErrorNotice message="This quiz has no questions available." />;
  const kind = questionKind(question);
  const currentAnswer = answers[current];
  const acceptedChoices = selectedGateResult?.acceptedOptionIndices
    ?? (selectedResult && 'correctOptionIndex' in selectedResult ? [selectedResult.correctOptionIndex] : []);

  return <section className="glass-panel rounded-3xl p-5 sm:p-8" aria-labelledby="attempt-heading">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="attempt-heading" className="text-2xl font-black">{quiz.title}</h2><p className="mt-2 text-sm text-gray-500">{submitted ? 'Review your answers against the supplied answer key.' : `${answered} of ${quiz.question.length} answered. Answers are saved when you submit.`}</p></div>
      <button className={secondaryButton} type="button" onClick={onClose} disabled={saving}>Back to quizzes</button>
    </div>
    {quiz.schemaVersion === 2 && !submitted && <p className="mb-5 text-sm leading-6 text-gray-600 dark:text-neutral-400">MCQ: choose one; a wrong answer loses one-third of its marks. MSQ: choose all correct options; no partial or negative marks. NAT: enter a number within any range accepted by the supplied key; no negative marks.</p>}
    {submitted && <SourceFiles source={quiz.source} />}
    {result && <div className="mt-6 rounded-2xl border border-purple-200 bg-purple-50 p-5 dark:border-purple-800/40 dark:bg-purple-950/25" role="status">
      <p className="text-3xl font-black text-purple-700 dark:text-purple-300">{gateResult ? `${formatMarks(gateResult.score)} / ${formatMarks(gateResult.maxScore)} marks` : `${result.correct} / ${result.total}`}</p>
      <p className="mt-2 text-sm">{gateResult ? `${result.correct} of ${result.total} correct · ` : ''}{result.unanswered} unanswered · {Math.round(result.correct / result.total * 100)}% correct</p>
      <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">{saving ? 'Saving attempt…' : saved ? 'Attempt saved in your history.' : 'Attempt has not been saved yet.'}</p>
    </div>}
    <div className="my-6 flex flex-wrap gap-2" aria-label="Question navigation">{quiz.question.map((item, index) => {
      const answeredQuestion = hasAnswer(answers[index]);
      const state = submitted ? result?.results[index].correct ? 'correct' : answeredQuestion ? 'incorrect' : 'unanswered' : answeredQuestion ? 'answered' : 'unanswered';
      return <button type="button" key={item.id} aria-label={`${questionLabel(item)}, ${state}`} title={questionLabel(item)} aria-current={current === index ? 'step' : undefined}
        className={`min-h-10 min-w-10 rounded-lg border px-2 py-2 text-sm font-bold ${current === index ? 'ring-2 ring-purple-500 ring-offset-2 dark:ring-offset-black' : ''} ${submitted ? result?.results[index].correct ? 'border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200' : answeredQuestion ? 'border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200' : 'border-gray-200 bg-white/60 dark:border-white/15 dark:bg-neutral-900'}`}
        onClick={() => setCurrent(index)}>{'kind' in item ? <><span className="block text-[10px] font-normal">{item.session} · {item.section}</span><span>{item.number}</span></> : item.number}</button>;
    })}</div>
    <article className="rounded-2xl border border-gray-200 p-4 sm:p-6 dark:border-white/10">
      <h3 className="mb-2 font-black">{questionLabel(question)} <span className="ml-2 text-sm font-normal text-gray-500">{current + 1} of {quiz.question.length}</span></h3>
      {'kind' in question && <p className="mb-5 text-sm text-gray-500">{kind.toUpperCase()} · {question.marks} {question.marks === 1 ? 'mark' : 'marks'} · {kind === 'mcq' ? 'Choose one answer' : kind === 'msq' ? 'Choose all correct answers' : 'Enter a numerical answer'}</p>}
      <QuizContent content={question.problem} assets={question.images} />
      <QuizDiagrams questionId={question.id} assets={question.images} content={[question.problem, ...question.options].join('\n')} />
      {kind === 'nat' ? <div className="mt-6 space-y-3">
        <label className="block max-w-sm text-sm font-semibold">Your numerical answer<input type="text" inputMode="decimal" className={`${inputStyle} mt-2`} value={typeof currentAnswer === 'string' ? currentAnswer : ''} placeholder="Enter a number" maxLength={100} disabled={submitted} onChange={event => setAnswer(event.target.value.trim() ? event.target.value : null)} /></label>
        {submitted && selectedGateResult?.numericRange && <p className="text-sm font-semibold text-green-700 dark:text-green-300">{selectedGateResult.additionalNumericRanges?.length ? 'Accepted ranges: ' : 'Accepted range: '}{[selectedGateResult.numericRange, ...(selectedGateResult.additionalNumericRanges ?? [])].map(range => `${range.minValue} to ${range.maxValue}`).join(' OR ')}, inclusive.</p>}
      </div> : <fieldset className="mt-6 space-y-3"><legend className="sr-only">{kind === 'msq' ? 'Choose all correct answers' : 'Choose one answer'} for {questionLabel(question)}</legend>{question.options.map((option, index) => {
        const isSelected = Array.isArray(currentAnswer) ? currentAnswer.includes(index) : currentAnswer === index;
        const isCorrect = submitted && acceptedChoices.includes(index);
        const isWrong = submitted && isSelected && !isCorrect;
        return <label key={index} className={`flex items-start gap-3 rounded-xl border p-4 ${isCorrect ? 'border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-950/25' : isWrong ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/25' : isSelected ? 'border-purple-400 bg-purple-50 dark:border-purple-700 dark:bg-purple-950/25' : 'border-gray-200 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-neutral-900'} ${submitted ? 'cursor-default' : 'cursor-pointer'}`}>
          <input className="mt-1 h-4 w-4 shrink-0 accent-purple-600" type={kind === 'msq' ? 'checkbox' : 'radio'} name={`quiz-answer-${question.id}`} checked={isSelected} disabled={submitted} onChange={() => {
            if (kind !== 'msq') { setAnswer(index); return; }
            const previous = Array.isArray(currentAnswer) ? currentAnswer : [];
            const next = previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index].sort((a, b) => a - b);
            setAnswer(next.length ? next : null);
          }} />
          <div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap gap-2 text-xs font-bold"><span>Option {String.fromCharCode(65 + index)}</span>{isCorrect && <span className="text-green-700 dark:text-green-300">{kind === 'msq' ? 'Correct choice' : quiz.schemaVersion === 2 ? 'Accepted answer' : 'Correct answer'}</span>}{isSelected && <span className={isWrong ? 'text-red-700 dark:text-red-300' : 'text-purple-700 dark:text-purple-300'}>Your answer</span>}</div><QuizContent content={option} assets={question.images} /></div>
        </label>;
      })}</fieldset>}
      {submitted && !hasAnswer(currentAnswer) && <p className="mt-4 text-sm font-semibold text-amber-700 dark:text-amber-300">You left this question unanswered.</p>}
      {submitted && selectedGateResult && <p className={`mt-4 text-sm font-semibold ${selectedGateResult.correct ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{selectedGateResult.unanswered ? 'Unanswered' : selectedGateResult.correct ? 'Correct' : 'Incorrect'} · {formatMarks(selectedGateResult.marksAwarded)} {selectedGateResult.marksAwarded === 1 ? 'mark' : 'marks'}{kind === 'msq' && !selectedGateResult.correct && !selectedGateResult.unanswered ? ' · All correct choices are required.' : ''}</p>}
      {!submitted && hasAnswer(currentAnswer) && <button type="button" className={`${secondaryButton} mt-4`} onClick={() => setAnswer(null)}>Clear answer</button>}
    </article>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2"><button type="button" className={secondaryButton} onClick={() => setCurrent(index => index - 1)} disabled={current === 0}>Previous</button><button type="button" className={secondaryButton} onClick={() => setCurrent(index => index + 1)} disabled={current === quiz.question.length - 1}>Next</button></div>
      {submitted ? <button type="button" className={primaryButton} onClick={retry} disabled={saving}>Try again</button> : <button type="button" className={primaryButton} onClick={submit} disabled={saving}>Submit {answered < quiz.question.length ? `(${quiz.question.length - answered} unanswered)` : 'quiz'}</button>}
    </div>
    <div className="mt-4 space-y-3"><ErrorNotice message={error} />{submitted && !saved && !saving && error && <button type="button" className={secondaryButton} onClick={() => void persistAttempt()}>Retry saving attempt</button>}</div>
    <div className="mt-8 border-t border-gray-200 pt-6 dark:border-white/10">
      <h3 className="font-black">Attempt history</h3>
      {historyLoading && <p className="mt-3 text-sm text-gray-500" role="status">Loading your attempts…</p>}
      <div className="mt-3"><ErrorNotice message={historyError} />{historyError && <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setHistoryRefresh(value => value + 1)}>Reload history</button>}</div>
      {!historyLoading && !historyError && attempts.length === 0 && <p className="mt-3 text-sm text-gray-500">Your submitted attempts will appear here.</p>}
      <div className="mt-3 flex flex-wrap gap-3">{attempts.map(attempt => <button type="button" key={attempt.id} disabled={saving || !submitted && answered > 0} onClick={() => viewAttempt(attempt)} className={`${secondaryButton} text-left`}>
        <span className="block font-bold">{typeof attempt.score === 'number' && typeof attempt.maxScore === 'number' ? `${formatMarks(attempt.score)} / ${formatMarks(attempt.maxScore)} marks` : `${attempt.correct} / ${attempt.total} correct`}</span>
        {quiz.schemaVersion === 2 && <span className="mt-1 block text-xs text-gray-500">{attempt.correct} / {attempt.total} correct</span>}
        <span className="mt-1 block text-xs text-gray-500">{new Date(attempt.submittedAt).toLocaleString()} · Review</span>
      </button>)}</div>
    </div>
  </section>;
}
