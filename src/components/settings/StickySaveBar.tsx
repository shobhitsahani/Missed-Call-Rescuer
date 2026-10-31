'use client';

import * as React from 'react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { RotateCcw, Save, Loader2, CheckCircle2 } from 'lucide-react';

interface StickySaveBarProps {
  isDirty: boolean;
  saving: boolean;
  saveSuccess: boolean;
  onSave: () => void;
  onReset: () => void;
}

export function StickySaveBar({
  isDirty,
  saving,
  saveSuccess,
  onSave,
  onReset,
}: StickySaveBarProps) {
  // Global shortcut: Command+S on macOS, Ctrl+S on Windows/Linux
  useEffect(() => {
    if (!isDirty) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, onSave]);

  if (!isDirty && !saving && !saveSuccess) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Unsaved changes bar"
      className="fixed bottom-6 left-0 right-0 z-40 px-4 pointer-events-none animate-in fade-in slide-in-from-bottom-3 duration-200"
    >
      <div className="max-w-5xl mx-auto pointer-events-auto">
        <div className="rounded-xl bg-card/95 backdrop-blur-md border border-border p-3.5 sm:px-5 flex items-center justify-between gap-4 shadow-xl ring-1 ring-border/50">
          <div className="flex items-center gap-2.5 min-w-0">
            {saveSuccess ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <span
                className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0"
                aria-hidden="true"
              />
            )}
            <span className="text-xs font-semibold text-foreground truncate">
              {saveSuccess ? 'Changes saved successfully' : 'You have unsaved changes'}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              — remember to save or use <Kbd shortcutKey="S" actionName="Save changes" />
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={saving}
              className="h-8 text-xs font-medium gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="h-8 text-xs font-semibold gap-1.5 shadow-xs px-4"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Save changes</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
