'use client';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  tooltip?: string;
}

export function StatCard({ title, value, subtitle, tooltip }: StatCardProps) {
  const isAvailable = value !== null && value !== undefined && value !== '' && value !== '—';

  return (
    <div
      className="relative rounded-xl border border-slate-800/80 bg-[#0e131f] p-4.5 transition-colors hover:border-slate-700/70"
      title={tooltip}
    >
      <p className="text-[12px] font-medium tracking-wide text-slate-400">
        {title}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-white tabular-nums">
          {isAvailable ? value : '—'}
        </span>
      </div>
      {subtitle && (
        <p className="mt-1 text-[12px] text-slate-400 leading-normal truncate tabular-nums">
          {subtitle}
        </p>
      )}
    </div>
  );
}
