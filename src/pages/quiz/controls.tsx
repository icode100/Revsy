import { useEffect, useRef, useState } from 'react';
import { getQuizAssetBlob } from '../../services/quiz';
import type { QuizDraft } from '../../types/quiz';
import { errorMessage, secondaryButton, useAlive } from './helpers';

export function ErrorNotice({ message }: { message: string | null }) {
  return message ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{message}</div> : null;
}

function SourcePdfButton({ path, label }: { path: string; label: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useAlive();
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  const download = async () => {
    setLoading(true);
    setError(null);
    try {
      const blob = await getQuizAssetBlob(path);
      if (!alive.current) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const link = document.createElement('a');
      link.href = url;
      link.download = label.includes('key') ? 'answer-key.pdf' : 'question-paper.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  return <div><button type="button" className={secondaryButton} disabled={loading} onClick={download}>{loading ? 'Loading PDF…' : label}</button>{error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}</div>;
}

export function SourceFiles({ source }: { source: QuizDraft['source'] }) {
  return <div className="flex flex-wrap gap-3"><SourcePdfButton path={source.paperPath} label="Download question paper" />{source.answerKeyPath && <SourcePdfButton path={source.answerKeyPath} label="Download answer key" />}</div>;
}
