'use client';

import * as React from 'react';
import {
  LayoutDashboard,
  PhoneCall,
  PhoneMissed,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Logomark } from './Logomark';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export type DashboardView = 'overview' | 'calls' | 'missed' | 'settings';

interface SidebarProps {
  currentView: DashboardView;
  onChangeView: (view: DashboardView) => void;
  callsCount: number;
  missedCount: number;
  sseConnected: boolean;
  sseError?: boolean;
  businessName?: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({
  currentView,
  onChangeView,
  callsCount,
  missedCount,
  sseConnected,
  sseError = false,
  businessName = 'Business',
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const navItems = [
    {
      id: 'overview' as DashboardView,
      label: 'Overview',
      icon: LayoutDashboard,
    },
    {
      id: 'calls' as DashboardView,
      label: 'Calls',
      count: callsCount,
      icon: PhoneCall,
    },
    {
      id: 'missed' as DashboardView,
      label: 'Missed calls',
      count: missedCount,
      icon: PhoneMissed,
    },
    {
      id: 'settings' as DashboardView,
      label: 'Settings',
      icon: Settings,
    },
  ];

  const renderNavContent = (isMobile = false) => {
    const isIconOnly = collapsed && !isMobile;

    return (
      <div className="flex flex-col min-h-full justify-between gap-4">
        <div className="space-y-6 shrink-0">
          {/* Brand header */}
          <div className={`flex items-center gap-3 px-3 py-2 ${isIconOnly ? 'justify-center' : ''}`}>
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Logomark size={20} />
            </div>
            {!isIconOnly && (
              <div className="min-w-0 flex-1">
                <span className="text-sm font-bold tracking-tight text-foreground block truncate">
                  Missed-Call Rescuer
                </span>
                <span className="text-[10px] text-muted-foreground block tracking-wider uppercase font-mono font-medium">
                  Voice AI Agent
                </span>
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1 px-1" aria-label="Sidebar Navigation">
            <TooltipProvider delayDuration={0}>
              {navItems.map((item) => {
                const isActive = currentView === item.id;
                const Icon = item.icon;

                const button = (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChangeView(item.id);
                      if (isMobile) onMobileOpenChange(false);
                    }}
                    className={`w-full flex items-center rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isIconOnly
                        ? 'h-9 w-9 p-0 justify-center mx-auto'
                        : 'px-3 py-2 justify-between'
                    } ${
                      isActive
                        ? 'bg-accent text-accent-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive ? 'text-primary' : 'text-muted-foreground'
                        }`}
                      />
                      {!isIconOnly && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </div>

                    {!isIconOnly && item.count !== undefined && item.count > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full tabular-nums font-mono ${
                          isActive
                            ? 'bg-primary/15 text-primary font-bold'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );

                if (isIconOnly) {
                  return (
                    <Tooltip key={item.id}>
                      <TooltipTrigger asChild>{button}</TooltipTrigger>
                      <TooltipContent side="right" className="flex items-center gap-2">
                        <span>{item.label}</span>
                        {item.count !== undefined && item.count > 0 && (
                          <Badge variant="secondary" className="px-1 text-[10px]">
                            {item.count}
                          </Badge>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return button;
              })}
            </TooltipProvider>
          </nav>
        </div>

        {/* Footer info & user badge */}
        <div className="space-y-3 pt-4 px-1 shrink-0">
          <Separator />

          {/* SSE Status */}
          <div
            className={`flex items-center rounded-lg border border-border bg-card/60 p-2 text-xs ${
              isIconOnly ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  sseConnected ? 'bg-emerald-500 animate-pulse' : sseError ? 'bg-destructive' : 'bg-amber-500'
                }`}
                aria-hidden="true"
              />
              {!isIconOnly && (
                <span className="text-[11px] font-medium text-foreground">
                  {sseConnected ? 'Live sync' : sseError ? 'Sync offline' : 'Connecting...'}
                </span>
              )}
            </div>
            {!isIconOnly && (
              <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono uppercase">
                SSE
              </Badge>
            )}
          </div>

          {/* Theme Toggle */}
          <div className="flex flex-col gap-1">
            <ThemeToggle collapsed={isIconOnly} />
          </div>

          <Separator />

          {/* Business profile badge */}
          <div
            className={`flex items-center gap-2.5 rounded-lg border border-border/80 bg-muted/40 p-2 ${
              isIconOnly ? 'justify-center' : 'justify-between'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0">
                {businessName.slice(0, 2)}
              </div>
              {!isIconOnly && (
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {businessName}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    Active workspace
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Collapse sidebar toggle button (Desktop only) */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="w-full text-muted-foreground hover:text-foreground text-[11px] justify-center gap-1.5 h-7"
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <>
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Collapse sidebar</span>
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside
        className={`hidden md:flex flex-col justify-between border-r border-border bg-card p-3 h-dvh sticky top-0 overflow-y-auto overflow-x-hidden transition-all duration-300 z-30 shrink-0 ${
          collapsed ? 'w-16' : 'w-64'
        }`}
        aria-label="Main Navigation"
      >
        {renderNavContent(false)}
      </aside>

      {/* Mobile Slide-in Sheet */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-72 p-4 bg-card">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
          </SheetHeader>
          {renderNavContent(true)}
        </SheetContent>
      </Sheet>
    </>
  );
}
