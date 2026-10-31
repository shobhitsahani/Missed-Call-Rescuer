'use client';

import * as React from 'react';
import { Search, PhoneCall, Loader2, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { Logomark } from './Logomark';
import { usePlatform } from '@/lib/platform';

interface TopBarProps {
  title: string;
  businessName?: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSimulate: () => void;
  simulating: boolean;
  onOpenMobileMenu?: () => void;
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
  const { platform, mounted } = usePlatform();

  // Keyboard shortcut: Command+K on macOS, Ctrl+K on Windows/Linux (disabled on touch)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k') return;

      const isMac = platform === 'mac';
      const isSearchModifier = isMac
        ? e.metaKey && !e.ctrlKey && !e.altKey
        : e.ctrlKey && !e.metaKey && !e.altKey;

      if (!isSearchModifier) return;

      // Prevent browser default URL focus / shortcut
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [platform]);

  const isMac = platform === 'mac';
  const ariaKeyShortcuts = mounted
    ? platform === 'touch'
      ? undefined
      : isMac
      ? 'Meta+K'
      : 'Control+K'
    : undefined;

  const accessibleSearchLabel = mounted
    ? platform === 'touch'
      ? 'Search calls, phones, reasons'
      : `Search, shortcut ${isMac ? 'Command' : 'Control'} K`
    : 'Search calls, phones, reasons';

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
            aria-label={accessibleSearchLabel}
            aria-keyshortcuts={ariaKeyShortcuts}
            className="w-full pl-8 pr-14 h-8 text-xs bg-muted/40 border-border/80 placeholder:text-muted-foreground focus:bg-background"
          />
          <div className="absolute right-2 top-2 hidden sm:flex items-center pointer-events-none">
            <Kbd shortcutKey="K" actionName="Search" />
          </div>
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
