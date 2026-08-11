import { JSDOM } from 'jsdom';
import { extractText, getDocumentProxy } from 'unpdf';
import { extractPdfText } from '@/lib/pdf-extraction';
import { fetchHtml } from '@/lib/scrapers/http';

const DETAIL_SOURCES = {
  'KB경영연구소': {
    host: 'www.kbfg.com',
    selectors: ['.viewWrap .viewCont', 'main .view-content', 'main .report-content', '#contents .contents', '#contents .view', 'main article'],
  },
  금융위원회: {
    host: 'www.fsc.go.kr',
    selectors: ['main .content-body', 'main .view-content', 'main .board-view', 'main .bbs-view', 'main article'],
  },
  금융감독원: {
    host: 'www.fss.or.kr',
    selectors: ['main .dbdata', 'main .view-content', 'main .board-view', 'main .bbs-view', 'main .view_cont', 'main .contents', 'main article'],
  },
  '우리금융경영연구소': {
    host: 'www.wfri.re.kr',
    selectors: ['.content__report', 'main article', '#container article'],
  },
  '한국금융연구원': {
    host: 'www.kif.re.kr',
    selectors: ['.view_cont', '.board_view', 'main article', '#content'],
  },
  'KDB미래전략연구소': {
    host: 'rd.kdb.co.kr',
    selectors: ['#content', '.wrapper', 'main article'],
  },
  '한국은행': {
    host: 'www.bok.or.kr',
    selectors: ['.bd-view .view-content', '.bd-view .viewCont', '.bd-view .contents', '.bd-view article'],
    pdfFallback: {
      attachmentSelectors: ['.down-set a[href*=".pdf"]', 'a[href*=".pdf"]'],
      allowedHosts: ['www.bok.or.kr', 'file-cdn.bok.or.kr'],
    },
  },
  '산업통상자원부': {
    host: 'www.motie.go.kr',
    selectors: ['.detail-cont.mViewerContents'],
  },
  '중소벤처기업부': {
    host: 'www.mss.go.kr',
    selectors: ['.view_contents', '.txt-area'],
  },
  '재정경제부': {
    host: 'www.mofe.go.kr',
    selectors: ['.detailBoard'],
  },
  '기획예산처': {
    host: 'www.mpb.go.kr',
    selectors: ['.board-view-box .board-content .editor'],
    pdfFallback: {
      attachmentSelectors: ['.board-view-box a[href$=".pdf"]', '.board-view-box a[href*="download"]'],
      allowedHosts: ['www.mpb.go.kr', 'mpb.go.kr'],
    },
  },
  'EY한영': {
    host: 'www.ey.com',
    selectors: ['.rich-text.text.section'],
  },
} as const;

type DetailOrganization = keyof typeof DETAIL_SOURCES;

function cleanBlock(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBlocks(root: Element): string {
  const blocks = Array.from(root.querySelectorAll('p, li'))
    .map((element) => cleanBlock(element.textContent || ''))
    .filter((text, index, values) => text.length > 0 && values.indexOf(text) === index);

  return blocks.length > 0 ? blocks.join('\n\n') : cleanBlock(root.textContent || '');
}

function extractMssBlocks(root: Element): string {
  const rawHtml = root.querySelector<HTMLTextAreaElement>('#editContents')?.value;
  if (!rawHtml) return extractBlocks(root);

  const contentDocument = new JSDOM(`<div>${rawHtml}</div>`).window.document;
  return extractBlocks(contentDocument.body);
}

function extractWfriBlocks(root: Element): string {
  const excluded = /^(등록된 의견이 없습니다\.?|댓글\s*\d*|이전글|다음글|첨부파일|등록)$/;
  const blocks = Array.from(root.querySelectorAll('p, li'))
    .map((element) => cleanBlock(element.textContent || ''))
    .filter((text, index, values) => text.length > 0 && !excluded.test(text) && values.indexOf(text) === index);

  return blocks.length > 0 ? blocks.join('\n\n') : cleanBlock(root.textContent || '').replace(/등록된 의견이 없습니다\.?/g, '').trim();
}

function extractStructuredBlocks(root: Element): string {
  const blocks: string[] = [];
  const addBlock = (value: string) => {
    const text = cleanBlock(value);
    if (text && !blocks.includes(text)) blocks.push(text);
  };
  const readNode = (node: Node): string => {
    if (node.nodeType === node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== node.ELEMENT_NODE) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    return Array.from(element.childNodes).map(readNode).join('');
  };
  const visit = (node: Node) => {
    if (node.nodeType === node.TEXT_NODE) {
      addBlock(node.textContent || '');
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const element = node as Element;
    if (['SCRIPT', 'STYLE', 'TABLE'].includes(element.tagName)) return;
    if (['P', 'LI', 'TD', 'TH'].includes(element.tagName)) {
      addBlock(readNode(element));
      return;
    }
    const blockChildren = Array.from(element.childNodes).filter((child) => child.nodeType === child.TEXT_NODE || child.nodeType === child.ELEMENT_NODE);
    const hasNestedBlocks = blockChildren.some((child) => child.nodeType === child.ELEMENT_NODE && ['P', 'LI', 'DIV', 'UL', 'OL', 'TABLE', 'TBODY', 'TR', 'TD', 'TH'].includes((child as Element).tagName));
    if (hasNestedBlocks) blockChildren.forEach(visit);
    else addBlock(readNode(element));
  };

  Array.from(root.childNodes).forEach(visit);
  return blocks.join('\n\n');
}

function extractFscSummary(document: Document): string {
  const summaryBox = document.querySelector('.content-body .body > div > table');
  if (summaryBox) return extractStructuredBlocks(summaryBox);

  const labelledBox = Array.from(document.querySelectorAll('.content-body .body *')).find((element) => /^(주요 내용|핵심 내용|요약)$/.test(cleanBlock(element.textContent || '')))?.parentElement;
  if (labelledBox) return extractStructuredBlocks(labelledBox);

  const fallback = document.querySelector('.content-body .body, main .content-body, main .view-content, main .board-view, main .bbs-view, main article');
  return fallback ? extractBlocks(fallback) : '';
}

async function fetchKifSummary(url: URL): Promise<string> {
  const params = new URLSearchParams({
    ac: 'dataSearch',
    mid: url.searchParams.get('mid') || '',
    nid: '0',
    vid: '0',
    t1: '',
    t2: '',
    df: '',
    dt: '',
    kw: '',
    pn: '1',
    at: '0',
    sfield: '',
    pcnt: '10',
    lang: '0',
  });
  const response = await fetch(`https://www.kif.re.kr/kif4/biz/async_proc?${params.toString()}`, {
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01', Referer: url.toString(), 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' },
    cache: 'no-store',
  });
  if (!response.ok) return '';

  const payload = JSON.parse(await response.text()) as { datalist?: Array<{ cno?: string; hansummary?: string }> };
  const summary = payload.datalist?.find((item) => item.cno === url.searchParams.get('cno'))?.hansummary || '';
  return cleanBlock(new JSDOM(`<div>${summary}</div>`).window.document.body.textContent || '');
}

function findPdfAttachmentUrl(document: Document, pageUrl: URL, selectors: readonly string[], allowedHosts: readonly string[]): string | null {
  for (const selector of selectors) {
    const anchor = document.querySelector<HTMLAnchorElement>(selector);
    const href = anchor?.getAttribute('href');
    if (!href) continue;

    try {
      const pdfUrl = new URL(href, pageUrl);
      if (pdfUrl.protocol === 'https:' && allowedHosts.includes(pdfUrl.hostname)) return pdfUrl.toString();
    } catch {
      // Try the next attachment candidate.
    }
  }

  return null;
}

function extractEyInsightBlocks(document: Document): string {
  const inBriefSection = Array.from(document.querySelectorAll('.rich-text.text.section'))
    .find((section) => /^In\s+brief\b/i.test(cleanBlock(section.textContent || '')));

  return inBriefSection ? extractBlocks(inBriefSection) : '';
}

const BOK_RESEARCH_MENU_NUMBERS = new Set(['200433', '200431', '200327', '201140']);
const BOK_FINANCIAL_STABILITY_RESEARCH_MENU = '200327';
const BOK_PRESS_RELEASE_MENU = '201263';

function isBokResearchReport(url: URL): boolean {
  return ['menuNo', 'depth3', 'oldMenuNo'].some((key) => BOK_RESEARCH_MENU_NUMBERS.has(url.searchParams.get(key) || ''));
}

function isBokFinancialStabilityResearch(url: URL): boolean {
  return ['menuNo', 'depth3', 'oldMenuNo'].some((key) => url.searchParams.get(key) === BOK_FINANCIAL_STABILITY_RESEARCH_MENU);
}

function isBokPressRelease(url: URL): boolean {
  return ['menuNo', 'depth3', 'oldMenuNo'].some((key) => url.searchParams.get(key) === BOK_PRESS_RELEASE_MENU);
}

function extractBokResearchBlocks(root: Element): string {
  const keyTakeaways = Array.from(root.querySelectorAll('table')).find((table) => /KEY TAKEAWAYS/i.test(cleanBlock(table.textContent || '')));
  const contentElements = keyTakeaways
    ? [keyTakeaways, ...Array.from(root.querySelectorAll('p, li')).filter((element) => Boolean(keyTakeaways.compareDocumentPosition(element) & 4))]
    : Array.from(root.querySelectorAll('p, li'));
  const blocks = contentElements
    .map((element) => cleanBlock(element.textContent || ''))
    .filter((text) => text.length > 0)
    .filter((text) => !/^저자\s*[:：]/.test(text))
    .filter((text) => !/^자세한 내용은 첨부파일을 참고/.test(text))
    .filter((text, index, values) => values.indexOf(text) === index);

  return blocks.join('\n\n').trim();
}

function joinBokSummaryLines(lines: readonly string[]): string {
  const blocks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) blocks.push(current);
    current = '';
  };

  for (const rawLine of lines) {
    const line = cleanBlock(rawLine);
    if (!line || /^\d+$/.test(line)) continue;

    if (/^[\uF06E■□○]/.test(line)) {
      flush();
      blocks.push(line.replace(/^[\uF06E■□○]\s*/, ''));
      continue;
    }
    if (/^-\s+/.test(line)) {
      flush();
      current = line.replace(/^-\s+/, '');
      continue;
    }

    const lastWord = current.split(/\s+/).at(-1) || '';
    current = current ? `${current}${lastWord.length === 1 && /^[가-힣]$/.test(lastWord) && /^[가-힣]/.test(line) ? '' : ' '}${line}` : line;
  }
  flush();
  return blocks.join('\n\n').trim();
}

async function extractBokFinancialStabilityPdfSummary(pdfUrl: string): Promise<string> {
  const response = await fetch(pdfUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return '';

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 12 * 1024 * 1024 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') return '';

  const document = await getDocumentProxy(bytes);
  try {
    const { text: pageTexts } = await extractText(document, { mergePages: false });
    const summaryPageIndex = pageTexts.findIndex((page) => /^요\s*약\s*$/m.test(page));
    if (summaryPageIndex < 0) return '';

    const summaryLines: string[] = [];
    for (let pageIndex = summaryPageIndex; pageIndex < pageTexts.length; pageIndex += 1) {
      const pageLines = pageTexts[pageIndex].split(/\r?\n/);
      const lines = pageIndex === summaryPageIndex
        ? pageLines.slice(pageLines.findIndex((line) => /^요\s*약\s*$/.test(line)) + 1)
        : pageLines;
      const hasSummaryStructure = lines.some((line) => /^[\uF06E■□○]|^-\s+/.test(cleanBlock(line)));
      if (pageIndex > summaryPageIndex && !hasSummaryStructure) break;
      summaryLines.push(...lines);
    }

    return joinBokSummaryLines(summaryLines);
  } finally {
    await document.cleanup();
  }
}

async function fetchBokFinancialStabilitySummary(document: Document, url: URL): Promise<string> {
  const pdfUrl = findPdfAttachmentUrl(document, url, ['.bd-view .down-set a[href*=".pdf"]'], ['www.bok.or.kr', 'file-cdn.bok.or.kr']);
  return pdfUrl ? extractBokFinancialStabilityPdfSummary(pdfUrl) : '';
}

function joinBokPressSummaryLines(lines: readonly string[]): string {
  const blocks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) blocks.push(current);
    current = '';
  };

  for (const rawLine of lines) {
    const line = cleanBlock(rawLine);
    if (!line) continue;
    if (/^[□ㅇo]\s+/.test(line)) {
      flush();
      current = line;
      continue;
    }

    const lastWord = current.split(/\s+/).at(-1) || '';
    current = current ? `${current}${lastWord.length === 1 && /^[가-힣]$/.test(lastWord) && /^[가-힣]/.test(line) ? '' : ' '}${line}` : line;
  }
  flush();
  return blocks.join('\n\n').trim();
}

async function extractBokPressPdfSummary(pdfUrl: string): Promise<string> {
  const response = await fetch(pdfUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return '';

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 12 * 1024 * 1024 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') return '';

  const document = await getDocumentProxy(bytes);
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const lines = groupPdfLines(content.items.filter((item) => 'str' in item && 'transform' in item && 'width' in item) as unknown as PdfTextItem[])
      .sort((left, right) => right.y - left.y || left.x - right.x);
    const summaryStart = lines.findIndex((line) => /^□\s+/.test(line.text));
    if (summaryStart < 0) return '';

    const summaryLines: string[] = [];
    for (const line of lines.slice(summaryStart)) {
      if (/^(?:※|참\s*고|문의처|공보관|[“"]|붙임\b)/.test(line.text) || /세부내용.*붙임/.test(line.text)) break;
      summaryLines.push(line.text);
    }
    return joinBokPressSummaryLines(summaryLines);
  } finally {
    await document.cleanup();
  }
}

async function fetchBokPressSummary(document: Document, url: URL): Promise<string> {
  const pdfUrl = findPdfAttachmentUrl(document, url, ['.bd-view .down-set a[href*=".pdf"]'], ['www.bok.or.kr', 'file-cdn.bok.or.kr']);
  return pdfUrl ? extractBokPressPdfSummary(pdfUrl) : '';
}

type PdfTextItem = {
  str: string;
  transform: readonly number[];
  width: number;
};

function groupPdfLines(items: PdfTextItem[]): Array<{ y: number; x: number; text: string }> {
  const grouped = new Map<number, PdfTextItem[]>();
  items.forEach((item) => {
    if (!item.str.trim()) return;
    const y = Math.round(item.transform[5] * 2) / 2;
    const line = grouped.get(y) || [];
    line.push(item);
    grouped.set(y, line);
  });

  return Array.from(grouped.entries())
    .map(([y, line]) => {
      const sorted = [...line].sort((left, right) => left.transform[4] - right.transform[4]);
      return { y, x: sorted[0]?.transform[4] || 0, text: cleanBlock(sorted.map((item) => item.str).join(' ')) };
    })
    .filter((line) => line.text);
}

async function extractMofePdfBody(pdfUrl: URL): Promise<string> {
  const response = await fetch(pdfUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.mofe.go.kr/' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`MOFE PDF download failed: ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 12 * 1024 * 1024 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') return '';

  const document = await getDocumentProxy(bytes);
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((item) => 'str' in item && 'transform' in item && 'width' in item) as unknown as PdfTextItem[];
    const textItems = items.filter((item) => item.str.trim());
    const lines = groupPdfLines(textItems);
    const boxLines = lines
      .filter((line) => line.y > viewport.height * 0.52 && line.y < viewport.height * 0.9 && line.x > viewport.width * 0.01 && line.x < viewport.width * 0.95)
      .sort((left, right) => right.y - left.y || left.x - right.x);
    const summaryItems: string[] = [];
    let currentItem: string[] | null = null;
    let previousY: number | null = null;

    for (const line of boxLines) {
      const isBullet = /^-\s+/.test(line.text);
      const continuesItem = currentItem !== null && previousY !== null && previousY - line.y <= 28;

      if (isBullet) {
        if (currentItem) summaryItems.push(currentItem.join(' ').replace(/\s+/g, ' ').trim());
        currentItem = [line.text.replace(/^-\s+/, '')];
        previousY = line.y;
        continue;
      }

      if (!currentItem) continue;
      if (!continuesItem) break;
      currentItem?.push(line.text);
      previousY = line.y;
    }

    if (currentItem) summaryItems.push(currentItem.join(' ').replace(/\s+/g, ' ').trim());
    return summaryItems.join('\n').trim();
  } finally {
    await document.cleanup();
  }
}

async function fetchMofeDetail(url: URL): Promise<string> {
  const html = await fetchHtml(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const document = new JSDOM(html).window.document;
  const title = cleanBlock(document.querySelector('.detailBoard > h3')?.textContent || '');
  const pdfAnchor = Array.from(document.querySelectorAll<HTMLAnchorElement>('.detailBoard .fileInfo a[href*="FileDown.do"]'))
    .find((anchor) => /\.pdf\s*$/i.test(cleanBlock(anchor.textContent || '')));
  const href = pdfAnchor?.getAttribute('href');
  if (!title || !href) return '';

  const pdfUrl = new URL(href, url);
  return pdfUrl.protocol === 'https:' && pdfUrl.hostname === url.hostname ? extractMofePdfBody(pdfUrl) : '';
}

export async function fetchReportDetail(organization: string, rawUrl: string): Promise<string> {
  if (!(organization in DETAIL_SOURCES)) throw new Error('지원하지 않는 기관입니다.');

  const source = DETAIL_SOURCES[organization as DetailOrganization];
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== source.host) throw new Error('허용되지 않은 상세 URL입니다.');

  if (organization === '한국금융연구원') {
    const summary = await fetchKifSummary(url);
    if (summary) return summary;
  }

  if (organization === '재정경제부') return fetchMofeDetail(url);

  const html = await fetchHtml(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (html.length > 2_000_000) throw new Error('상세페이지 응답이 너무 큽니다.');

  const document = new JSDOM(html).window.document;
  if (organization === 'EY한영') {
    return extractEyInsightBlocks(document);
  }
  if (organization === '금융위원회') return extractFscSummary(document);

  if (organization === '한국은행' && isBokPressRelease(url)) return fetchBokPressSummary(document, url);

  if (organization === '한국은행' && isBokFinancialStabilityResearch(url)) return fetchBokFinancialStabilitySummary(document, url);

  if (organization === '한국은행' && isBokResearchReport(url)) {
    const bokResearchContent = extractBokResearchBlocks(document.querySelector('.bd-view .dbdata') || document.body);
    if (bokResearchContent) return bokResearchContent;
  }

  const root = source.selectors
    .map((selector) => document.querySelector(selector))
    .find((element): element is Element => Boolean(element));

  if (root) {
    const htmlContent = source.host === 'www.wfri.re.kr'
      ? extractWfriBlocks(root)
      : organization === '중소벤처기업부'
        ? extractMssBlocks(root)
        : organization === '금융감독원'
          ? extractStructuredBlocks(root)
          : extractBlocks(root);
    const mpbHtmlContent = organization === '기획예산처'
      ? htmlContent
        .replace(/^.*첨부(?:자료|파일).{0,30}참고.*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      : htmlContent;
    if (mpbHtmlContent) return mpbHtmlContent;
  }

  if ('pdfFallback' in source) {
    const pdfUrl = findPdfAttachmentUrl(document, url, source.pdfFallback.attachmentSelectors, source.pdfFallback.allowedHosts);
    if (pdfUrl) {
      const result = await extractPdfText(pdfUrl, {
        allowedHosts: source.pdfFallback.allowedHosts,
        pageSelection: { initialPageCount: 1, fallbackPageCount: 2, minimumLength: 300 },
        cleaning: {
          removePressReleaseLabel: true,
          removeBokMetadata: true,
          removeTitlePrefix: true,
          joinSingleSyllableBreaks: true,
          documentTitle: cleanBlock(document.querySelector('.bd-view .subject')?.textContent || ''),
          bodyStartPatterns: ['□', '■', 'Ⅰ.', '1.'],
          stopAfterMarkers: ['붙임', '참고', '별첨'],
        },
      });
      if (result.success) return result.text;
      console.warn(`[${organization}] PDF detail extraction failed: ${result.error}`);
    }
  }

  return '';
}
