'use client';

import * as React from 'react';
import { Menu, Search, PhoneCall, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Logomark } from './Logomark';

interface TopBarProps {
  title: string;
  businessName?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSimulate: () => void;
  simulating: boolean;
  onOpenMobileMenu: () => void;
}

export function TopBar({
  title,
  businessName = 'Acme Plumbing',
  searchQuery,
  onSearchChange,
  onSimulate,
  simulating,
  onOpenMobileMenu,
}: TopBarProps) {
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Keyboard shortcut Ctrl+K / Cmd+K to focus search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/80 px-4 md:px-6 backdrop-blur-md">
      {/* Left: Mobile menu trigger + Breadcrumb / Title */}
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenMobileMenu}
          className="md:hidden text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2 min-w-0">
          <div className="md:hidden flex items-center">
            <Logomark size={18} />
          </div>
          <span className="hidden sm:inline-block text-xs font-medium text-muted-foreground">
            App
          </span>
          <span className="hidden sm:inline-block text-xs text-muted-foreground">/</span>
          <h1 className="text-sm font-semibold tracking-tight text-foreground truncate">
            {title}
          </h1>

          {businessName && (
            <Badge
              variant="outline"
              className="hidden lg:inline-flex ml-2 text-[10px] font-normal text-muted-foreground border-border/80"
            >
              {businessName}
            </Badge>
          )}
        </div>
      </div>

      {/* Center: Global Search Bar */}
      <div className="hidden sm:flex items-center flex-1 max-w-sm mx-4">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search calls, phones, reasons..."
            className="w-full pl-8 pr-12 h-8 text-xs bg-muted/40 border-border/80 placeholder:text-muted-foreground focus:bg-background"
          />
          <kbd className="pointer-events-none absolute right-2 top-2 hidden h-4 select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground sm:flex">
            <span>⌘</span>K
          </kbd>
        </div>
      </div>

      {/* Right: Primary Call-to-action */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          onClick={onSimulate}
          disabled={simulating}
          size="sm"
          className="font-medium text-xs shadow-xs"
        >
          {simulating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <PhoneCall className="h-3.5 w-3.5" />
              <span>Simulate missed call</span>
            </>
          )}
        </Button>
      </div>
    </header>
  );
}
