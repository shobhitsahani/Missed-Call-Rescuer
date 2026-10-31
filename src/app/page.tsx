'use client';

import { useState, useEffect } from 'react';
import { Sidebar, DashboardView } from '@/components/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { OverviewView } from '@/components/OverviewView';
import { CallsView } from '@/components/CallsView';
import { MissedCallsView } from '@/components/MissedCallsView';
import { Drawer, CallDetails } from '@/components/Drawer';
import { DemoModal } from '@/components/DemoModal';
import { PageContainer } from '@/components/layout/PageContainer';
import { useDashboardData } from '@/lib/useDashboardData';

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


  // Open drawer if ?call=<id> query param is in URL
  useEffect(() => {
    if (calls.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const targetCallId = params.get('call');
    if (targetCallId) {
      const match = calls.find(c => c.id === targetCallId);
      if (match) {
        handleSelectCall(match);
      }
    }
  }, [calls]);

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
        setSelectedCall(updated);
      }
    }
  }, [calls, selectedCall]);



  const handleChangeView = (view: DashboardView) => {
    if (view === 'settings') {
      window.location.href = '/settings';
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
        businessName={business?.name || 'Business'}
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
          businessName={business?.name}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSimulate={simulate}
          simulating={simulating}
          onOpenMobileMenu={() => setMobileOpen(true)}
        />

        {/* View Content */}
        <main className="flex-1 w-full min-w-0">
          <PageContainer size="wide">
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
          </PageContainer>
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
