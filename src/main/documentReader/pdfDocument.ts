import { isOcrSupported } from '../ocr/ocrEngine';
import { ocrPdf, readPdfText } from '../ocr/pdfOcr';

const PdfDocumentSource = { Text: 'pdf-text', Ocr: 'ocr', Mixed: 'pdf-text+ocr' } as const;

export async function readPdfDocument(
  filePath: string,
  options: { pages?: string; language?: string },
  signal: AbortSignal,
) {
  const extracted = await readPdfText(filePath, options.pages, signal);
  if (!extracted.pages.length) throw new Error('No PDF pages match the requested page range.');

  const missing = extracted.pages.filter(page => !page.text).map(page => page.page);
  const recovered = new Map<number, string>();
  let truncated = extracted.truncated;
  if (missing.length && isOcrSupported()) {
    try {
      const recognized = await ocrPdf(filePath, missing, options.language, signal);
      truncated ||= recognized.truncated;
      for (const page of recognized.pages) {
        if (page.text) recovered.set(page.page, page.text);
      }
    } catch (error) {
      signal.throwIfAborted();
      console.warn('[DocumentReader] PDF page recognition failed:', error);
    }
  }

  const hasText = missing.length < extracted.pages.length;
  if (!hasText && !recovered.size)
    throw new Error(
      'No readable PDF text was found. Local OCR is unavailable or returned no text.',
    );
  const markdown = extracted.pages
    .map(
      ({ page, text }) =>
        `## Page ${page}\n${text || recovered.get(page) || '(no readable text; local OCR returned no text or did not run)'}`,
    )
    .join('\n\n');
  const source = recovered.size
    ? hasText
      ? PdfDocumentSource.Mixed
      : PdfDocumentSource.Ocr
    : PdfDocumentSource.Text;
  return {
    markdown,
    source,
    pageCount: extracted.pageCount,
    pages: extracted.pages.length,
    truncated,
  };
}
