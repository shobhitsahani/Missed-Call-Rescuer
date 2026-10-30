'use client';

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-[#0e131f] p-4.5 animate-pulse">
      <div className="h-3 w-24 bg-slate-800 rounded mb-3" />
      <div className="h-7 w-16 bg-slate-800 rounded mb-2" />
      <div className="h-3 w-32 bg-slate-800/60 rounded" />
    </div>
  );
}

export function TableRowSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <tr className="border-b border-slate-800/60 animate-pulse">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div
            className="h-3.5 bg-slate-800/70 rounded"
            style={{ width: `${Math.max(40, (i * 23 + 47) % 85)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}
