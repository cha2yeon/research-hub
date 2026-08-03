import { JSDOM } from 'jsdom';
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

export async function fetchReportDetail(organization: string, rawUrl: string): Promise<string> {
  if (!(organization in DETAIL_SOURCES)) throw new Error('지원하지 않는 기관입니다.');

  const source = DETAIL_SOURCES[organization as DetailOrganization];
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== source.host) throw new Error('허용되지 않은 상세 URL입니다.');

  if (organization === '한국금융연구원') {
    const summary = await fetchKifSummary(url);
    if (summary) return summary;
  }

  const html = await fetchHtml(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (html.length > 2_000_000) throw new Error('상세페이지 응답이 너무 큽니다.');

  const document = new JSDOM(html).window.document;
  if (organization === '금융위원회') return extractFscSummary(document);

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
    if (htmlContent) return htmlContent;
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
