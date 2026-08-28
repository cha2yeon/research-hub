'use client';

import { useState } from 'react';

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onApply: (range: { startDate: string; endDate: string }) => void;
  onClear: () => void;
}

function formatDateRangeDate(value: string): string {
  return value.replace(/-/g, '.');
}

export function DateRangeFilter({ startDate, endDate, onApply, onClear }: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState(startDate);
  const [draftEndDate, setDraftEndDate] = useState(endDate);
  const hasCompleteRange = Boolean(draftStartDate && draftEndDate);
  const hasInvalidRange = hasCompleteRange && draftStartDate > draftEndDate;

  const openPicker = () => {
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setIsOpen(true);
  };

  const applyRange = () => {
    if (!hasCompleteRange || hasInvalidRange) return;
    onApply({ startDate: draftStartDate, endDate: draftEndDate });
    setIsOpen(false);
  };

  const clearRange = () => {
    setDraftStartDate('');
    setDraftEndDate('');
    onClear();
    setIsOpen(false);
  };

  const label = startDate && endDate
    ? `${formatDateRangeDate(startDate)} ~ ${formatDateRangeDate(endDate)}`
    : '기간 선택';

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={openPicker}
        className="inline-flex items-center gap-1.5 border-b-2 border-transparent py-0.5 text-xs font-normal text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-800 sm:text-[15px]"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
          <path d="M7.5 3.5v4M16.5 3.5v4M3.5 9.5h17" />
        </svg>
        {label}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2.5rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:left-auto sm:right-0" role="dialog" aria-label="발행일 기간 선택">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-slate-600">
              <span>시작일</span>
              <input
                type="date"
                value={draftStartDate}
                onChange={(event) => setDraftStartDate(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-slate-600">
              <span>종료일</span>
              <input
                type="date"
                value={draftEndDate}
                onChange={(event) => setDraftEndDate(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              />
            </label>
          </div>
          {hasInvalidRange && <p className="mt-2 text-xs text-rose-600">종료일은 시작일 이후여야 합니다.</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={clearRange} className="text-xs font-medium text-slate-500 transition hover:text-slate-800">초기화</button>
            <button
              type="button"
              onClick={applyRange}
              disabled={!hasCompleteRange || hasInvalidRange}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
