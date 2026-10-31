'use client';

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Sidebar, DashboardView } from '@/components/Sidebar';
import { ASSEMBLYAI_VOICES, VoiceOption } from '@/lib/voices';
import { API_BASE } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Building2,
  Clock,
  Sparkles,
  Volume2,
  Play,
  Square,
  RotateCcw,
  Save,
  Plus,
  X,
  Check,
  AlertCircle,
  CheckCircle2,
  Info,
  HelpCircle,
  Loader2,
  Globe,
  Tag,
} from 'lucide-react';

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST +5:30)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT -5/-4)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT -6/-5)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT -7/-6)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT -8/-7)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST +0/+1)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST +1/+2)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST +9)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT +10/+11)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

const TONE_PRESETS = [
  'friendly, professional, concise',
  'warm, conversational, empathetic',
  'direct, efficient, authoritative',
  'calm, helpful, reassuring',
];

interface FaqItem {
  question: string;
  answer: string;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form fields
  const [name, setName] = useState('');
  const [hours, setHours] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [newServiceInput, setNewServiceInput] = useState('');
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [tone, setTone] = useState('');
  const [voice, setVoice] = useState('aai-jane');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  // Voice preview state
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [cooldownVoiceId, setCooldownVoiceId] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startVoiceCooldown = (voiceId: string, durationSec = 5) => {
    setCooldownVoiceId(voiceId);
    setCooldownSeconds(durationSec);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    let remaining = durationSec;
    cooldownTimerRef.current = setInterval(() => {
      remaining -= 1;
      setCooldownSeconds(remaining);
      if (remaining <= 0) {
        if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
        setCooldownVoiceId(null);
      }
    }, 1000);
  };

  // SSE & counts for sidebar
  const [sseConnected, setSseConnected] = useState(false);
  const [callsCount, setCallsCount] = useState(0);
  const [missedCount, setMissedCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // Load business settings
    async function fetchBusiness() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/business`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setName(data.name || '');
        setHours(data.hours || '');
        setServices(Array.isArray(data.services) ? data.services : []);
        setFaqs(Array.isArray(data.faqs) ? data.faqs : []);
        setTone(data.tone || 'friendly, professional, concise');
        setVoice(data.voice || 'aai-jane');
        setTimezone(data.timezone || 'Asia/Kolkata');
      } catch (err: any) {
        setGeneralError('Failed to load business configuration.');
      } finally {
        setLoading(false);
      }
    }

    // Load sidebar counts
    async function fetchCounts() {
      try {
        const [cRes, mRes] = await Promise.all([
          fetch(`${API_BASE}/api/calls`),
          fetch(`${API_BASE}/api/missed-calls`),
        ]);
        if (cRes.ok) {
          const cData = await cRes.json();
          setCallsCount(Array.isArray(cData) ? cData.length : 0);
        }
        if (mRes.ok) {
          const mData = await mRes.json();
          setMissedCount(Array.isArray(mData) ? mData.length : 0);
        }
      } catch {}
    }

    fetchBusiness();
    fetchCounts();

    const es = new EventSource(`${API_BASE}/api/events`);
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    return () => {
      es.close();
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
    };
  }, []);

  const handleAddService = () => {
    const trimmed = newServiceInput.trim();
    if (!trimmed) return;
    if (services.length >= 20) {
      const msg = 'Maximum 20 services allowed.';
      setErrors((prev) => ({ ...prev, services: msg }));
      toast.error(msg);
      return;
    }
    if (trimmed.length > 80) {
      const msg = 'Each service must be 80 characters or fewer.';
      setErrors((prev) => ({ ...prev, services: msg }));
      toast.error(msg);
      return;
    }
    setServices((prev) => [...prev, trimmed]);
    setNewServiceInput('');
    setErrors((prev) => {
      const copy = { ...prev };
      delete copy.services;
      return copy;
    });
  };

  const handleRemoveService = (index: number) => {
    setServices((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddFaq = () => {
    if (faqs.length >= 20) {
      const msg = 'Maximum 20 FAQs allowed.';
      setErrors((prev) => ({ ...prev, faqs: msg }));
      toast.error(msg);
      return;
    }
    setFaqs((prev) => [...prev, { question: '', answer: '' }]);
  };

  const handleUpdateFaq = (index: number, field: 'question' | 'answer', value: string) => {
    setFaqs((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveFaq = (index: number) => {
    setFaqs((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePreviewVoice = async (targetVoiceId: string) => {
    if (cooldownVoiceId === targetVoiceId && cooldownSeconds > 0) {
      toast.error(`Please wait ${cooldownSeconds}s before previewing this voice again.`);
      return;
    }

    if (previewingVoiceId) {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
      if (previewingVoiceId === targetVoiceId) {
        setPreviewingVoiceId(null);
        startVoiceCooldown(targetVoiceId, 5);
        return;
      }
    }

    setPreviewingVoiceId(targetVoiceId);
    setPreviewError(null);

    try {
      const res = await fetch(`${API_BASE}/api/business/voice-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: targetVoiceId }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson.error || `Voice preview failed (HTTP ${res.status})`;
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      activeAudioRef.current = audio;

      audio.onended = () => {
        setPreviewingVoiceId(null);
        activeAudioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        startVoiceCooldown(targetVoiceId, 5);
      };

      audio.onerror = () => {
        const errMsg = 'Failed to playback audio sample.';
        setPreviewError(errMsg);
        toast.error(errMsg);
        setPreviewingVoiceId(null);
        activeAudioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        startVoiceCooldown(targetVoiceId, 5);
      };

      await audio.play();
    } catch (err: any) {
      const errMsg = err?.message || 'Voice synthesis preview unavailable.';
      setPreviewError(errMsg);
      toast.error(errMsg);
      setPreviewingVoiceId(null);
      startVoiceCooldown(targetVoiceId, 5);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setSaveSuccessMsg(null);
    setGeneralError(null);
    setErrors({});

    // Client-side validations
    const trimmedName = name.trim();
    if (!trimmedName) {
      const msg = 'Business name is required.';
      setErrors({ name: msg });
      setGeneralError(msg);
      toast.error(msg);
      setSaving(false);
      return;
    }

    const cleanServices = services.map((s) => s.trim()).filter(Boolean);
    const cleanFaqs = faqs.map((f) => ({
      question: f.question.trim(),
      answer: f.answer.trim(),
    }));

    // Filter out completely blank FAQs or validate incomplete ones
    for (let i = 0; i < cleanFaqs.length; i++) {
      const f = cleanFaqs[i];
      if (!f.question && !f.answer) {
        continue; // skip empty rows
      }
      if (!f.question || !f.answer) {
        const msg = `FAQ #${i + 1} must have both a question and an answer.`;
        setErrors({ faqs: msg });
        setGeneralError(msg);
        toast.error(msg);
        setSaving(false);
        return;
      }
    }

    const validFaqs = cleanFaqs.filter((f) => f.question && f.answer);

    try {
      const res = await fetch(`${API_BASE}/api/business`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          hours: hours.trim(),
          services: cleanServices,
          faqs: validFaqs,
          tone: tone.trim(),
          voice,
          timezone,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data?.errors) {
          setErrors(data.errors);
          const firstErr = Object.values(data.errors)[0] as string;
          setGeneralError(firstErr);
          toast.error(firstErr);
        } else {
          const msg = data?.error || `Save failed (HTTP ${res.status})`;
          setGeneralError(msg);
          toast.error(msg);
        }
      } else {
        const msg = 'Business settings saved successfully.';
        setSaveSuccessMsg(msg);
        toast.success(msg);
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      const msg = err?.message || 'Network error while saving settings.';
      setGeneralError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    setResetting(true);
    setGeneralError(null);
    setErrors({});

    try {
      const res = await fetch(`${API_BASE}/api/business/reset`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error || 'Failed to reset settings.';
        setGeneralError(msg);
        toast.error(msg);
      } else {
        const b = data.business;
        setName(b.name || '');
        setHours(b.hours || '');
        setServices(Array.isArray(b.services) ? b.services : []);
        setFaqs(Array.isArray(b.faqs) ? b.faqs : []);
        setTone(b.tone || 'friendly, professional, concise');
        setVoice(b.voice || 'aai-jane');
        setTimezone(b.timezone || 'Asia/Kolkata');
        setShowResetConfirm(false);
        const msg = 'Settings reset to Acme Plumbing defaults.';
        setSaveSuccessMsg(msg);
        toast.success(msg);
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      const msg = err?.message || 'Network error while resetting.';
      setGeneralError(msg);
      toast.error(msg);
    } finally {
      setResetting(false);
    }
  };

  const handleSidebarNav = (view: DashboardView) => {
    if (view === 'settings') return;
    if (view === 'overview') window.location.href = '/';
    else window.location.href = `/?tab=${view}`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row antialiased selection:bg-primary/20 selection:text-primary">
      <Sidebar
        currentView="settings"
        onChangeView={handleSidebarNav}
        callsCount={callsCount}
        missedCount={missedCount}
        sseConnected={sseConnected}
        businessName={name || 'Acme Plumbing'}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        onOpenDemoSettings={() => {}}
      />

      <main className="flex-1 overflow-y-auto max-w-4xl px-4 py-8 md:px-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Business Settings</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Configure how your voice agent answers, speaks, and represents your company.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 flex items-center justify-center">
              <ThemeToggle collapsed={true} />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResetConfirm(true)}
              disabled={loading || saving}
              className="h-8 text-xs font-medium gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </Button>
            <Button
              size="sm"
              onClick={() => handleSave()}
              disabled={loading || saving}
              className="h-8 text-xs font-semibold gap-1.5 shadow-xs"
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

        {/* Live Call Behavior Notice */}
        <div className="rounded-lg bg-primary/10 border border-primary/20 p-3.5 flex items-start gap-3 text-xs text-foreground shadow-xs">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-primary">Changes apply to new calls only</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              The agent greeting, voice synthesis, and knowledge base are loaded at the moment a call starts. Any call currently in progress will complete with its starting configuration.
            </p>
          </div>
        </div>

        {/* Status Banners */}
        {saveSuccessMsg && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-foreground flex items-center gap-2 animate-in fade-in duration-200">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{saveSuccessMsg}</span>
          </div>
        )}

        {generalError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive flex items-center gap-2 animate-in fade-in duration-200">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <span className="font-medium">{generalError}</span>
          </div>
        )}

        {previewError && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2 animate-in fade-in duration-200">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span>{previewError}</span>
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-xs text-muted-foreground space-y-2">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
            <p>Loading configuration...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* General Information Card */}
            <Card>
              <CardHeader className="p-5 pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Building2 className="h-4 w-4 text-primary" />
                  General Information
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Core identity and operating profile of your business.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Business Name */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="biz-name" className="text-xs font-medium text-foreground">
                        Business Name <span className="text-primary">*</span>
                      </label>
                      <span className="text-[10px] text-muted-foreground font-mono">{name.length}/100</span>
                    </div>
                    <Input
                      id="biz-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                      placeholder="e.g. Acme Plumbing"
                      className={`text-xs h-9 ${errors.name ? 'border-destructive' : ''}`}
                    />
                    {errors.name && <p className="text-[11px] text-destructive">{errors.name}</p>}
                    <p className="text-[11px] text-muted-foreground">
                      Spoken directly in the automated greeting (&quot;calling on behalf of {name || '...'}&quot;).
                    </p>
                  </div>

                  {/* Timezone */}
                  <div className="space-y-1.5">
                    <label htmlFor="biz-timezone" className="text-xs font-medium text-foreground">
                      Business Timezone <span className="text-primary">*</span>
                    </label>
                    <select
                      id="biz-timezone"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-md bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 h-9 ${
                        errors.timezone ? 'border-destructive' : ''
                      }`}
                    >
                      {TIMEZONE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-popover text-popover-foreground">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {errors.timezone && <p className="text-[11px] text-destructive">{errors.timezone}</p>}
                    <p className="text-[11px] text-muted-foreground">
                      Used to accurately interpret customer callback dates (&quot;tomorrow&quot;, &quot;Monday morning&quot;).
                    </p>
                  </div>
                </div>

                {/* Operating Hours */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="biz-hours" className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span>Opening Hours</span>
                    </label>
                    <span className="text-[10px] text-muted-foreground font-mono">{hours.length}/200</span>
                  </div>
                  <Input
                    id="biz-hours"
                    type="text"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Mon-Fri 8am-6pm, Sat 9am-1pm"
                    className={`text-xs h-9 ${errors.hours ? 'border-destructive' : ''}`}
                  />
                  {errors.hours && <p className="text-[11px] text-destructive">{errors.hours}</p>}
                </div>

                {/* Tone */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="biz-tone" className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-muted-foreground" />
                      <span>Voice Agent Tone</span>
                    </label>
                    <span className="text-[10px] text-muted-foreground font-mono">{tone.length}/100</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TONE_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        variant={tone === preset ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTone(preset)}
                        className="h-6 text-[11px] px-2.5 rounded-full font-normal"
                      >
                        {preset}
                      </Button>
                    ))}
                  </div>
                  <Input
                    id="biz-tone"
                    type="text"
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    maxLength={100}
                    placeholder="Custom tone instructions (e.g. friendly, concise, professional)"
                    className="text-xs h-9"
                  />
                </div>

                {/* Language (Disabled per specification) */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Globe className="h-3 w-3" />
                    <span>Agent Language</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="text"
                      disabled
                      value="English (en)"
                      className="w-48 text-xs h-9 bg-muted/50 cursor-not-allowed opacity-70"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      English only for now (multilingual models coming soon).
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Voice Selection & Preview Card */}
            <Card>
              <CardHeader className="p-5 pb-3 border-b border-border flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <Volume2 className="h-4 w-4 text-primary" />
                    Voice &amp; Speech Synthesis
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Select the AssemblyAI neural voice for streaming text-to-speech.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs font-mono shrink-0">
                  {ASSEMBLYAI_VOICES.length} voices available
                </Badge>
              </CardHeader>

              <CardContent className="p-5 space-y-4">
                {errors.voice && <p className="text-xs text-destructive">{errors.voice}</p>}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ASSEMBLYAI_VOICES.map((v: VoiceOption) => {
                    const isSelected = voice === v.id;
                    const isPlaying = previewingVoiceId === v.id;
                    const isCoolingDown = cooldownVoiceId === v.id && cooldownSeconds > 0;
                    return (
                      <div
                        key={v.id}
                        onClick={() => setVoice(v.id)}
                        className={`relative p-3.5 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-primary/5 border-primary ring-1 ring-primary shadow-xs'
                            : 'bg-card border-border hover:border-border/80 hover:bg-muted/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-foreground">{v.name}</span>
                              <Badge variant="secondary" className="text-[9px] uppercase font-mono px-1.5 py-0">
                                {v.gender}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-tight">
                              {v.description}
                            </p>
                          </div>

                          <Button
                            type="button"
                            size="sm"
                            variant={isPlaying ? 'default' : 'outline'}
                            disabled={isCoolingDown || (previewingVoiceId !== null && !isPlaying)}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreviewVoice(v.id);
                            }}
                            className="shrink-0 h-7 px-2 text-[11px] gap-1 font-medium disabled:opacity-50"
                            title={
                              isCoolingDown
                                ? `Please wait ${cooldownSeconds}s before previewing again`
                                : isPlaying
                                ? 'Stop audio preview'
                                : 'Preview voice audio sample'
                            }
                          >
                            {isPlaying ? (
                              <>
                                <Square className="h-2.5 w-2.5 fill-current animate-pulse" />
                                <span>Playing</span>
                              </>
                            ) : isCoolingDown ? (
                              <>
                                <Clock className="h-2.5 w-2.5" />
                                <span>Wait {cooldownSeconds}s</span>
                              </>
                            ) : (
                              <>
                                <Play className="h-2.5 w-2.5 fill-current" />
                                <span>Preview</span>
                              </>
                            )}
                          </Button>
                        </div>

                        {isSelected && (
                          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-primary font-medium">
                            <Check className="h-3.5 w-3.5" />
                            <span>Selected voice</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Offered Services Card */}
            <Card>
              <CardHeader className="p-5 pb-3 border-b border-border flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <Tag className="h-4 w-4 text-primary" />
                    Offered Services
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Services your AI agent knows your business provides (max 20).
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs font-mono shrink-0">
                  {services.length} / 20
                </Badge>
              </CardHeader>

              <CardContent className="p-5 space-y-4">
                {errors.services && <p className="text-xs text-destructive">{errors.services}</p>}

                {/* Tag Input */}
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newServiceInput}
                    onChange={(e) => setNewServiceInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddService();
                      }
                    }}
                    maxLength={80}
                    placeholder="e.g. Water heater installation (press Enter)"
                    disabled={services.length >= 20}
                    className="text-xs h-9 flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAddService}
                    disabled={services.length >= 20 || !newServiceInput.trim()}
                    className="h-9 text-xs gap-1 font-medium"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add service</span>
                  </Button>
                </div>

                {/* Services Chip List */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {services.map((item, idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-normal"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveService(idx)}
                        className="text-muted-foreground hover:text-destructive transition-colors ml-0.5 cursor-pointer"
                        title="Remove service"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {services.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No services listed yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* FAQs Card */}
            <Card>
              <CardHeader className="p-5 pb-3 border-b border-border flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <HelpCircle className="h-4 w-4 text-primary" />
                    Frequently Asked Questions
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Predefined Q&amp;As the voice agent consults during customer conversations (max 20).
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs font-mono shrink-0">
                  {faqs.length} / 20
                </Badge>
              </CardHeader>

              <CardContent className="p-5 space-y-4">
                {errors.faqs && <p className="text-xs text-destructive">{errors.faqs}</p>}

                <div className="space-y-3">
                  {faqs.map((faq, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-2.5 relative group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                          FAQ #{idx + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveFaq(idx)}
                          className="h-6 text-xs text-muted-foreground hover:text-destructive p-1"
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          <span>Remove</span>
                        </Button>
                      </div>

                      <div className="space-y-1">
                        <Input
                          type="text"
                          value={faq.question}
                          onChange={(e) => handleUpdateFaq(idx, 'question', e.target.value)}
                          maxLength={120}
                          placeholder="Question (e.g. Do you offer 24/7 emergency service?)"
                          className="text-xs h-8 bg-card"
                        />
                      </div>

                      <div className="space-y-1">
                        <Textarea
                          value={faq.answer}
                          onChange={(e) => handleUpdateFaq(idx, 'answer', e.target.value)}
                          maxLength={250}
                          rows={2}
                          placeholder="Answer (e.g. Yes, we are available 24/7 for urgent plumbing calls.)"
                          className="text-xs bg-card resize-none"
                        />
                      </div>
                    </div>
                  ))}

                  {faqs.length === 0 && (
                    <p className="text-xs text-muted-foreground italic py-2">No FAQs added yet.</p>
                  )}
                </div>

                {faqs.length < 20 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddFaq}
                    className="text-xs gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add question &amp; answer</span>
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Bottom Actions Sticky Floating Bar */}
            <div className="sticky bottom-4 z-20 rounded-xl bg-card/95 backdrop-blur-md border border-border p-3.5 flex items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-2 text-xs min-w-0">
                {saveSuccessMsg && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium truncate animate-in fade-in">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="truncate">{saveSuccessMsg}</span>
                  </span>
                )}
                {generalError && (
                  <span className="inline-flex items-center gap-1.5 text-destructive font-medium truncate animate-in fade-in">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <span className="truncate">{generalError}</span>
                  </span>
                )}
                {!saveSuccessMsg && !generalError && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    Changes take effect on new incoming calls.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={loading || saving}
                  className="h-8 text-xs font-medium gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset</span>
                </Button>
                <Button
                  type="submit"
                  disabled={loading || saving}
                  className="h-8 text-xs font-semibold gap-1.5 shadow-sm px-4"
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
          </form>
        )}
      </main>

      {/* Confirmation Dialog for Reset */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Reset all settings to default?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
              This will restore the business name to <strong className="text-foreground">Acme Plumbing</strong>, default opening hours, standard plumbing services, FAQs, and the <strong className="text-foreground">Jane</strong> neural voice. Custom modifications will be replaced.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowResetConfirm(false)}
              disabled={resetting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleResetToDefault}
              disabled={resetting}
              className="text-xs font-semibold"
            >
              {resetting ? 'Resetting...' : 'Yes, reset to defaults'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
