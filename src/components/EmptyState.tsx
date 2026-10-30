'use client';

interface EmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  loading?: boolean;
}

export function EmptyState({
  title,
  description,
  actionText = 'Simulate missed call',
  onAction,
  loading = false,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="h-10 w-10 rounded-full bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-3">
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
          />
        </svg>
      </div>

      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 text-xs text-slate-400 max-w-sm">{description}</p>

      {onAction && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onAction}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-colors shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            {loading ? (
              <>
                <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Simulating...
              </>
            ) : (
              actionText
            )}
          </button>
        </div>
      )}
    </div>
  );
}
