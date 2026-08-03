import type { Report } from '@/types/report';

export interface SharedReport {
  id: string;
  title: string;
  organization: string;
  published_at: string;
  url: string;
  created_at: string;
  updated_at: string;
}

export interface SharedReportInput {
  title: string;
  organization: string;
  published_at: string;
  url: string;
}

function toSharedDisplayId(id: string): number {
  const numericId = Number(id);
  if (Number.isSafeInteger(numericId)) return -(Math.abs(numericId) + 1);

  return -Array.from(id).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) % Number.MAX_SAFE_INTEGER, 0) - 1;
}

export function toDisplayReport(sharedReport: SharedReport): Report {
  return {
    id: toSharedDisplayId(sharedReport.id),
    title: sharedReport.title,
    organization: sharedReport.organization,
    category: '공유',
    summary: '',
    publishedAt: sharedReport.published_at,
    url: sharedReport.url,
  };
}
