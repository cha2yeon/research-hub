import { extractText, getDocumentProxy } from 'unpdf';

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_MIN_TEXT_LENGTH = 100;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface PdfExtractionResult {
  success: boolean;
  text: string;
  pageCount: number;
  extractedLength: number;
  error?: string;
}

export interface PdfExtractionOptions {
  allowedHosts?: readonly string[];
  maxBytes?: number;
  minTextLength?: number;
  timeoutMs?: number;
  pageSelection?: {
    initialPageCount: number;
    fallbackPageCount: number;
    minimumLength: number;
  };
  cleaning?: {
    removePressReleaseLabel?: boolean;
    removeBokMetadata?: boolean;
    removeTitlePrefix?: boolean;
    joinSingleSyllableBreaks?: boolean;
    documentTitle?: string;
    bodyStartPatterns?: readonly string[];
    stopAfterMarkers?: readonly string[];
  };
}

function normalizeLine(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function isRemovableLine(line: string, options: PdfExtractionOptions['cleaning']): boolean {
  if (!line) return true;
  if (/^(?:[-–—]?\s*)?\d+(?:\s*\/\s*\d+)?$/.test(line)) return true;
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(line)) return true;
  if (/^(?:copyright|©|저작권|무단\s*전재|담당부서|문의처|연락처|전화번호|이메일|e-?mail|배포일|배포시각|붙임)\b/i.test(line) && line.length <= 180) return true;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(line)) return true;
  if (/^(?:tel\.?|fax\.?|전화|팩스)\s*[:：]?\s*[\d()\-\s]+$/i.test(line)) return true;
  if (options?.removeBokMetadata && (
    /^20\d{2}년\s*\d{1,2}월\s*\d{1,2}일\s*공보/.test(line) ||
    /^공보\s*20\d{2}-\d+호/.test(line) ||
    /^이 자료는 배포시부터/.test(line) ||
    /^(?:문의처|담당부서|공보관|tel\.?|fax\.?|e-?mail)(?:\s|[:：]|$)/i.test(line) ||
    /한국은행\s*보도자료는/.test(line) ||
    /보도자료\s*(?:안내|문의|구독|자료실)/.test(line)
  )) return true;
  return false;
}

function isStopMarker(line: string, markers: readonly string[]): boolean {
  const normalized = line.replace(/^[\[\]()<>\s]*/, '');
  return markers.some((marker) => normalized.startsWith(marker));
}

function isListStart(line: string): boolean {
  return /^(?:[□■○]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.|\d{1,2}\.|[oㅇ]\s)/.test(line);
}

function joinReadableLines(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    if (current) paragraphs.push(current);
    current = '';
  };

  for (const line of lines) {
    if (isListStart(line)) flush();
    current = current ? `${current} ${line}` : line;
  }
  flush();
  return paragraphs.join('\n\n');
}

function comparableTitle(value: string): string {
  return value.replace(/^\[?\s*보도자료\s*\]?\s*/i, '').replace(/\s+/g, ' ').trim();
}

export function cleanPdfText(pageTexts: readonly string[], options: PdfExtractionOptions['cleaning'] = {}): string {
  let bodyStarted = !options.bodyStartPatterns?.length;
  let title = '';
  const pages = pageTexts.map((page) => {
    const lines: string[] = [];
    for (const rawLine of page.split(/\r?\n/)) {
      let line = normalizeLine(rawLine);
      if (options.removePressReleaseLabel) line = line.replace(/^\[?\s*보도자료\s*\]?\s*/i, '').trim();
      if (options.removeTitlePrefix && /^(?:제\s*목|제목)\s*[:：]/.test(line)) {
        title = line.replace(/^(?:제\s*목|제목)\s*[:：]\s*/, '').trim();
        continue;
      }
      if (options.stopAfterMarkers && isStopMarker(line, options.stopAfterMarkers)) break;
      if (!bodyStarted && options.bodyStartPatterns?.some((pattern) => line.startsWith(pattern))) bodyStarted = true;
      if (bodyStarted && line) lines.push(line);
    }
    return lines;
  });
  const repeatedLines = new Map<string, number>();

  for (const page of pages) {
    for (const line of Array.from(new Set(page))) {
      if (line.length >= 8 && line.length <= 160) {
        repeatedLines.set(line, (repeatedLines.get(line) || 0) + 1);
      }
    }
  }

  let body = pages
    .map((page) => joinReadableLines(page.filter((line) => !isRemovableLine(line, options) && (repeatedLines.get(line) || 0) < 2)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (options.joinSingleSyllableBreaks) {
    body = body.replace(/([가-힣])\s+([가-힣])(?=\s|[.,;:!?\)\]\}〉》」』])/g, '$1$2');
  }

  const includeTitle = title && comparableTitle(title) !== comparableTitle(options.documentTitle || '');
  return [includeTitle ? title : '', body].filter(Boolean).join('\n\n');
}

function failure(error: unknown, pageCount = 0): PdfExtractionResult {
  const message = error instanceof Error ? error.message : 'PDF 텍스트를 추출하지 못했습니다.';
  return { success: false, text: '', pageCount, extractedLength: 0, error: message };
}

export async function extractPdfText(rawUrl: string, options: PdfExtractionOptions = {}): Promise<PdfExtractionResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const minTextLength = options.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') throw new Error('PDF URL은 HTTPS여야 합니다.');
    if (options.allowedHosts && !options.allowedHosts.includes(url.hostname)) throw new Error('허용되지 않은 PDF 호스트입니다.');

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`PDF 다운로드 실패: ${response.status}`);

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('PDF 파일이 허용 크기를 초과했습니다.');

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error('PDF 파일 크기가 유효하지 않습니다.');
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') throw new Error('PDF 형식이 아닙니다.');

    const document = await getDocumentProxy(bytes);
    try {
      const pageSelection = options.pageSelection;
      const { text: pageTexts } = await extractText(document, { mergePages: false });
      const initialPageCount = Math.min(pageSelection?.initialPageCount ?? document.numPages, document.numPages);
      let selectedPageCount = initialPageCount;
      let cleanedText = cleanPdfText(pageTexts.slice(0, selectedPageCount), options.cleaning);

      if (pageSelection && cleanedText.length < pageSelection.minimumLength && selectedPageCount < document.numPages) {
        selectedPageCount = Math.min(pageSelection.fallbackPageCount, document.numPages);
        cleanedText = cleanPdfText(pageTexts.slice(0, selectedPageCount), options.cleaning);
      }
      if (pageSelection && cleanedText.length < pageSelection.minimumLength && selectedPageCount < document.numPages) {
        cleanedText = cleanPdfText(pageTexts, options.cleaning);
      }
      if (cleanedText.length < minTextLength) return failure(new Error('추출된 PDF 본문이 너무 짧습니다.'), document.numPages);

      return { success: true, text: cleanedText, pageCount: document.numPages, extractedLength: cleanedText.length };
    } finally {
      await document.cleanup();
    }
  } catch (error) {
    return failure(error);
  }
}
