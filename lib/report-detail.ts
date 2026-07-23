import { JSDOM } from 'jsdom';
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

export async function fetchReportDetail(organization: string, rawUrl: string): Promise<string> {
  if (!(organization in DETAIL_SOURCES)) throw new Error('지원하지 않는 기관입니다.');

  const source = DETAIL_SOURCES[organization as DetailOrganization];
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== source.host) throw new Error('허용되지 않은 상세 URL입니다.');

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
  if (!root) return '';

  return organization === '금융감독원' ? extractStructuredBlocks(root) : extractBlocks(root);
}
