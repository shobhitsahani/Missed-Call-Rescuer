'use client';

interface AgentStatusVisualizerProps {
  state: string;
}

export function AgentStatusVisualizer({ state }: AgentStatusVisualizerProps) {
  const norm = (state || '').toUpperCase();

  let label = 'Connecting...';
  let indicator: React.ReactNode = null;

  if (norm === 'LISTENING') {
    label = 'Listening... Speak naturally';
    indicator = (
      <div className="flex items-center gap-1.5 h-6 px-1" aria-hidden="true">
        <span className="w-1 h-3 rounded-full bg-teal-400 animate-pulse" />
        <span className="w-1 h-5 rounded-full bg-teal-400/80 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="w-1 h-3 rounded-full bg-teal-400 animate-pulse" style={{ animationDelay: '300ms' }} />
      </div>
    );
  } else if (norm === 'THINKING') {
    label = 'Thinking...';
    indicator = (
      <div className="flex items-center gap-1.5 h-6 px-1" aria-hidden="true">
        <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
        <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
      </div>
    );
  } else if (norm === 'SPEAKING') {
    label = 'Assistant Speaking';
    indicator = (
      <div className="flex items-end gap-1 h-7 px-1" aria-hidden="true">
        <span className="w-1 rounded-full bg-teal-400 animate-wave-1" />
        <span className="w-1 rounded-full bg-teal-300 animate-wave-2" />
        <span className="w-1 rounded-full bg-teal-400 animate-wave-3" />
        <span className="w-1 rounded-full bg-teal-300 animate-wave-4" />
        <span className="w-1 rounded-full bg-teal-400 animate-wave-5" />
      </div>
    );
  } else if (norm === 'SUMMARIZING' || norm === 'ENDING') {
    label = 'Finalizing summary...';
    indicator = (
      <div className="h-4 w-4 rounded-full border-2 border-teal-500/30 border-t-teal-400 animate-spin" aria-hidden="true" />
    );
  } else if (norm === 'DONE') {
    label = 'Call finished';
    indicator = (
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true" />
    );
  } else {
    // GREETING or idle
    label = 'Connecting assistant...';
    indicator = (
      <span className="h-2.5 w-2.5 rounded-full bg-teal-400 animate-pulse" aria-hidden="true" />
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-3 rounded-full border border-slate-800 bg-slate-900/90 px-4 py-2 shadow-sm"
    >
      <div className="flex items-center justify-center min-w-[28px]">{indicator}</div>
      <span className="text-xs font-medium text-slate-200 tracking-wide">{label}</span>
    </div>
  );
}
