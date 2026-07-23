'use client';

import { ReportList } from '@/components/report-list';
import { ReportFilterTabsClient } from '@/components/report-filter-tabs-client';
import { ReportSearchBarClient } from '@/components/report-search-bar-client';
import { getReportsForDisplay } from '@/lib/report-data';
import { FilterOption } from '@/types/report';
import { useEffect, useMemo, useState } from 'react';

function normalizeFilterValue(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

export default function HomePage() {
  const [reports, setReports] = useState<any[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterOption>('전체');
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>(['전체']);

  useEffect(() => {
    async function loadOrganizations() {
      try {
        const response = await fetch('/api/reports/organizations', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Failed to load organizations');
        }

        const organizations = (await response.json()) as string[];
        setFilterOptions(['전체', ...organizations] as FilterOption[]);
      } catch (error) {
        console.error(error);
        setFilterOptions(['전체'] as FilterOption[]);
      }
    }

    loadOrganizations();
  }, []);

  useEffect(() => {
    async function loadReports() {
      try {
        const data = await getReportsForDisplay();
        setReports(data);
      } finally {
        setIsLoadingReports(false);
      }
    }

    loadReports();
  }, []);

  const filteredReports = useMemo(() => {
    const normalizedSelectedFilter = normalizeFilterValue(selectedFilter);

    const matchedReports = reports.filter((report) => {
      const matchesFilter =
        selectedFilter === '전체' || normalizeFilterValue(report.organization) === normalizedSelectedFilter;

      const keyword = searchQuery.trim().toLowerCase();
      const matchesSearch =
        keyword.length === 0 ||
        report.title.toLowerCase().includes(keyword) ||
        report.organization.toLowerCase().includes(keyword);

      return matchesFilter && matchesSearch;
    });

    return selectedFilter === '전체'
      ? matchedReports.sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())
      : matchedReports;
  }, [reports, searchQuery, selectedFilter]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
                Research insights, simplified
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Weekly Brief
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
                최신 기관 보고서를 한눈에 확인하고, 핵심 정보를 빠르게 찾아보세요.
              </p>
            </div>
            <div className="w-full max-w-md">
              <ReportSearchBarClient
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="보고서 제목 또는 기관명을 검색하세요"
              />
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">보고서 목록</h2>
              <p className="text-sm text-slate-500">
                선택한 조건에 맞는 보고서를 확인할 수 있습니다.
              </p>
            </div>
            <ReportFilterTabsClient options={filterOptions} selected={selectedFilter} onSelect={setSelectedFilter} />
          </div>

          <ReportList reports={filteredReports} isLoading={isLoadingReports} />
        </section>
      </div>
    </main>
  );
}
