'use client';

import { useState } from 'react';
import { getInstitutionDisplayName } from '@/lib/institution-groups';
import { Report } from '@/types/report';

interface ReportListProps {
  reports: Report[];
  isLoading?: boolean;
}

interface DetailState {
  content?: string;
  loading?: boolean;
  error?: string;
}

const DETAIL_ORGANIZATIONS = new Set([
  'KB경영연구소',
  '하나금융연구소',
  '금융위원회',
  '금융감독원',
  '우리금융경영연구소',
  '한국금융연구원',
  'KDB미래전략연구소',
  '한국은행',
  'KDI(한국개발연구원)',
  '산업통상자원부',
  '중소벤처기업부',
  'KIET 산업연구원',
  '재정경제부',
  '기획예산처',
  'EY한영',
  '국제금융센터(KCIF)',
  'Federal Reserve',
]);

const LIST_SUMMARY_ONLY_ORGANIZATIONS = new Set(['KDI(한국개발연구원)', 'KIET 산업연구원', 'Federal Reserve']);

function createDisplaySummary(report: Report): string {
  const summary = report.summary?.replace(/\s+/g, ' ').trim();
  if (!summary) {
    return `${getInstitutionDisplayName(report.organization)}에서 제공한 ${report.category} 자료입니다.`;
  }

  const sentences = summary
    .split(/(?<=[.!?])\s+|∎/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`));

  return sentences.length > 1 ? sentences.join(' ') : summary;
}

function formatPublishedAt(report: Report): string {
  const date = report.datePrecision === 'month' ? report.publishedAt.slice(0, 7) : report.publishedAt;
  return date.replace(/-/g, '.');
}

function formatDisplayTitle(report: Report): string {
  if (report.organization !== 'KDB미래전략연구소') return report.title;

  return report.title
    .replace(/^\s*이슈브리프,\s*/, '')
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .replace(/^\s*\(제\s*\d+호\)\s*/, '')
    .replace(/^산은조사월보\s*/, '')
    .replace(/^(?:이슈분석|경제동향|산업동향)\s*[.:]\s*/, '')
    .replace(/^[,.:]\s*/, '')
    .trim();
}

function formatDisplayCategory(report: Report): string {
  if (report.organization === 'KDB미래전략연구소') return '연구보고서';
  if (report.organization === '산업통상자원부' && report.category === '참고자료') return '보도자료';
  return report.category;
}

export function ReportList({ reports, isLoading = false }: ReportListProps) {
  const [openSummaryKeys, setOpenSummaryKeys] = useState<Set<string>>(new Set());
  const [detailStates, setDetailStates] = useState<Record<string, DetailState>>({});

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" aria-hidden="true" />
        보고서를 불러오는 중입니다...
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        검색 조건에 맞는 보고서가 없습니다.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {reports.map((report, index) => {
        const reportKey = report.url
          ? `${report.organization}:${report.url}:${index}`
          : `${report.organization}:${report.id}:${report.title}:${report.publishedAt}:${index}`;
        const isSharedReport = report.category === '공유';
        const usesDetailCard = DETAIL_ORGANIZATIONS.has(report.organization) || isSharedReport;
        const isSummaryOpen = openSummaryKeys.has(reportKey);
        const detailState = detailStates[reportKey];
        const summaryContent = detailState?.content || (
          report.organization === '하나금융연구소' ||
          report.organization === 'KDB미래전략연구소' ||
          LIST_SUMMARY_ONLY_ORGANIZATIONS.has(report.organization)
            ? report.summary || createDisplaySummary(report)
            : ''
        );
        const hasSummary = Boolean(summaryContent.trim());
        const summaryRegionId = `hana-summary-${report.id}-${reportKey.length}`;
        const displayCategory = formatDisplayCategory(report);
        const categoryBadgeClass = displayCategory === '보도자료'
          ? 'border border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border border-sky-200 bg-sky-50 text-sky-700';
        const toggleSummary = async () => {
          if (isSummaryOpen) {
            setOpenSummaryKeys((current) => {
              const next = new Set(current);
              next.delete(reportKey);
              return next;
            });
            return;
          }

          setOpenSummaryKeys((current) => new Set(current).add(reportKey));
          if (hasSummary || detailState?.loading) return;

          if (report.organization === 'KDB미래전략연구소') {
            setDetailStates((current) => ({
              ...current,
              [reportKey]: { error: '제공된 요약이 없습니다.' },
            }));
            return;
          }

          setDetailStates((current) => ({ ...current, [reportKey]: { loading: true } }));
          try {
            const params = new URLSearchParams({ organization: report.organization, url: report.url });
            const response = await fetch(`/api/reports/detail?${params.toString()}`);
            if (!response.ok) throw new Error('상세 내용을 불러오지 못했습니다.');
            const data = await response.json() as { content?: string };
            setDetailStates((current) => ({ ...current, [reportKey]: { content: data.content || '', error: data.content ? undefined : '표시할 상세 내용이 없습니다.' } }));
          } catch {
            setDetailStates((current) => ({ ...current, [reportKey]: { error: '상세 내용을 불러오지 못했습니다. 다시 시도해 주세요.' } }));
          }
        };

        return (
        <article
          key={reportKey}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
        >
          <div className={usesDetailCard ? 'space-y-3' : 'flex flex-col gap-3 md:flex-row md:items-start md:justify-between'}>
            <div className={usesDetailCard ? 'space-y-3' : 'space-y-1.5'}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${categoryBadgeClass}`}>
                  {displayCategory}
                </span>
                <span aria-hidden="true" className="text-xs text-slate-400">|</span>
                <span className="rounded-full border border-transparent bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                  {getInstitutionDisplayName(report.organization)}
                </span>
              </div>
              <div className={usesDetailCard ? 'flex flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6' : undefined}>
                <h3 className={usesDetailCard ? 'flex-1 text-lg font-semibold text-slate-900' : 'text-lg font-semibold text-slate-900'}>{formatDisplayTitle(report)}</h3>
                {usesDetailCard && (
                  <span className="shrink-0 whitespace-nowrap text-sm text-slate-500">{formatPublishedAt(report)}</span>
                )}
              </div>
              {usesDetailCard ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={report.url}
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    >
                      원문보기
                    </a>
                    {!isSharedReport && <button
                        type="button"
                        onClick={toggleSummary}
                        aria-expanded={isSummaryOpen}
                        aria-controls={summaryRegionId}
                        className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${isSummaryOpen ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 hover:bg-slate-100'}`}
                      >
                        {isSummaryOpen ? '접기' : '요약보기'}
                    </button>}
                    
                  </div>
                  {isSummaryOpen && (
                    <div id={summaryRegionId} className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${isSummaryOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                      <div className="min-h-0 overflow-hidden">
                        {detailState?.loading ? <p className="text-base leading-7 text-slate-500">상세 내용을 불러오는 중입니다...</p> : detailState?.error ? <p className="text-base leading-7 text-rose-600">{detailState.error}</p> : <p className="whitespace-pre-line text-base leading-7 text-slate-600">{summaryContent}</p>}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600">{createDisplaySummary(report)}</p>
              )}
            </div>

            {!usesDetailCard && (
              <div className="flex flex-col items-start gap-2 md:items-end">
                <span className="text-sm text-slate-500">발간일: {formatPublishedAt(report)}</span>
                <a
                  href={report.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  원문보기
                </a>
              </div>
            )}
          </div>
        </article>
        );
      })}
    </div>
  );
}
