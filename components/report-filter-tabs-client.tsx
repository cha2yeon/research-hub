'use client';

import { FilterOption } from '@/types/report';

interface ReportFilterTabsProps {
  options: FilterOption[];
  selected: FilterOption;
  onSelect: (option: FilterOption) => void;
}

export function ReportFilterTabsClient({ options, selected, onSelect }: ReportFilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = option === selected;

        return (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              isActive
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
