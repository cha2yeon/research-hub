export type FilterOption = '전체' | (string & {});

export interface Report {
  id: number;
  title: string;
  organization: string;
  category: string;
  summary?: string;
  publishedAt: string;
  datePrecision?: 'day' | 'month';
  firstSeenAt?: string;
  url: string;
}
