import { useEffect, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { getQuizAssetBlob } from '../services/quiz';
import type { QuizAsset } from '../types/quiz';

function QuizImage({ asset, alt, fullPage = false }: { asset: QuizAsset; alt: string; fullPage?: boolean }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    getQuizAssetBlob(asset.storagePath).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.storagePath]);

  if (failed) return <span className="block rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status">Diagram could not load. Open the source paper to view it.</span>;
  if (!url) return <span className="block animate-pulse rounded-xl bg-gray-100 p-6 text-sm text-gray-500 dark:bg-neutral-800" role="status">Loading diagram…</span>;
  return <img src={url} alt={alt || `Diagram from page ${asset.page}`} onError={() => setFailed(true)} className={fullPage ? 'my-3 h-auto w-full rounded-xl bg-white p-2' : 'my-3 max-h-[32rem] max-w-full rounded-xl bg-white object-contain p-2'} />;
}

export default function QuizContent({ content, assets = [] }: { content: string; assets?: QuizAsset[] }) {
  return (
    <div className="markdown-content min-w-0 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={url => url.startsWith('quiz-asset:') ? url : defaultUrlTransform(url)}
        components={{
          img: ({ src, alt }) => {
            const assetId = src?.startsWith('quiz-asset:') ? src.slice('quiz-asset:'.length) : undefined;
            const asset = assets.find(item => item.id === assetId);
            return asset ? <QuizImage asset={asset} alt={alt || ''} /> : <span className="text-sm text-amber-700 dark:text-amber-300">[Diagram unavailable — refer to source paper]</span>;
          },
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function QuizDiagrams({ assets, content, questionId }: { assets: QuizAsset[]; content: string; questionId: string }) {
  const referenced = new Set(Array.from(content.matchAll(/quiz-asset:([A-Za-z0-9_-]+)/g), match => match[1]));
  const remaining = assets.filter(asset => !referenced.has(asset.id));
  const originals = remaining.filter(asset => /^source-p[1-9][0-9]*$/.test(asset.id));
  const diagrams = remaining.filter(asset => !/^source-p[1-9][0-9]*$/.test(asset.id));
  const visualOptions = /See option [A-H] in the original question page\./.test(content);
  const originalsKey = JSON.stringify([questionId, originals.map(asset => asset.storagePath), visualOptions]);
  return remaining.length ? <div className="mt-4 space-y-3">{diagrams.map(asset => <QuizImage key={asset.id} asset={asset} alt={`Diagram from page ${asset.page}`} />)}{originals.length > 0 && <OriginalQuestionPages key={originalsKey} assets={originals} defaultOpen={visualOptions} />}</div> : null;
}

function OriginalQuestionPages({ assets, defaultOpen }: { assets: QuizAsset[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <details open={open} className="rounded-xl border border-gray-200 p-4 dark:border-white/15" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold">View original question {assets.length === 1 ? 'page' : 'pages'}</summary>
    {open && <div className="mt-3 space-y-4"><p className="text-xs text-gray-500">Compare the transcription with the original math, diagrams and options.</p>{assets.map(asset => <figure key={asset.id}><figcaption className="text-sm font-semibold">Source page {asset.page}</figcaption><QuizImage asset={asset} alt={`Original question paper page ${asset.page}`} fullPage /></figure>)}</div>}
  </details>;
}
