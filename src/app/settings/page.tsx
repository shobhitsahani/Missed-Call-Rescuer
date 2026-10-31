'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Sidebar, DashboardView } from '@/components/Sidebar';
import { ASSEMBLYAI_VOICES, VoiceOption } from '@/lib/voices';
import { API_BASE } from '@/lib/api';

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
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

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
      setErrors((prev) => ({ ...prev, services: 'Maximum 20 services allowed.' }));
      return;
    }
    if (trimmed.length > 80) {
      setErrors((prev) => ({ ...prev, services: 'Each service must be 80 characters or fewer.' }));
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
      setErrors((prev) => ({ ...prev, faqs: 'Maximum 20 FAQs allowed.' }));
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
    if (previewingVoiceId) {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
      if (previewingVoiceId === targetVoiceId) {
        setPreviewingVoiceId(null);
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
        throw new Error(errJson.error || `Voice preview failed (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      activeAudioRef.current = audio;

      audio.onended = () => {
        setPreviewingVoiceId(null);
        activeAudioRef.current = null;
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setPreviewError('Failed to playback audio sample.');
        setPreviewingVoiceId(null);
        activeAudioRef.current = null;
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (err: any) {
      setPreviewError(err?.message || 'Voice synthesis preview unavailable.');
      setPreviewingVoiceId(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccessMsg(null);
    setGeneralError(null);
    setErrors({});

    try {
      const res = await fetch(`${API_BASE}/api/business`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          hours: hours.trim(),
          services,
          faqs,
          tone: tone.trim(),
          voice,
          timezone,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data?.errors) {
          setErrors(data.errors);
        } else {
          setGeneralError(data?.error || `Save failed (HTTP ${res.status})`);
        }
      } else {
        setSaveSuccessMsg('Business settings saved successfully.');
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      setGeneralError(err?.message || 'Network error while saving settings.');
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
        setGeneralError(data?.error || 'Failed to reset settings.');
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
        setSaveSuccessMsg('Settings reset to Acme Plumbing defaults.');
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      setGeneralError(err?.message || 'Network error while resetting.');
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
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col md:flex-row antialiased selection:bg-teal-500/30 selection:text-teal-200">
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Business Settings</h1>
            <p className="text-xs text-slate-400 mt-1">
              Configure how your voice agent answers, speaks, and represents your company.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              disabled={loading || saving}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-500 text-white shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              {saving ? (
                <>
                  <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save changes</span>
              )}
            </button>
          </div>
        </div>

        {/* Live Call Behavior Notice */}
        <div className="rounded-lg bg-teal-950/30 border border-teal-800/40 p-3 flex items-start gap-3 text-xs text-teal-200/90">
          <svg className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-medium text-teal-200">Changes apply to new calls only</p>
            <p className="text-[11px] text-teal-300/80 mt-0.5">
              The agent greeting, voice synthesis, and knowledge base are loaded at the moment a call starts. Any call currently in progress will complete with its starting configuration.
            </p>
          </div>
        </div>

        {/* Status Banners */}
        {saveSuccessMsg && (
          <div className="rounded-lg bg-teal-950/40 border border-teal-800/60 p-3 text-xs text-teal-200 flex items-center gap-2">
            <svg className="w-4 h-4 text-teal-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {generalError && (
          <div className="rounded-lg bg-rose-950/40 border border-rose-800/60 p-3 text-xs text-rose-200 flex items-center gap-2">
            <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{generalError}</span>
          </div>
        )}

        {previewError && (
          <div className="rounded-lg bg-amber-950/40 border border-amber-800/60 p-3 text-xs text-amber-200 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{previewError}</span>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-xs text-slate-400">
            <div className="inline-block h-6 w-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mb-2" />
            <p>Loading configuration...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* General Information Card */}
            <section className="bg-[#0f1422] border border-slate-800/80 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white">General Information</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Business Name */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="biz-name" className="text-xs font-medium text-slate-300">
                      Business Name <span className="text-teal-400">*</span>
                    </label>
                    <span className="text-[10px] text-slate-500">{name.length}/100</span>
                  </div>
                  <input
                    id="biz-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    placeholder="e.g. Acme Plumbing"
                    className={`w-full px-3 py-2 text-xs rounded-lg bg-slate-900/80 border text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400 ${
                      errors.name ? 'border-rose-500' : 'border-slate-800'
                    }`}
                  />
                  {errors.name && <p className="text-[11px] text-rose-400">{errors.name}</p>}
                  <p className="text-[11px] text-slate-500">
                    Spoken directly in the automated greeting (&quot;calling on behalf of {name || '...'}&quot;).
                  </p>
                </div>

                {/* Timezone */}
                <div className="space-y-1.5">
                  <label htmlFor="biz-timezone" className="text-xs font-medium text-slate-300">
                    Business Timezone <span className="text-teal-400">*</span>
                  </label>
                  <select
                    id="biz-timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className={`w-full px-3 py-2 text-xs rounded-lg bg-slate-900/80 border text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400 ${
                      errors.timezone ? 'border-rose-500' : 'border-slate-800'
                    }`}
                  >
                    {TIMEZONE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {errors.timezone && <p className="text-[11px] text-rose-400">{errors.timezone}</p>}
                  <p className="text-[11px] text-slate-500">
                    Used to accurately interpret customer callback dates (&quot;tomorrow&quot;, &quot;Monday morning&quot;).
                  </p>
                </div>
              </div>

              {/* Operating Hours */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="biz-hours" className="text-xs font-medium text-slate-300">
                    Opening Hours
                  </label>
                  <span className="text-[10px] text-slate-500">{hours.length}/200</span>
                </div>
                <input
                  id="biz-hours"
                  type="text"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Mon-Fri 8am-6pm, Sat 9am-1pm"
                  className={`w-full px-3 py-2 text-xs rounded-lg bg-slate-900/80 border text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400 ${
                    errors.hours ? 'border-rose-500' : 'border-slate-800'
                  }`}
                />
                {errors.hours && <p className="text-[11px] text-rose-400">{errors.hours}</p>}
              </div>

              {/* Tone */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="biz-tone" className="text-xs font-medium text-slate-300">
                    Voice Agent Tone
                  </label>
                  <span className="text-[10px] text-slate-500">{tone.length}/100</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TONE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTone(preset)}
                      className={`px-2.5 py-1 rounded text-[11px] transition-colors border ${
                        tone === preset
                          ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  id="biz-tone"
                  type="text"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  maxLength={100}
                  placeholder="Custom tone instructions (e.g. friendly, concise, professional)"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900/80 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>

              {/* Language (Disabled per specification) */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-slate-400">Agent Language</label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    disabled
                    value="English (en)"
                    className="w-48 px-3 py-2 text-xs rounded-lg bg-slate-900/40 border border-slate-800/50 text-slate-500 cursor-not-allowed"
                  />
                  <span className="text-[11px] text-slate-500">
                    English only for now (multilingual models coming soon).
                  </span>
                </div>
              </div>
            </section>

            {/* Voice Selection & Preview Card */}
            <section className="bg-[#0f1422] border border-slate-800/80 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">Voice & Speech Synthesis</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Select the AssemblyAI neural voice for streaming text-to-speech.
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {ASSEMBLYAI_VOICES.length} voices available
                </span>
              </div>

              {errors.voice && <p className="text-xs text-rose-400">{errors.voice}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ASSEMBLYAI_VOICES.map((v: VoiceOption) => {
                  const isSelected = voice === v.id;
                  const isPlaying = previewingVoiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => setVoice(v.id)}
                      className={`relative p-3.5 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-teal-950/20 border-teal-500/60 ring-1 ring-teal-500/40'
                          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">{v.name}</span>
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                              {v.gender}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-tight">
                            {v.description}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePreviewVoice(v.id);
                          }}
                          className={`shrink-0 h-7 px-2 text-[11px] rounded font-medium inline-flex items-center gap-1 border transition-colors ${
                            isPlaying
                              ? 'bg-teal-500 text-white border-teal-400 animate-pulse'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/80'
                          }`}
                          title="Preview voice audio sample"
                        >
                          {isPlaying ? (
                            <>
                              <span className="h-2 w-2 rounded-full bg-white animate-ping" />
                              <span>Playing</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3 text-slate-300" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              <span>Preview</span>
                            </>
                          )}
                        </button>
                      </div>

                      {isSelected && (
                        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-teal-400 font-medium">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Selected voice</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Services Card */}
            <section className="bg-[#0f1422] border border-slate-800/80 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">Offered Services</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Services your AI agent knows your business provides (max 20).
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {services.length} / 20
                </span>
              </div>

              {errors.services && <p className="text-xs text-rose-400">{errors.services}</p>}

              {/* Tag Input */}
              <div className="flex gap-2">
                <input
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
                  className="flex-1 px-3 py-2 text-xs rounded-lg bg-slate-900/80 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleAddService}
                  disabled={services.length >= 20 || !newServiceInput.trim()}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
                >
                  Add service
                </button>
              </div>

              {/* Services Chip List */}
              <div className="flex flex-wrap gap-2 pt-1">
                {services.map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700 text-xs text-slate-200"
                  >
                    <span>{item}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveService(idx)}
                      className="text-slate-400 hover:text-rose-400 transition-colors"
                      title="Remove service"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {services.length === 0 && (
                  <p className="text-xs text-slate-500 italic">No services listed yet.</p>
                )}
              </div>
            </section>

            {/* FAQs Card */}
            <section className="bg-[#0f1422] border border-slate-800/80 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">Frequently Asked Questions</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Predefined Q&amp;As the voice agent can consult during customer conversations (max 20).
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {faqs.length} / 20
                </span>
              </div>

              {errors.faqs && <p className="text-xs text-rose-400">{errors.faqs}</p>}

              <div className="space-y-3">
                {faqs.map((faq, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2.5 relative group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        FAQ #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveFaq(idx)}
                        className="text-xs text-slate-500 hover:text-rose-400 transition-colors"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="space-y-1">
                      <input
                        type="text"
                        value={faq.question}
                        onChange={(e) => handleUpdateFaq(idx, 'question', e.target.value)}
                        maxLength={120}
                        placeholder="Question (e.g. Do you offer 24/7 emergency service?)"
                        className="w-full px-3 py-1.5 text-xs rounded bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-400"
                      />
                    </div>

                    <div className="space-y-1">
                      <textarea
                        value={faq.answer}
                        onChange={(e) => handleUpdateFaq(idx, 'answer', e.target.value)}
                        maxLength={250}
                        rows={2}
                        placeholder="Answer (e.g. Yes, we are available 24/7 for urgent plumbing calls.)"
                        className="w-full px-3 py-1.5 text-xs rounded bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-400 resize-none"
                      />
                    </div>
                  </div>
                ))}

                {faqs.length === 0 && (
                  <p className="text-xs text-slate-500 italic py-2">No FAQs added yet.</p>
                )}
              </div>

              {faqs.length < 20 && (
                <button
                  type="button"
                  onClick={handleAddFaq}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  + Add question &amp; answer
                </button>
              )}
            </section>

            {/* Bottom Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-500 text-white shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                {saving ? 'Saving changes...' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </main>

      {/* Confirmation Modal for Reset */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#0f1422] border border-slate-800 rounded-xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white">Reset all settings to default?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              This will restore the business name to <strong className="text-white">Acme Plumbing</strong>, default opening hours, standard plumbing services, FAQs, and the <strong className="text-white">Jane</strong> neural voice. Custom changes will be replaced.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetToDefault}
                disabled={resetting}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50"
              >
                {resetting ? 'Resetting...' : 'Yes, reset to defaults'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
