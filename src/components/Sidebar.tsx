'use client';

export type DashboardView = 'overview' | 'calls' | 'missed';

interface SidebarProps {
  currentView: DashboardView;
  onChangeView: (view: DashboardView) => void;
  callsCount: number;
  missedCount: number;
  sseConnected: boolean;
  onOpenDemoSettings: () => void;
}

export function Sidebar({
  currentView,
  onChangeView,
  callsCount,
  missedCount,
  sseConnected,
  onOpenDemoSettings,
}: SidebarProps) {
  const navItems = [
    {
      id: 'overview' as DashboardView,
      label: 'Overview',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      id: 'calls' as DashboardView,
      label: 'Calls',
      count: callsCount,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      ),
    },
    {
      id: 'missed' as DashboardView,
      label: 'Missed calls',
      count: missedCount,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.684A1 1 0 008.28 3H5z" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex w-60 bg-[#0c101a] border-r border-slate-800/80 flex-col justify-between p-4 shrink-0 h-screen sticky top-0"
        aria-label="Main Navigation"
      >
        <div>
          {/* Logo & Product Name */}
          <div className="flex items-center gap-2.5 px-2 py-3 mb-6">
            <div className="h-7 w-7 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-bold text-white tracking-tight block">
                Missed-Call Rescuer
              </span>
              <span className="text-[10px] text-slate-400 block tracking-wider uppercase font-medium">
                Voice AI Callback
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navItems.map(item => {
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeView(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                    isActive
                      ? 'bg-slate-800/90 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/50'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={isActive ? 'text-teal-400' : 'text-slate-500'}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>
                  {item.count !== undefined && item.count > 0 && (
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-full tabular-nums ${
                        isActive
                          ? 'bg-teal-500/20 text-teal-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Live SSE indicator & Settings */}
        <div className="pt-4 border-t border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800/60 text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  sseConnected ? 'bg-teal-400 animate-pulse' : 'bg-amber-400'
                }`}
                aria-hidden="true"
              />
              <span className="text-slate-300 text-[11px] font-medium">
                {sseConnected ? 'Live sync' : 'Reconnecting...'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
              SSE
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenDemoSettings}
            className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-slate-400 hover:text-slate-300 rounded hover:bg-slate-850/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
          >
            <span>Demo options</span>
            <span className="text-slate-400">⋯</span>
          </button>
        </div>
      </aside>

      {/* Mobile Top Bar Navigation */}
      <div className="md:hidden border-b border-slate-800/90 bg-[#0c101a] px-4 py-3 sticky top-0 z-30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white tracking-tight">
              Missed-Call Rescuer
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                sseConnected ? 'bg-teal-400 animate-pulse' : 'bg-amber-400'
              }`}
              aria-hidden="true"
            />
            <span className="text-[11px] text-slate-400">
              {sseConnected ? 'Live' : 'Syncing'}
            </span>
          </div>
        </div>

        {/* Mobile Navigation Pills */}
        <nav className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Mobile Navigation">
          {navItems.map(item => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeView(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap font-medium transition-colors ${
                  isActive
                    ? 'bg-teal-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-900/60 border border-slate-800/80'
                }`}
              >
                <span>{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span className="text-[10px] opacity-80 tabular-nums">
                    ({item.count})
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}
