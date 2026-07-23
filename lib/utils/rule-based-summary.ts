const SUMMARY_KEYWORDS = [
  '발표', '추진', '시행', '계획', '지원', '확대', '강화', '개선', '마련', '도입', '개편', '적용',
  '제공', '운영', '점검', '대응', '보호', '완화', '공급', '투자', '금융', '대출', '금리', '시장',
  '기업', '소비자', '소상공인', '자본시장',
];

const EXCLUDED_PATTERNS = [
  /저작권/, /홈페이지/, /문의처?/, /담당자/, /연락처/, /첨부파일?/, /붙임/, /별첨/,
  /안녕하십니까/, /감사합니다/,
];

function normalizeText(value: string): string {
  const withoutContacts = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/(?:\+?82[-\s]?)?0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/g, ' ');
  const markerIndex = withoutContacts.search(/문의처?|담당자|연락처|붙임|별첨|첨부파일?/);
  return (markerIndex >= 0 ? withoutContacts.slice(0, markerIndex) : withoutContacts)
    .replace(/(^|\n)\s*(?:(?:[□■○ㅇ●◇◆▪▶※•]|📌|👥|📅|💰)+|[-–—]+|\d{1,3}[.)]|[①-⑳]|[（(]\d{1,3}[)）])\s*/g, '$1')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

function cleanSentence(sentence: string): string {
  const cleaned = sentence
    .replace(/^\s*(?:(?:[□■○ㅇ●◇◆▪▶※•]|📌|👥|📅|💰)+|[-–—]+|\d{1,3}[.)]|[①-⑳]|[（(]\d{1,3}[)）])\s*/g, '')
    .replace(/^\s*(?:핵심|대상|시행|주요 내용)\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  return `${cleaned.replace(/[.!?。]+$/g, '').trim()}.`;
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= 250) return [sentence];
  return sentence
    .split(/[,，]\s*|(?:그리고|또한|다만|하지만|이에 따라)\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20 && part.length <= 250);
}

function splitSentences(content: string): string[] {
  const protectedDecimals = content.replace(/(\d)\.(\d)/g, '$1∯$2');
  const pieces = protectedDecimals
    .split(/(?<=[.!?])\s+|\n+/)
    .flatMap((piece) => splitLongSentence(piece.replace(/∯/g, '.').trim()));

  return pieces
    .map(cleanSentence)
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 250);
}

function normalizedForComparison(value: string): string {
  return value.replace(/[^가-힣0-9a-z]/gi, '').toLowerCase();
}

function isSimilar(left: string, right: string): boolean {
  const normalizedLeft = normalizedForComparison(left);
  const normalizedRight = normalizedForComparison(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return true;

  const leftTokens = new Set(left.split(/\s+/).filter((token) => token.length >= 2));
  const rightTokens = new Set(right.split(/\s+/).filter((token) => token.length >= 2));
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size)) >= 0.75;
}

function scoreSentence(sentence: string, index: number, titleTerms: string[], normalizedTitle: string): number {
  if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(sentence))) return Number.NEGATIVE_INFINITY;
  const normalizedSentence = normalizedForComparison(sentence);
  if (!normalizedSentence || normalizedSentence === normalizedTitle || normalizedTitle.includes(normalizedSentence)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = index < 5 ? 4 : 0;
  SUMMARY_KEYWORDS.forEach((keyword) => {
    if (sentence.includes(keyword)) score += 3;
  });
  if (/\d/.test(sentence)) score += 2;
  if (/\d+(?:\.\d+)?\s*%|\d+\s*(?:억원|조원|만원|명|건)/.test(sentence)) score += 2;
  if (/20\d{2}[.-]\s*\d{1,2}[.-]\s*\d{1,2}|20\d{2}년/.test(sentence)) score += 2;
  titleTerms.forEach((term) => {
    if (sentence.includes(term)) score += 3;
  });
  return score;
}

export function createRuleBasedSummary(content: string, title = ''): string {
  const cleanedContent = normalizeText(content);
  const sentences = splitSentences(cleanedContent);
  const normalizedTitle = normalizedForComparison(title);
  const titleTerms = title.split(/\s+/).filter((term) => term.length >= 2 && /[가-힣a-z]/i.test(term));
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence, index, titleTerms, normalizedTitle) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: Array<{ sentence: string; index: number }> = [];

  for (const candidate of ranked) {
    if (selected.some((item) => isSimilar(item.sentence, candidate.sentence))) continue;
    const next = [...selected, candidate].sort((left, right) => left.index - right.index);
    const nextSummary = next.map((item) => item.sentence).join(' ');
    if (nextSummary.length > 320 && selected.length > 0) continue;
    selected.push(candidate);
    if (selected.length === 3) break;
  }

  if (selected.length === 0) return '본문 내용을 확인하려면 원문을 열어보세요.';
  return selected
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
