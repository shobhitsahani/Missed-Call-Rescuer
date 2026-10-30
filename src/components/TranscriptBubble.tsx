'use client';

interface TranscriptBubbleProps {
  role: 'agent' | 'customer' | string;
  text: string;
  interrupted?: boolean;
  timestamp?: string;
}

export function TranscriptBubble({
  role,
  text,
  interrupted,
  timestamp,
}: TranscriptBubbleProps) {
  const isCustomer = role === 'customer';

  return (
    <div
      className={`flex flex-col mb-3.5 ${
        isCustomer ? 'items-end' : 'items-start'
      }`}
    >
      <div className="flex items-center gap-2 mb-1 px-1">
        <span className="text-[11px] font-medium tracking-wide uppercase text-slate-400">
          {isCustomer ? 'Customer' : 'Voice Agent'}
        </span>
        {timestamp && (
          <span className="text-[10px] text-slate-500">
            {new Date(timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
      </div>

      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isCustomer
            ? 'bg-teal-600 text-white rounded-tr-xs'
            : 'bg-slate-800/90 text-slate-200 border border-slate-700/60 rounded-tl-xs'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>

        {interrupted && !isCustomer && (
          <div className="mt-1.5 flex items-center gap-1">
            <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/25">
              interrupted
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
