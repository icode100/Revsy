import { useRef, useState, type FormEvent } from 'react';
import QuizContent, { QuizDiagrams } from '../../components/QuizContent';
import { validateQuizDraft } from '../../domain/quiz';
import { saveQuiz } from '../../services/quiz';
import type { GateKeyEntry, GateQuizQuestion, QuizDocument, QuizDraft, QuizImport, QuizQuestionKind } from '../../types/quiz';
import { ErrorNotice, SourceFiles } from './controls';
import { errorMessage, inputStyle, primaryButton, questionLabel, secondaryButton, useAlive } from './helpers';

export default function DraftEditor({ job, userId, onSaved, onClose }: {
  job: QuizImport; userId: string; onSaved: (quiz: QuizDocument) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<QuizDraft>(() => structuredClone(job.draft!));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useAlive();
  const saveLock = useRef(false);
  const optionBackup = useRef(new Map<string, string[]>());

  const changeProblem = (index: number, problem: string) => {
    setDraft(previous => previous.schemaVersion === 1
      ? { ...previous, question: previous.question.map((question, position) => position === index ? { ...question, problem } : question) }
      : { ...previous, question: previous.question.map((question, position) => position === index ? { ...question, problem } : question) });
    setError(null);
  };
  const changeOption = (questionIndex: number, optionIndex: number, value: string) => {
    setDraft(previous => previous.schemaVersion === 1
      ? { ...previous, question: previous.question.map((question, position) => position === questionIndex ? { ...question, options: question.options.map((option, i) => i === optionIndex ? value : option) } : question) }
      : { ...previous, question: previous.question.map((question, position) => position === questionIndex ? { ...question, options: question.options.map((option, i) => i === optionIndex ? value : option) } : question) });
    setError(null);
  };
  const changeLegacyKey = (questionId: string, value: string) => {
    setDraft(previous => previous.schemaVersion !== 1 ? previous : {
      ...previous, key: [...previous.key.filter(item => item.questionId !== questionId),
        ...(value === '' ? [] : [{ questionId, correctOptionIndex: Number(value) }])],
    });
    setError(null);
  };
  const changeGateKey = (entry: GateKeyEntry) => {
    setDraft(previous => previous.schemaVersion !== 2 ? previous
      : { ...previous, key: [...previous.key.filter(item => item.questionId !== entry.questionId), entry] });
    setError(null);
  };
  const changeMetadata = (index: number, change: Partial<Pick<GateQuizQuestion, 'session' | 'section' | 'marks'>>) => {
    setDraft(previous => previous.schemaVersion !== 2 ? previous : {
      ...previous, question: previous.question.map((question, position) => position === index ? { ...question, ...change } : question),
    });
    setError(null);
  };
  const changeKind = (index: number, kind: QuizQuestionKind) => {
    setDraft(previous => {
      if (previous.schemaVersion !== 2) return previous;
      const question = previous.question[index];
      if (kind === question.kind) return previous;
      if (question.options.length) optionBackup.current.set(question.id, [...question.options]);
      const options = kind === 'nat' ? [] : question.options.length
        ? question.options : optionBackup.current.get(question.id) ?? ['', ''];
      const key: GateKeyEntry = kind === 'nat'
        ? { questionId: question.id, kind, minValue: '', maxValue: '' }
        : kind === 'msq' ? { questionId: question.id, kind, correctOptionIndices: [] }
          : { questionId: question.id, kind, acceptedOptionIndices: [] };
      return { ...previous,
        question: previous.question.map((item, position) => position === index ? { ...item, kind, options } : item),
        key: [...previous.key.filter(item => item.questionId !== question.id), key],
      };
    });
    setError(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saveLock.current) return;
    saveLock.current = true;
    setError(null);
    try {
      const valid = validateQuizDraft(draft, userId);
      setSaving(true);
      const saved = await saveQuiz(userId, valid, job.id);
      if (alive.current) onSaved(saved);
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      saveLock.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return <section className="glass-panel rounded-3xl p-5 sm:p-8" aria-labelledby="draft-heading">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="draft-heading" className="text-2xl font-black">Review your imported quiz</h2><p className="mt-2 text-sm text-gray-600 dark:text-neutral-400">Check every question, diagram and supplied answer before saving. Use $…$ or $$…$$ for math.</p></div>
      <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>Close draft</button>
    </div>
    <SourceFiles source={draft.source} />
    {draft.parsing.warnings.length > 0 && <div className="my-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-bold">Check these parsing notes</p><ul className="mt-2 list-disc space-y-1 pl-5">{draft.parsing.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    <form onSubmit={submit} className="mt-6 space-y-6">
      <label className="block text-sm font-bold">Quiz title<input className={`${inputStyle} mt-2`} value={draft.title} maxLength={160} disabled={saving} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} required /></label>
      <p className="text-sm text-gray-500">{draft.question.length} questions · Parsed with {draft.parsing.model}</p>
      {draft.question.map((question, questionIndex) => {
        const legacyKey = draft.schemaVersion === 1 ? draft.key.find(item => item.questionId === question.id) : undefined;
        const gateKey = draft.schemaVersion === 2 ? draft.key.find(item => item.questionId === question.id) : undefined;
        const gateQuestion = 'kind' in question ? question : null;
        return <article key={question.id} className="space-y-4 rounded-2xl border border-gray-200 p-4 sm:p-6 dark:border-white/10">
          <h3 className="font-black">{questionLabel(question)}</h3>
          {gateQuestion && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm font-semibold">Question type<select className={`${inputStyle} mt-2`} value={gateQuestion.kind} disabled={saving} onChange={event => changeKind(questionIndex, event.target.value as QuizQuestionKind)}><option value="mcq">MCQ · choose one</option><option value="msq">MSQ · choose all</option><option value="nat">NAT · numerical answer</option></select></label>
            <label className="block text-sm font-semibold">Session<input className={`${inputStyle} mt-2`} value={gateQuestion.session} maxLength={80} disabled={saving} onChange={event => changeMetadata(questionIndex, { session: event.target.value })} required /></label>
            <label className="block text-sm font-semibold">Section<input className={`${inputStyle} mt-2`} value={gateQuestion.section} maxLength={80} disabled={saving} onChange={event => changeMetadata(questionIndex, { section: event.target.value })} required /></label>
            <label className="block text-sm font-semibold">Marks<select className={`${inputStyle} mt-2`} value={gateQuestion.marks} disabled={saving} onChange={event => changeMetadata(questionIndex, { marks: event.target.value === '1' ? 1 : 2 })}><option value="1">1 mark</option><option value="2">2 marks</option></select></label>
          </div>}
          <label className="block text-sm font-semibold">Question text<textarea rows={4} className={`${inputStyle} mt-2 font-mono`} value={question.problem} disabled={saving} maxLength={20000} onChange={event => changeProblem(questionIndex, event.target.value)} required /></label>
          <div className="rounded-xl bg-gray-50/80 p-4 dark:bg-neutral-950/60"><p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Preview</p><QuizContent content={question.problem} assets={question.images} /><QuizDiagrams questionId={question.id} assets={question.images} content={[question.problem, ...question.options].join('\n')} /></div>
          <div className="space-y-3">{question.options.map((option, optionIndex) => <div key={optionIndex} className="grid gap-3 md:grid-cols-2"><label className="block text-sm font-semibold">Option {String.fromCharCode(65 + optionIndex)}<textarea rows={2} className={`${inputStyle} mt-2 font-mono`} value={option} disabled={saving} maxLength={20000} onChange={event => changeOption(questionIndex, optionIndex, event.target.value)} required /></label><div className="rounded-xl bg-gray-50/80 p-4 dark:bg-neutral-950/60"><QuizContent content={option} assets={question.images} /></div></div>)}</div>
          {!gateQuestion && <label className="block max-w-sm text-sm font-semibold">Answer from the supplied key<select className={`${inputStyle} mt-2`} value={legacyKey?.correctOptionIndex ?? ''} disabled={saving} onChange={event => changeLegacyKey(question.id, event.target.value)} required><option value="">Select the correct option</option>{question.options.map((_, index) => <option key={index} value={index}>Option {String.fromCharCode(65 + index)}</option>)}</select></label>}
          {gateQuestion && gateQuestion.kind !== 'nat' && <fieldset className="space-y-3"><legend className="font-semibold">{gateQuestion.kind === 'mcq' ? 'Accepted answers from the supplied key' : 'All correct choices from the supplied key'}</legend><p className="text-sm text-gray-500">{gateQuestion.kind === 'mcq' ? 'Select every alternative accepted by the official key. The learner still chooses one option.' : 'A response must contain exactly all selected choices to receive marks.'}</p><div className="flex flex-wrap gap-3">{question.options.map((_, index) => {
            const selected = gateKey?.kind === 'mcq' ? gateKey.acceptedOptionIndices : gateKey?.kind === 'msq' ? gateKey.correctOptionIndices : [];
            return <label key={index} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-white/15"><input type="checkbox" className="h-4 w-4 accent-purple-600" checked={selected.includes(index)} disabled={saving} onChange={() => {
              const choices = selected.includes(index) ? selected.filter(value => value !== index) : [...selected, index].sort((a, b) => a - b);
              changeGateKey(gateQuestion.kind === 'msq' ? { questionId: question.id, kind: 'msq', correctOptionIndices: choices } : { questionId: question.id, kind: 'mcq', acceptedOptionIndices: choices });
            }} />Option {String.fromCharCode(65 + index)}</label>;
          })}</div></fieldset>}
          {gateQuestion?.kind === 'nat' && <NumericalKeyEditor questionId={question.id} entry={gateKey?.kind === 'nat' ? gateKey : undefined} disabled={saving} onChange={changeGateKey} />}
        </article>;
      })}
      <div className="space-y-3"><ErrorNotice message={error} /><button type="submit" disabled={saving} className={primaryButton}>{saving ? 'Saving quiz…' : 'Save quiz and start practicing'}</button></div>
    </form>
  </section>;
}

function NumericalKeyEditor({ questionId, entry, disabled, onChange }: {
  questionId: string; entry?: Extract<GateKeyEntry, { kind: 'nat' }>;
  disabled: boolean; onChange: (entry: GateKeyEntry) => void;
}) {
  const key: Extract<GateKeyEntry, { kind: 'nat' }> = entry ?? { questionId, kind: 'nat', minValue: '', maxValue: '' };
  const ranges = key.additionalRanges ?? [];
  const updateRanges = (additionalRanges: { minValue: string; maxValue: string }[]) => onChange({
    questionId, kind: 'nat', minValue: key.minValue, maxValue: key.maxValue,
    ...(additionalRanges.length ? { additionalRanges } : {}),
  });
  return <fieldset className="space-y-3">
    <legend className="font-semibold">Accepted numerical range from the supplied key</legend>
    <p className="text-sm text-gray-500">Both endpoints are included. Use the same minimum and maximum for a single accepted value. Add another range when the official key accepts alternatives.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-semibold">Minimum accepted value<input type="text" inputMode="decimal" className={`${inputStyle} mt-2`} value={key.minValue} disabled={disabled} maxLength={100} onChange={event => onChange({ ...key, minValue: event.target.value })} required /></label>
      <label className="block text-sm font-semibold">Maximum accepted value<input type="text" inputMode="decimal" className={`${inputStyle} mt-2`} value={key.maxValue} disabled={disabled} maxLength={100} onChange={event => onChange({ ...key, maxValue: event.target.value })} required /></label>
    </div>
    {ranges.map((range, index) => <div key={index} className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">Alternative range {index + 1}</p><button type="button" className={secondaryButton} disabled={disabled} aria-label={`Remove alternative range ${index + 1}`} onClick={() => updateRanges(ranges.filter((_, position) => position !== index))}>Remove range</button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Alternative {index + 1} minimum accepted value<input type="text" inputMode="decimal" className={`${inputStyle} mt-2`} value={range.minValue} disabled={disabled} maxLength={100} onChange={event => updateRanges(ranges.map((item, position) => position === index ? { ...item, minValue: event.target.value } : item))} required /></label>
        <label className="block text-sm font-semibold">Alternative {index + 1} maximum accepted value<input type="text" inputMode="decimal" className={`${inputStyle} mt-2`} value={range.maxValue} disabled={disabled} maxLength={100} onChange={event => updateRanges(ranges.map((item, position) => position === index ? { ...item, maxValue: event.target.value } : item))} required /></label>
      </div>
    </div>)}
    <button type="button" className={secondaryButton} disabled={disabled || ranges.length >= 7} onClick={() => updateRanges([...ranges, { minValue: '', maxValue: '' }])}>Add alternative range</button>
  </fieldset>;
}
