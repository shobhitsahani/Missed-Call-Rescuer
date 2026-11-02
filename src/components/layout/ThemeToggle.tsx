'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

interface ThemeToggleProps {
  collapsed?: boolean;
}

export function ThemeToggle({ collapsed = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!mounted) {
    return (
      <Button variant="ghost" size={collapsed ? 'icon-sm' : 'sm'} className="text-muted-foreground">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const isDark = theme === 'dark';

  return (
    <Button
      variant="ghost"
      size={collapsed ? 'icon-sm' : 'sm'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`text-muted-foreground hover:text-foreground justify-start gap-2 ${collapsed ? 'w-9 h-9 p-0 justify-center' : 'w-full'}`}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? (
        <Sun className="h-4 w-4 shrink-0 text-amber-400" />
      ) : (
        <Moon className="h-4 w-4 shrink-0 text-indigo-400" />
      )}
      {!collapsed && (
        <span className="text-xs font-medium">
          {isDark ? 'Light mode' : 'Dark mode'}
        </span>
      )}
    </Button>
  );
}
