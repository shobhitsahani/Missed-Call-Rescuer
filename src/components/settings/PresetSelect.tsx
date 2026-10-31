import * as React from 'react';
import { Sparkles } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BUSINESS_PRESETS, BusinessPreset } from '@/lib/presets';

interface PresetSelectProps {
  onSelectPreset: (preset: BusinessPreset) => void;
  className?: string;
}

export function PresetSelect({ onSelectPreset, className }: PresetSelectProps) {
  const presetsList = Object.entries(BUSINESS_PRESETS);

  return (
    <div className={className}>
      <Select
        value=""
        onValueChange={(key) => {
          if (BUSINESS_PRESETS[key]) {
            onSelectPreset(BUSINESS_PRESETS[key]);
          }
        }}
      >
        <SelectTrigger className="h-8 text-xs font-medium w-[220px] bg-muted/40 hover:bg-muted border-border/80 text-foreground gap-2">
          <div className="flex items-center gap-1.5 truncate">
            <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
            <SelectValue placeholder="Start from a preset..." />
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="w-[300px]">
          <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">
            Industry Templates
          </div>
          {presetsList.map(([key, preset]) => (
            <SelectItem key={key} value={key} className="py-2 cursor-pointer">
              <div className="space-y-0.5 text-left">
                <p className="text-xs font-semibold text-foreground">{preset.label}</p>
                <p className="text-[11px] text-muted-foreground line-clamp-1">
                  {preset.description}
                </p>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
