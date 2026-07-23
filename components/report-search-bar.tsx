interface ReportSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function ReportSearchBar({ value, onChange, placeholder }: ReportSearchBarProps) {
  return (
    <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
      <span className="text-slate-400">🔎</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full border-none bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
    </label>
  );
}
