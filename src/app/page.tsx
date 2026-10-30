'use client';

import { useState } from 'react';
import { Sidebar, DashboardView } from '@/components/Sidebar';
import { OverviewView } from '@/components/OverviewView';
import { CallsView } from '@/components/CallsView';
import { MissedCallsView } from '@/components/MissedCallsView';
import { Drawer, CallDetails } from '@/components/Drawer';
import { DemoModal } from '@/components/DemoModal';
import { useDashboardData } from '@/lib/useDashboardData';

export default function DashboardPage() {
  const [currentView, setCurrentView] = useState<DashboardView>('overview');
  const [selectedCall, setSelectedCall] = useState<CallDetails | null>(null);
  const [demoModalOpen, setDemoModalOpen] = useState(false);

  const {
    business,
    missed,
    calls,
    summaries,
    turnsMap,
    loadingTurns,
    initialLoading,
    simulating,
    lastCallId,
    setLastCallId,
    sseConnected,
    simulate,
    fetchTurns,
    overallLatency,
    completedCallsCount,
    recoveryRate,
  } = useDashboardData();

  const handleSelectCall = (call: CallDetails) => {
    setSelectedCall(call);
    fetchTurns(call.id);
  };

  const pageTitle =
    currentView === 'overview'
      ? 'Overview'
      : currentView === 'calls'
      ? 'Calls'
      : 'Missed calls';

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col md:flex-row antialiased selection:bg-teal-500/30 selection:text-teal-200">
      {/* App Shell Left Sidebar */}
      <Sidebar
        currentView={currentView}
        onChangeView={setCurrentView}
        callsCount={calls.length}
        missedCount={missed.length}
        sseConnected={sseConnected}
        onOpenDemoSettings={() => setDemoModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-[#090d16]/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
              {pageTitle}
            </h1>

            {business && (
              <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-850 text-slate-300 border border-slate-700/60 truncate max-w-xs">
                {business.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={simulate}
              disabled={simulating}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090d16]"
            >
              {simulating ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Simulating...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Simulate missed call</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* View Content */}
        <main className="flex-1 p-4 sm:p-8 max-w-6xl w-full mx-auto">
          {currentView === 'overview' && (
            <OverviewView
              missed={missed}
              calls={calls}
              summaries={summaries}
              initialLoading={initialLoading}
              completedCallsCount={completedCallsCount}
              recoveryRate={recoveryRate}
              overallLatency={overallLatency}
              lastCallId={lastCallId}
              onDismissBanner={() => setLastCallId(null)}
              onViewAllCalls={() => setCurrentView('calls')}
              onSelectCall={handleSelectCall}
              onSimulate={simulate}
              simulating={simulating}
            />
          )}

          {currentView === 'calls' && (
            <CallsView
              calls={calls}
              summaries={summaries}
              initialLoading={initialLoading}
              onSelectCall={handleSelectCall}
              onSimulate={simulate}
              simulating={simulating}
            />
          )}

          {currentView === 'missed' && (
            <MissedCallsView
              missed={missed}
              initialLoading={initialLoading}
              onSimulate={simulate}
              simulating={simulating}
            />
          )}
        </main>
      </div>

      {/* Right-Side Call Details Drawer */}
      <Drawer
        isOpen={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        call={selectedCall}
        businessName={business?.name}
        summary={selectedCall ? summaries[selectedCall.id] || null : null}
        turns={selectedCall ? turnsMap[selectedCall.id] || null : null}
        loadingTurns={selectedCall ? !!loadingTurns[selectedCall.id] : false}
      />

      {/* Demo / Clear Test Data Modal */}
      <DemoModal
        isOpen={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
      />
    </div>
  );
}
