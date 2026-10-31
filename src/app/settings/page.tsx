'use client';

import * as React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar, DashboardView } from '@/components/Sidebar';
import { ASSEMBLYAI_VOICES, VoiceOption } from '@/lib/voices';
import { API_BASE } from '@/lib/api';
import { BUSINESS_PRESETS, BusinessPreset, checkExampleMismatch } from '@/lib/presets';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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

interface SavedBaseline {
  name: string;
  hours: string;
  services: string[];
  faqs: FaqItem[];
  tone: string;
  voice: string;
  timezone: string;
}

const SECTIONS = [
  { id: 'section-general', label: 'General', icon: Building2 },
  { id: 'section-voice', label: 'Voice & Speech', icon: Volume2 },
  { id: 'section-services', label: 'Services', icon: Tag },
  { id: 'section-faqs', label: 'FAQs', icon: HelpCircle },
];

const STORAGE_KEY_NOTICE = 'mcr_settings_notice_dismissed';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPresetConfirm, setShowPresetConfirm] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<BusinessPreset | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Active in-page section for sticky nav
  const [activeSection, setActiveSection] = useState('section-general');

  // Dismissible notice banner state via useSyncExternalStore

  // Form fields
  const [name, setName] = useState('');
  const [hours, setHours] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [newServiceInput, setNewServiceInput] = useState('');
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [tone, setTone] = useState('');
  const [voice, setVoice] = useState('aai-jane');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  // Saved baseline for dirty detection
  const [baseline, setBaseline] = useState<SavedBaseline | null>(null);

  const exampleMismatch = checkExampleMismatch(name, services, faqs, hours);

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

  // Check notice dismissal from localStorage safely without cascading renders
  const noticeDismissed = React.useSyncExternalStore(
    (cb) => {
      window.addEventListener('storage', cb);
      return () => window.removeEventListener('storage', cb);
    },
    () => {
      try {
        return localStorage.getItem(STORAGE_KEY_NOTICE) === 'true';
      } catch {
        return false;
      }
    },
    () => false
  );

  const handleDismissNotice = () => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTICE, 'true');
      window.dispatchEvent(new Event('storage'));
    } catch {
      // ignore localStorage exceptions
    }
  };

  // Dirty detection comparing current inputs to saved baseline
  const isDirty = useMemo(() => {
    if (!baseline) return false;
    if (name !== baseline.name) return true;
    if (hours !== baseline.hours) return true;
    if (tone !== baseline.tone) return true;
    if (voice !== baseline.voice) return true;
    if (timezone !== baseline.timezone) return true;
    if (services.length !== baseline.services.length) return true;
    for (let i = 0; i < services.length; i++) {
      if (services[i] !== baseline.services[i]) return true;
    }
    if (faqs.length !== baseline.faqs.length) return true;
    for (let i = 0; i < faqs.length; i++) {
      if (
        faqs[i].question !== baseline.faqs[i].question ||
        faqs[i].answer !== baseline.faqs[i].answer
      ) {
        return true;
      }
    }
    return false;
  }, [baseline, name, hours, tone, voice, timezone, services, faqs]);

  // Warn before navigating away if form has unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Load business settings
  useEffect(() => {
    async function fetchBusiness() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/business`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const loadedName = data.name || '';
        const loadedHours = data.hours || '';
        const loadedServices = Array.isArray(data.services) ? data.services : [];
        const loadedFaqs = Array.isArray(data.faqs) ? data.faqs : [];
        const loadedTone = data.tone || 'friendly, professional, concise';
        const loadedVoice = data.voice || 'aai-jane';
        const loadedTimezone = data.timezone || 'Asia/Kolkata';

        setName(loadedName);
        setHours(loadedHours);
        setServices(loadedServices);
        setFaqs(loadedFaqs);
        setTone(loadedTone);
        setVoice(loadedVoice);
        setTimezone(loadedTimezone);

        setBaseline({
          name: loadedName,
          hours: loadedHours,
          services: loadedServices,
          faqs: loadedFaqs,
          tone: loadedTone,
          voice: loadedVoice,
          timezone: loadedTimezone,
        });
      } catch (err: any) {
        setGeneralError('Failed to load business settings. Check server connection.');
      } finally {
        setLoading(false);
      }
    }

    fetchBusiness();
  }, []);

  // Subscribe to SSE for sidebar sync
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`);
    es.onopen = () => setSseConnected(true);
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init' && msg.data) {
          if (Array.isArray(msg.data.calls)) setCallsCount(msg.data.calls.length);
          if (Array.isArray(msg.data.missed)) setMissedCount(msg.data.missed.length);
        } else if (msg.type === 'call_created') {
          setCallsCount((c) => c + 1);
        } else if (msg.type === 'missed_created') {
          setMissedCount((c) => c + 1);
        }
      } catch {
        // ignore parse error
      }
    };
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

  // IntersectionObserver to highlight section in view
  useEffect(() => {
    if (loading) return;

    const sectionIds = ['section-general', 'section-voice', 'section-services', 'section-faqs'];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          setActiveSection(visible[0].target.id);
        }
      },
      {
        rootMargin: '-80px 0px -40% 0px',
        threshold: [0, 0.2, 0.5],
      }
    );

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [loading]);

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (!el) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    el.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    setActiveSection(sectionId);
  };

  const handlePresetClick = (preset: BusinessPreset) => {
    const differs =
      !baseline ||
      name !== preset.name ||
      hours !== preset.hours ||
      voice !== preset.voice ||
      services.length !== preset.services.length;

    if (isDirty || differs) {
      setPendingPreset(preset);
      setShowPresetConfirm(true);
    } else {
      handleApplyPreset(preset);
    }
  };

  const handleApplyPreset = (preset: BusinessPreset) => {
    setName(preset.name);
    setHours(preset.hours);
    setServices([...preset.services]);
    setFaqs(preset.faqs.map((f) => ({ ...f })));
    setTone(preset.tone);
    setVoice(preset.voice);
    setTimezone(preset.timezone);
    setShowPresetConfirm(false);
    setPendingPreset(null);
    toast.success(`Loaded preset: ${preset.label}`);
  };

  const handleAddService = () => {
    const val = newServiceInput.trim();
    if (!val) return;
    if (services.length >= 20) {
      toast.error('Maximum 20 services allowed.');
      return;
    }
    if (services.includes(val)) {
      toast.error('Service already added.');
      return;
    }
    setServices([...services, val]);
    setNewServiceInput('');
  };

  const handleRemoveService = (index: number) => {
    setServices(services.filter((_, i) => i !== index));
  };

  const handleAddFaq = () => {
    if (faqs.length >= 20) {
      toast.error('Maximum 20 FAQs allowed.');
      return;
    }
    setFaqs([...faqs, { question: '', answer: '' }]);
  };

  const handleRemoveFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  const handleUpdateFaq = (index: number, field: 'question' | 'answer', value: string) => {
    const next = [...faqs];
    next[index] = { ...next[index], [field]: value };
    setFaqs(next);
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

    for (let i = 0; i < cleanFaqs.length; i++) {
      const f = cleanFaqs[i];
      if (!f.question && !f.answer) continue;
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
        setBaseline({
          name: trimmedName,
          hours: hours.trim(),
          services: cleanServices,
          faqs: validFaqs,
          tone: tone.trim(),
          voice,
          timezone,
        });
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
        const defName = b.name || '';
        const defHours = b.hours || '';
        const defServices = Array.isArray(b.services) ? b.services : [];
        const defFaqs = Array.isArray(b.faqs) ? b.faqs : [];
        const defTone = b.tone || 'friendly, professional, concise';
        const defVoice = b.voice || 'aai-jane';
        const defTimezone = b.timezone || 'Asia/Kolkata';

        setName(defName);
        setHours(defHours);
        setServices(defServices);
        setFaqs(defFaqs);
        setTone(defTone);
        setVoice(defVoice);
        setTimezone(defTimezone);

        setBaseline({
          name: defName,
          hours: defHours,
          services: defServices,
          faqs: defFaqs,
          tone: defTone,
          voice: defVoice,
          timezone: defTimezone,
        });

        setShowResetConfirm(false);
        const msg = 'Settings reset to Example: Acme Plumbing defaults.';
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
        businessName={name || 'Business'}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        onOpenDemoSettings={() => {}}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 w-full min-w-0">
          <PageContainer size="default">
            {/* Header: Title and description on the left (no duplicate buttons) */}
            <div className="pb-5 border-b border-border">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Business Settings</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Configure how your voice agent answers, speaks, and represents your company.
              </p>
            </div>

            {/* Live Call Behavior Notice: Slim & Dismissible */}
            {!noticeDismissed && (
              <div className="mt-4 rounded-lg bg-primary/10 border border-primary/20 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs text-foreground shadow-xs animate-in fade-in duration-200">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Info className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-xs text-foreground truncate">
                    <strong className="text-primary font-semibold mr-1">Changes apply to new calls only:</strong>
                    Active calls in progress continue using their starting configuration.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDismissNotice}
                  aria-label="Dismiss notice"
                  className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded hover:bg-primary/15 transition-colors cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Status Messages */}
            {saveSuccessMsg && (
              <div className="mt-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-foreground flex items-center gap-2 animate-in fade-in duration-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="font-medium text-emerald-600 dark:text-emerald-400">{saveSuccessMsg}</span>
              </div>
            )}

            {generalError && (
              <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive flex items-center gap-2 animate-in fade-in duration-200">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <span className="font-medium">{generalError}</span>
              </div>
            )}

            {previewError && (
              <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2 animate-in fade-in duration-200">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <span>{previewError}</span>
              </div>
            )}

            {loading ? (
              <div className="py-24 text-center text-xs text-muted-foreground space-y-2">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                <p>Loading configuration...</p>
              </div>
            ) : (
              /* Two-column layout on xl: Sticky Section Nav (left) + Form Sections (right) */
              <div className="xl:flex xl:items-start xl:gap-8 mt-6">
                {/* Left: Sticky In-Page Section Navigation (xl and up) */}
                <aside className="hidden xl:block w-52 shrink-0">
                  <div className="sticky top-8 space-y-1">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2 font-mono">
                      On This Page
                    </p>
                    <nav aria-label="Settings section navigation" className="space-y-1">
                      {SECTIONS.map((sec) => {
                        const Icon = sec.icon;
                        const isActive = activeSection === sec.id;
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => scrollToSection(sec.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              isActive
                                ? 'bg-primary/10 text-primary font-semibold shadow-xs'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                          >
                            <Icon
                              className={`h-3.5 w-3.5 shrink-0 ${
                                isActive ? 'text-primary' : 'text-muted-foreground'
                              }`}
                            />
                            <span>{sec.label}</span>
                          </button>
                        );
                      })}
                    </nav>
                  </div>
                </aside>

                {/* Right: Main Form Column (max-w-3xl below xl, full flex-1 on xl) */}
                <div className="flex-1 min-w-0 max-w-3xl xl:max-w-none mx-auto xl:mx-0">
                  <form onSubmit={handleSave} className="space-y-6 pb-28">
                    {/* Compact Presets Row */}
                    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-card border border-border shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground shrink-0 mr-1">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        <span>Quick presets:</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                        {Object.values(BUSINESS_PRESETS).map((preset) => (
                          <Button
                            key={preset.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handlePresetClick(preset)}
                            className="h-7 text-xs px-2.5 py-0 font-medium hover:border-primary/50"
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Example Mismatch Warning Hint */}
                    {exampleMismatch.hasMismatch && (
                      <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-3 animate-in fade-in">
                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="space-y-1.5 flex-1">
                          <p className="font-semibold text-amber-900 dark:text-amber-200">
                            These still match the example business, review them.
                          </p>
                          <p className="text-[11px] text-amber-800/90 dark:text-amber-300 leading-relaxed">
                            You changed the business name to &quot;{name}&quot;, but your{' '}
                            {exampleMismatch.servicesMatch ? 'services' : ''}
                            {exampleMismatch.servicesMatch && exampleMismatch.faqsMatch ? ', ' : ''}
                            {exampleMismatch.faqsMatch ? 'FAQs' : ''}
                            {(exampleMismatch.servicesMatch || exampleMismatch.faqsMatch) &&
                            exampleMismatch.hoursMatch
                              ? ', and '
                              : ''}
                            {exampleMismatch.hoursMatch ? 'operating hours' : ''}{' '}
                            still match the Example: Acme Plumbing preset. Review them so your voice agent does not mention plumbing services.
                          </p>
                          <div className="pt-1 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setServices([]);
                                setFaqs([]);
                                toast.info('Example services and FAQs cleared. Add your business services below.');
                              }}
                              className="h-6 text-[11px] px-2.5 bg-background border-amber-500/40 hover:bg-amber-500/10 text-amber-950 dark:text-amber-100"
                            >
                              Clear example services &amp; FAQs
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 1. General Information Card */}
                    <Card id="section-general" className="scroll-mt-24">
                      <CardHeader className="p-6 pb-4 border-b border-border">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                          <Building2 className="h-4 w-4 text-primary" />
                          General Information
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground mt-0.5">
                          Core identity and operating profile of your business.
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="p-6 space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                              placeholder="e.g. Acme Plumbing, team flow, or your company"
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
                            placeholder="e.g. Mon-Fri 8am-6pm, Sat 9am-2pm, Closed Sun"
                            className="text-xs h-9"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Agent checks this to confirm appointments during operating hours.
                          </p>
                        </div>

                        {/* Tone of Voice */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label htmlFor="biz-tone" className="text-xs font-medium text-foreground">
                              Tone of Voice
                            </label>
                            <span className="text-[10px] text-muted-foreground font-mono">{tone.length}/100</span>
                          </div>
                          <Input
                            id="biz-tone"
                            type="text"
                            value={tone}
                            onChange={(e) => setTone(e.target.value)}
                            maxLength={100}
                            placeholder="e.g. friendly, professional, concise"
                            className="text-xs h-9"
                          />
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {TONE_PRESETS.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setTone(t)}
                                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                                  tone === t
                                    ? 'bg-primary/10 border-primary text-primary font-medium'
                                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                                }`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Language */}
                        <div className="space-y-1.5">
                          <label htmlFor="biz-lang" className="text-xs font-medium text-muted-foreground">
                            Conversation Language
                          </label>
                          <Input
                            id="biz-lang"
                            type="text"
                            value="English (en-US)"
                            disabled
                            className="text-xs h-9 bg-muted/30 text-muted-foreground cursor-not-allowed"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Additional languages will be available in upcoming releases.
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 2. Voice & Speech Card */}
                    <Card id="section-voice" className="scroll-mt-24">
                      <CardHeader className="p-6 pb-4 border-b border-border flex flex-row items-center justify-between gap-4">
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

                      <CardContent className="p-6 space-y-4">
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
                                className={`relative p-4 rounded-lg border cursor-pointer transition-all h-full flex flex-col justify-between ${
                                  isSelected
                                    ? 'bg-primary/5 border-primary ring-2 ring-primary shadow-xs'
                                    : 'bg-card border-border hover:border-border/80 hover:bg-muted/30'
                                }`}
                              >
                                <div>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-bold text-foreground">{v.name}</span>
                                      <Badge variant="secondary" className="text-[9px] uppercase font-mono px-1.5 py-0">
                                        {v.gender}
                                      </Badge>
                                    </div>

                                    {/* Preview button with fixed width w-24 to prevent layout shifts */}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isPlaying ? 'default' : 'outline'}
                                      disabled={isCoolingDown || (previewingVoiceId !== null && !isPlaying)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePreviewVoice(v.id);
                                      }}
                                      className="w-24 shrink-0 h-7 px-2 text-[11px] gap-1 font-medium disabled:opacity-50 justify-center"
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
                                          <Square className="h-2.5 w-2.5 fill-current animate-pulse shrink-0" />
                                          <span className="truncate">Playing</span>
                                        </>
                                      ) : isCoolingDown ? (
                                        <>
                                          <Clock className="h-2.5 w-2.5 shrink-0" />
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

                                  <p className="text-[11px] text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
                                    {v.description}
                                  </p>
                                </div>

                                {isSelected && (
                                  <div className="mt-3 pt-2 border-t border-primary/20 flex items-center gap-1.5 text-[11px] text-primary font-medium">
                                    <Check className="h-3.5 w-3.5 shrink-0" />
                                    <span>Selected voice</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>

                    {/* 3. Offered Services Card */}
                    <Card id="section-services" className="scroll-mt-24">
                      <CardHeader className="p-6 pb-4 border-b border-border flex flex-row items-center justify-between gap-4">
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

                      <CardContent className="p-6 space-y-4">
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
                            placeholder="e.g. Consultation, Repair, or Project review (press Enter)"
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
                              key={`${item}-${idx}`}
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

                    {/* 4. FAQs Card */}
                    <Card id="section-faqs" className="scroll-mt-24">
                      <CardHeader className="p-6 pb-4 border-b border-border flex flex-row items-center justify-between gap-4">
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

                      <CardContent className="p-6 space-y-4">
                        {errors.faqs && <p className="text-xs text-destructive">{errors.faqs}</p>}

                        <div className="space-y-3">
                          {faqs.map((faq, idx) => (
                            <div
                              key={idx}
                              className="p-4 rounded-lg bg-muted/40 border border-border space-y-2.5 relative group"
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
                                  value={faq.question ?? ''}
                                  onChange={(e) => handleUpdateFaq(idx, 'question', e.target.value)}
                                  maxLength={120}
                                  placeholder="Question (e.g. Do you offer emergency service?)"
                                  className="text-xs h-8 bg-card"
                                />
                              </div>

                              <div className="space-y-1">
                                <Textarea
                                  value={faq.answer ?? ''}
                                  onChange={(e) => handleUpdateFaq(idx, 'answer', e.target.value)}
                                  maxLength={250}
                                  rows={2}
                                  placeholder="Answer (e.g. Yes, our team is available for urgent inquiries.)"
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
                  </form>
                </div>
              </div>
            )}
          </PageContainer>
        </main>
      </div>

      {/* Sticky Action Bar: Only appears when there are unsaved changes */}
      {isDirty && (
        <div
          role="region"
          aria-label="Unsaved changes action bar"
          className="fixed bottom-6 left-0 right-0 z-40 px-4 pointer-events-none animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          <div className="max-w-5xl mx-auto pointer-events-auto">
            <div className="rounded-xl bg-card/95 backdrop-blur-md border border-border p-3.5 sm:px-5 flex items-center justify-between gap-4 shadow-xl ring-1 ring-border/50">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold text-foreground truncate">
                  You have unsaved changes
                </span>
                <span className="hidden sm:inline text-xs text-muted-foreground">
                  — remember to save before leaving
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={saving}
                  className="h-8 text-xs font-medium gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleSave()}
                  disabled={saving}
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
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Preset Overwrite */}
      <Dialog open={showPresetConfirm} onOpenChange={setShowPresetConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Load &quot;{pendingPreset?.label}&quot; preset?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
              This will overwrite your current business settings (name, opening hours, services, FAQs, and voice) with the preset configuration. Any unsaved edits will be replaced.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowPresetConfirm(false);
                setPendingPreset(null);
              }}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => pendingPreset && handleApplyPreset(pendingPreset)}
              className="text-xs font-semibold"
            >
              Load preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Reset */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Reset all settings to default?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
              This will restore the business profile to <strong className="text-foreground">Example: Acme Plumbing</strong> defaults (including standard example services and FAQs) and the <strong className="text-foreground">Jane</strong> neural voice. Custom modifications will be replaced.
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
