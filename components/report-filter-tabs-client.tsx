'use client';

interface ReportFilterTabsProps {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (option: string) => void;
  variant?: 'group' | 'institution';
  showSeparators?: boolean;
}

export function ReportFilterTabsClient({ options, selected, onSelect, variant = 'group', showSeparators = false }: ReportFilterTabsProps) {
  const isPrimaryNavigation = variant === 'group';

  return (
    <div className={`flex flex-wrap items-center ${
      isPrimaryNavigation
        ? 'gap-x-6 gap-y-2 text-sm sm:gap-x-10 sm:text-lg'
        : showSeparators
          ? 'gap-x-2 gap-y-1.5 text-sm sm:gap-x-3 sm:text-[15px]'
          : 'gap-x-6 gap-y-1.5 text-sm sm:gap-x-8 sm:text-[15px]'
    }`}
    >
      {options.map((option, index) => {
        const isActive = option.value === selected;
        const buttonClass = isActive
          ? 'border-[#2F67C8] font-semibold text-[#2F67C8]'
          : `${isPrimaryNavigation ? 'font-medium' : 'font-normal'} border-transparent text-slate-500 hover:text-slate-800`;

        return (
          <span key={option.value} className="flex items-center">
            <button
              type="button"
              onClick={() => onSelect(option.value)}
              className={`${isPrimaryNavigation ? 'border-b-[3px]' : 'border-b-2'} py-0.5 transition-colors duration-200 ${buttonClass}`}
            >
              {option.label}
            </button>
            {showSeparators && index < options.length - 1 && (
              <span aria-hidden="true" className="ml-2 select-none text-slate-200 sm:ml-3">|</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
