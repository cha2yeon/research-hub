import iconv from 'iconv-lite';

export async function fetchHtml(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const charsets = ['utf-8', 'euc-kr', 'cp949'];
  const contentType = response.headers.get('content-type') || '';
  const explicitCharset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim();

  if (explicitCharset) {
    charsets.unshift(explicitCharset);
  }

  for (const charset of charsets) {
    try {
      const decoded = iconv.decode(buffer, charset);
      if (/[가-힣]/.test(decoded)) {
        return decoded;
      }
    } catch {
      // fall through to the next candidate charset
    }
  }

  return iconv.decode(buffer, 'utf-8');
}
