'use client';

import * as React from 'react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X, AlertCircle } from 'lucide-react';

interface ChipInputProps {
  services: string[];
  onChange: (services: string[]) => void;
  maxChips?: number;
  error?: string;
}

export function ChipInput({
  services,
  onChange,
  maxChips = 20,
  error,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [inlineMsg, setInlineMsg] = useState<string | null>(null);

  const handleAdd = () => {
    const val = inputValue.trim();
    setInlineMsg(null);

    if (!val) {
      setInlineMsg('Please enter a service name.');
      return;
    }

    if (services.length >= maxChips) {
      setInlineMsg(`Maximum ${maxChips} services reached.`);
      return;
    }

    if (services.some((s) => s.toLowerCase() === val.toLowerCase())) {
      setInlineMsg(`"${val}" has already been added.`);
      return;
    }

    onChange([...services, val]);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    } else if (e.key === 'Backspace' && !inputValue && services.length > 0) {
      // Backspace on empty input removes the last chip
      onChange(services.slice(0, -1));
      setInlineMsg(null);
    } else {
      if (inlineMsg) setInlineMsg(null);
    }
  };

  const handleRemove = (index: number) => {
    onChange(services.filter((_, i) => i !== index));
    setInlineMsg(null);
  };

  return (
    <div className="space-y-3">
      {/* Input row with inline Add button and counter */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="service-chip-input" className="text-sm font-medium text-foreground">
            Add Service
          </label>
          <span className="text-xs text-muted-foreground font-mono">
            {services.length} of {maxChips}
          </span>
        </div>

        <div className="flex gap-2">
          <Input
            id="service-chip-input"
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (inlineMsg) setInlineMsg(null);
            }}
            onKeyDown={handleKeyDown}
            maxLength={80}
            placeholder="e.g. Leak repair, Emergency plumbing, Pipe inspection"
            disabled={services.length >= maxChips}
            className="text-sm h-9 flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAdd}
            disabled={services.length >= maxChips || !inputValue.trim()}
            className="h-9 px-3 text-xs font-semibold gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </Button>
        </div>

        {inlineMsg && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 animate-in fade-in">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{inlineMsg}</span>
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <p className="text-[13px] text-muted-foreground">
          Press <kbd className="px-1 py-0.5 text-[11px] font-mono rounded bg-muted border border-border">Enter</kbd> to add, or <kbd className="px-1 py-0.5 text-[11px] font-mono rounded bg-muted border border-border">Backspace</kbd> on empty input to remove the last service.
        </p>
      </div>

      {/* Chips Container */}
      <div
        className="flex flex-wrap gap-2 pt-1 min-h-[40px] p-2.5 rounded-lg bg-muted/30 border border-border/80"
        aria-label="Current services list"
      >
        {services.map((item, idx) => (
          <Badge
            key={`${item}-${idx}`}
            variant="secondary"
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-background border border-border shadow-2xs hover:border-border/80 transition-colors"
          >
            <span>{item}</span>
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              className="text-muted-foreground hover:text-destructive transition-colors ml-0.5 cursor-pointer rounded-full p-0.5"
              aria-label={`Remove service ${item}`}
              title={`Remove service ${item}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        {services.length === 0 && (
          <p className="text-xs text-muted-foreground italic py-1">
            No services added yet. Add key offerings so your voice agent can accurately assist callers.
          </p>
        )}
      </div>
    </div>
  );
}
