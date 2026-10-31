'use client';

import * as React from 'react';
import { useState, useMemo } from 'react';
import { ASSEMBLYAI_VOICES, VoiceOption } from '@/lib/voices';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Play, Square, Clock, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceSelectionProps {
  selectedVoice: string;
  onSelectVoice: (id: string) => void;
  previewingVoiceId: string | null;
  cooldownVoiceId: string | null;
  cooldownSeconds: number;
  onPreviewVoice: (id: string) => void;
  error?: string;
}

export function VoiceSelection({
  selectedVoice,
  onSelectVoice,
  previewingVoiceId,
  cooldownVoiceId,
  cooldownSeconds,
  onPreviewVoice,
  error,
}: VoiceSelectionProps) {
  const [genderFilter, setGenderFilter] = useState<'all' | 'female' | 'male'>('all');
  const [expanded, setExpanded] = useState(false);

  // Filter voices by gender
  const filteredVoices = useMemo(() => {
    if (genderFilter === 'all') return ASSEMBLYAI_VOICES;
    return ASSEMBLYAI_VOICES.filter((v) => v.gender === genderFilter);
  }, [genderFilter]);

  // Determine visible voices: show first 6 if not expanded, but always include selected voice
  const visibleVoices = useMemo(() => {
    if (expanded || filteredVoices.length <= 6) {
      return filteredVoices;
    }

    const first6 = filteredVoices.slice(0, 6);
    const selectedInList = filteredVoices.find((v) => v.id === selectedVoice);

    // If selected voice is not in the first 6, ensure it's included so user never loses sight of it
    if (selectedInList && !first6.some((v) => v.id === selectedVoice)) {
      return [...first6.slice(0, 5), selectedInList];
    }

    return first6;
  }, [expanded, filteredVoices, selectedVoice]);

  return (
    <div className="space-y-4">
      {/* Header controls: Filter and Voice Counter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Filter by voice:</span>
          <ToggleGroup
            type="single"
            value={genderFilter}
            onValueChange={(val) => {
              if (val) setGenderFilter(val as 'all' | 'female' | 'male');
            }}
            className="bg-muted/50 p-0.5 rounded-lg border border-border"
          >
            <ToggleGroupItem value="all" className="h-7 px-2.5 text-xs font-medium">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="female" className="h-7 px-2.5 text-xs font-medium">
              Female
            </ToggleGroupItem>
            <ToggleGroupItem value="male" className="h-7 px-2.5 text-xs font-medium">
              Male
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Badge variant="outline" className="text-xs font-mono text-muted-foreground w-fit">
          {filteredVoices.length} voices
        </Badge>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* RadioGroup for keyboard navigation and accessible voice selection */}
      <RadioGroup
        value={selectedVoice}
        onValueChange={onSelectVoice}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5"
      >
        {visibleVoices.map((v: VoiceOption) => {
          const isSelected = selectedVoice === v.id;
          const isPlaying = previewingVoiceId === v.id;
          const isCoolingDown = cooldownVoiceId === v.id && cooldownSeconds > 0;

          return (
            <label
              key={v.id}
              htmlFor={`voice-radio-${v.id}`}
              className={cn(
                'relative p-4 rounded-xl border transition-all h-[130px] flex flex-col justify-between cursor-pointer select-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
                isSelected
                  ? 'bg-primary/5 border-primary ring-2 ring-primary shadow-xs'
                  : 'bg-card border-border hover:border-border/80 hover:bg-muted/30'
              )}
            >
              {/* Radio Group hidden item for keyboard accessibility */}
              <RadioGroupItem
                value={v.id}
                id={`voice-radio-${v.id}`}
                className="sr-only"
                aria-label={`${v.name}, ${v.gender} voice. ${v.description}`}
              />

              {/* Card Top: Name, Gender Badge, Description */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground tracking-tight">
                      {v.name}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] uppercase font-mono px-1.5 py-0 h-4"
                    >
                      {v.gender}
                    </Badge>
                  </div>
                </div>

                <p className="text-[13px] text-muted-foreground line-clamp-1 leading-snug">
                  {v.description}
                </p>
              </div>

              {/* Card Bottom: Selection indicator + Fixed Width Preview Button */}
              <div className="flex items-center justify-between pt-2 border-t border-border/50 gap-2">
                <div className="min-w-0">
                  {isSelected ? (
                    <div className="flex items-center gap-1 text-xs font-semibold text-primary">
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Selected</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">Click to select</span>
                  )}
                </div>

                {/* Reserved width w-24 to eliminate layout shifts */}
                <Button
                  type="button"
                  size="sm"
                  variant={isPlaying ? 'default' : 'outline'}
                  disabled={isCoolingDown || (previewingVoiceId !== null && !isPlaying)}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPreviewVoice(v.id);
                  }}
                  className="w-24 shrink-0 h-7 px-2 text-xs gap-1 font-medium disabled:opacity-50 justify-center"
                  title={
                    isCoolingDown
                      ? `Please wait ${cooldownSeconds}s before previewing again`
                      : isPlaying
                      ? 'Stop voice preview'
                      : 'Preview voice audio sample'
                  }
                >
                  {isPlaying ? (
                    <>
                      <Square className="h-2.5 w-2.5 fill-current animate-pulse shrink-0" />
                      <span className="truncate">Playing</span>
                    </>
                  ) : isCoolingDown ? (
                    <>
                      <Clock className="h-3 w-3 shrink-0" />
                      <span className="truncate">{cooldownSeconds}s</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-2.5 w-2.5 fill-current shrink-0" />
                      <span className="truncate">Preview</span>
                    </>
                  )}
                </Button>
              </div>
            </label>
          );
        })}
      </RadioGroup>

      {/* Show more/less expander if voice list exceeds 6 */}
      {filteredVoices.length > 6 && (
        <div className="pt-1 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground gap-1.5 h-8 font-medium"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Show fewer voices</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Show all {filteredVoices.length} voices</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
