'use client';

import { useState } from 'react';
import { API_BASE } from '@/lib/api';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DemoModal({ isOpen, onClose }: DemoModalProps) {
  const [testingNotify, setTestingNotify] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!isOpen) return null;

  const handleSendTestNotification = async () => {
    setTestingNotify(true);
    setTestResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/notify/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestResult({
          ok: false,
          message: data?.error || `Failed to send test notification (HTTP ${res.status})`,
        });
      } else {
        setTestResult({
          ok: true,
          message: `Success! Test alert sent via ${data.provider}. Check your phone.`,
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || 'Network error sending test notification',
      });
    } finally {
      setTestingNotify(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-dialog-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0e1422] p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 id="demo-dialog-title" className="text-sm font-semibold text-white">
            Demo &amp; Testing Configuration
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md"
            aria-label="Close dialog"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 text-xs text-slate-300">
          {/* Owner Notifications Section */}
          <div className="rounded-lg bg-slate-900/60 border border-slate-800/80 p-3.5 space-y-3">
            <div>
              <p className="font-semibold text-white text-xs">Owner Notification Alert</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Test the phone push notification flow to Telegram or Discord configured in <code className="bg-slate-850 px-1 py-0.5 rounded font-mono">.env</code>.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSendTestNotification}
              disabled={testingNotify}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
            >
              {testingNotify ? (
                <>
                  <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Sending alert...</span>
                </>
              ) : (
                <span>Send test notification</span>
              )}
            </button>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg text-xs leading-normal border ${
                  testResult.ok
                    ? 'bg-teal-950/40 border-teal-800/50 text-teal-200'
                    : 'bg-rose-950/40 border-rose-800/50 text-rose-200'
                }`}
              >
                {testResult.message}
              </div>
            )}
          </div>

          <p>
            You can generate incoming missed calls and live AI voice callback sessions using the primary{' '}
            <strong className="text-teal-300">&ldquo;Simulate missed call&rdquo;</strong> action.
          </p>

          <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-3 text-amber-200">
            <p className="font-semibold text-amber-300 mb-1">Clear Test Data Notice</p>
            <p className="text-[11px] leading-relaxed">
              No reset route currently exists in <code className="bg-amber-950/40 px-1 py-0.5 rounded font-mono">server/index.ts</code>. To safely clear calls and jobs, add an endpoint such as:
            </p>
            <pre className="mt-2 text-[10px] bg-slate-950/80 p-2 rounded font-mono text-slate-200 overflow-x-auto">
              {`app.post('/api/test-data/reset', (_req, res) => {
  db.exec('DELETE FROM turns; DELETE FROM summaries; DELETE FROM calls; DELETE FROM callback_jobs; DELETE FROM missed_calls;');
  res.json({ ok: true });
});`}
            </pre>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
