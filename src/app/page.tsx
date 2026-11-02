'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar, DashboardView } from '@/components/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { OverviewView } from '@/components/OverviewView';
import { CallsView } from '@/components/CallsView';
import { MissedCallsView } from '@/components/MissedCallsView';
import { Drawer, CallDetails } from '@/components/Drawer';
import { DemoModal } from '@/components/DemoModal';
import { PageContainer } from '@/components/layout/PageContainer';
import { useDashboardData } from '@/lib/useDashboardData';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const [currentView, setCurrentView] = useState<DashboardView>('overview');
  const [selectedCall, setSelectedCall] = useState<CallDetails | null>(null);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const {
    business,
    missed,
    calls,
    summaries,
    turnsMap,
    loadingTurns,
    initialLoading,
    loadError,
    simulating,
    lastCallId,
    setLastCallId,
    lastCallToken,
    setLastCallToken,
    sseConnected,
    sseError,
    simulate,
    fetchTurns,
    overallLatency,
    callsWithLatencyCount,
    completedCallsCount,
    completionRate,
    load,
  } = useDashboardData();

  const router = useRouter();

  // Support deep links such as /?tab=calls from the settings page.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'overview' || tab === 'calls' || tab === 'missed') {
      // Defer to avoid a synchronous cascading render during mount.
      queueMicrotask(() => setCurrentView(tab));
    }
  }, []);

  const handleSelectCall = useCallback((call: CallDetails) => {
    setSelectedCall(call);
    fetchTurns(call.id);
  }, [fetchTurns]);


  // Open drawer if ?call=<id> query param is in URL
  useEffect(() => {
    if (calls.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const targetCallId = params.get('call');
    if (targetCallId) {
      const match = calls.find(c => c.id === targetCallId);
      if (match) {
        const timer = setTimeout(() => handleSelectCall(match), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [calls, handleSelectCall]);

  // Keep selectedCall reference synced when call data updates
  useEffect(() => {
    if (selectedCall) {
      const updated = calls.find(c => c.id === selectedCall.id);
      if (
        updated &&
        (updated.notify_status !== selectedCall.notify_status ||
          updated.notified_at !== selectedCall.notified_at ||
          updated.notify_error !== selectedCall.notify_error)
      ) {
        const timer = setTimeout(() => setSelectedCall(updated), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [calls, selectedCall]);



  const handleChangeView = (view: DashboardView) => {
    if (view === 'settings') {
      router.push('/settings');
      return;
    }
    setCurrentView(view);
  };

  const pageTitle =
    currentView === 'overview'
      ? 'Overview'
      : currentView === 'calls'
      ? 'Calls'
      : currentView === 'missed'
      ? 'Missed calls'
      : 'Settings';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row antialiased selection:bg-primary/20 selection:text-primary">
      {/* App Shell Left Sidebar */}
      <Sidebar
        currentView={currentView}
        onChangeView={handleChangeView}
        callsCount={calls.length}
        missedCount={missed.length}
        sseConnected={sseConnected}
        sseError={sseError}
        businessName={typeof business?.name === 'string' ? business.name : 'Business'}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        onOpenDemoSettings={() => setDemoModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar with Search & Quick Actions */}
        <TopBar
          title={pageTitle}
          businessName={typeof business?.name === 'string' ? business.name : undefined}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSimulate={simulate}
          simulating={simulating}
          onOpenMobileMenu={() => setMobileOpen(true)}
        />

        {/* View Content */}
        <main className="flex-1 w-full min-w-0">
          <PageContainer size="wide">
            {loadError && (
              <div
                role="alert"
                className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                  <span>{loadError}</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1.5 self-start sm:self-auto">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}
            {currentView === 'overview' && (
              <OverviewView
                missed={missed}
                calls={calls}
                summaries={summaries}
                initialLoading={initialLoading}
                completedCallsCount={completedCallsCount}
                recoveryRate={completionRate}
                overallLatency={overallLatency}
                callsWithLatencyCount={callsWithLatencyCount}
                lastCallId={lastCallId}
                lastCallToken={lastCallToken}
                onDismissBanner={() => {
                  setLastCallId(null);
                  setLastCallToken(null);
                }}
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
                externalSearch={searchQuery}
              />
            )}

            {currentView === 'missed' && (
              <MissedCallsView
                missed={missed}
                initialLoading={initialLoading}
                onSimulate={simulate}
                simulating={simulating}
                externalSearch={searchQuery}
              />
            )}
          </PageContainer>
        </main>
      </div>

      {/* Right-Side Call Details Drawer */}
      <Drawer
        isOpen={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        call={selectedCall}
        businessName={typeof business?.name === 'string' ? business.name : undefined}
        summary={selectedCall ? summaries[selectedCall.id] || null : null}
        turns={selectedCall ? turnsMap[selectedCall.id] || null : null}
        loadingTurns={selectedCall ? !!loadingTurns[selectedCall.id] : false}
      />

      {/* Demo / Clear Test Data Modal */}
      <DemoModal
        isOpen={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
        onDataCleared={load}
      />
    </div>
  );
}
