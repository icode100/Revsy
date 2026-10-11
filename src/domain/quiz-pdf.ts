import { MAX_PDF_BYTES } from './quiz';

export type QuizPdfPageCounts = { paper: number; answerKey: number; total: number };
export type QuizParserMode = 'zerogpu' | 'full' | 'gemini';

// File objects are immutable. Reuse the selection check at the upload boundary
// without parsing the same PDF twice or retaining replaced files.
const pageCounts = new WeakMap<File, Promise<number>>();

async function countPdfPages(file: File): Promise<number> {
  if (!/\.pdf$/i.test(file.name) || file.size === 0 || file.size > MAX_PDF_BYTES) {
    throw new Error('Choose a non-empty PDF of up to 25 MB.');
  }
  const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
  if (!header.startsWith('%PDF-')) throw new Error('This file is not a valid PDF.');

  // Parse the page tree, including compressed object streams. Counting text
  // occurrences of /Page misses valid PDFs and can undercount large uploads.
  const { PDFDocument, EncryptedPDFError } = await import('pdf-lib');
  let count;
  try {
    const document = await PDFDocument.load(await file.arrayBuffer(), {
      updateMetadata: false, throwOnInvalidObject: true,
    });
    count = document.getPageCount();
  } catch (error) {
    // pdf-lib's ES5 Error subclass does not preserve instanceof in every build.
    if (error instanceof EncryptedPDFError
      || error instanceof Error && error.message === new EncryptedPDFError().message) {
      throw new Error('Password-protected PDFs are unsupported. Upload an unlocked PDF.');
    }
    throw new Error('The PDF could not be opened. Export it as a new PDF and retry.');
  }
  if (count < 1) throw new Error('The PDF contains no pages. Choose a PDF with at least one page.');
  return count;
}

export function inspectQuizPdf(file: File): Promise<number> {
  let result = pageCounts.get(file);
  if (!result) {
    result = countPdfPages(file);
    pageCounts.set(file, result);
  }
  return result;
}

export async function validateQuizPdfFiles(
  paper: File, answerKey: File | null, mode: QuizParserMode,
): Promise<QuizPdfPageCounts> {
  const [paperPages, keyPages] = await Promise.all([
    inspectQuizPdf(paper), answerKey ? inspectQuizPdf(answerKey) : Promise.resolve(0),
  ]);
  const total = paperPages + keyPages;
  if (mode === 'zerogpu' && total > 2) {
    const selected = answerKey
      ? `Selected PDFs contain ${total} pages total (question paper: ${paperPages}; answer key: ${keyPages}).`
      : `The question paper contains ${paperPages} pages.`;
    throw new Error(`${selected} Our current free importer is limited to 2 pages total, including the answer key. Upload a smaller excerpt.`);
  }
  if (mode === 'gemini') {
    if (paperPages > 200) throw new Error(`The question paper contains ${paperPages} pages. Full-paper imports support up to 200 pages in the question paper.`);
    if (keyPages > 30) throw new Error(`The answer key contains ${keyPages} pages. The answer key may contain at most 30 pages.`);
  } else if (mode === 'full') {
    if (paperPages > 30) throw new Error(`The question paper contains ${paperPages} pages. Each PDF may contain at most 30 pages.`);
    if (keyPages > 30) throw new Error(`The answer key contains ${keyPages} pages. Each PDF may contain at most 30 pages.`);
  }
  return { paper: paperPages, answerKey: keyPages, total };
}
