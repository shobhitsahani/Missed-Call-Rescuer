'use client';

import * as React from 'react';
import { useState } from 'react';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Bell, Loader2, Send, CheckCircle2, AlertCircle, Wrench, Trash2 } from 'lucide-react';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataCleared?: () => void;
}

export function DemoModal({ isOpen, onClose, onDataCleared }: DemoModalProps) {
  const [testingNotify, setTestingNotify] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearResult, setClearResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSendTestNotification = async () => {
    setTestingNotify(true);
    setTestResult(null);

    try {
      const data = await api('/api/notify/test', { method: 'POST' });
      setTestResult({
        ok: true,
        message: `Success! Test alert sent via ${data.provider}. Check your notification channel.`,
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || 'Failed to send test notification',
      });
    } finally {
      setTestingNotify(false);
    }
  };

  const handleClearData = async () => {
    setClearing(true);
    setClearResult(null);

    try {
      const data = await api('/api/admin/clear-test-data', {
        method: 'POST',
        body: JSON.stringify({ scope: 'all' }),
      });
      setClearResult({
        ok: true,
        message: data?.message || 'Test data cleared successfully. Business configuration preserved.',
      });
      setConfirmClear(false);
      if (onDataCleared) onDataCleared();
    } catch (err: any) {
      setClearResult({
        ok: false,
        message: err?.message || 'Failed to clear test data. Ensure ADMIN_ENABLED=true if in production.',
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
              <Wrench className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                Demo &amp; Testing Configuration
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Diagnostics and data hygiene tools.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Owner Notifications Section */}
          <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <p className="font-semibold text-foreground text-xs">Owner Notification Alert</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Test the owner notification dispatch (Telegram or Discord webhook) configured on the backend.
            </p>

            <div>
              <Button
                size="sm"
                onClick={handleSendTestNotification}
                disabled={testingNotify}
                className="text-xs gap-1.5 h-8 font-medium shadow-xs"
              >
                {testingNotify ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Sending alert...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3 w-3" />
                    <span>Send test notification</span>
                  </>
                )}
              </Button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-xs leading-normal flex items-start gap-2 border animate-in fade-in duration-150 ${
                  testResult.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-destructive/10 border-destructive/30 text-destructive'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Clean Dashboard / Test Data Section */}
          <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-rose-500" />
              <p className="font-semibold text-foreground text-xs">Reset Test Data</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Clear all simulated and test calls, turns, and summaries before recording. Business hours, services, and FAQ configuration will not be deleted.
            </p>

            {!confirmClear ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmClear(true)}
                className="text-xs gap-1.5 h-8 font-medium border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
              >
                <Trash2 className="h-3 w-3" />
                <span>Clear demo &amp; test data</span>
              </Button>
            ) : (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-2">
                <p className="text-xs text-rose-300 font-medium">
                  Are you sure? This will remove all call sessions and reset dashboard metrics to clean state.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleClearData}
                    disabled={clearing}
                    className="h-7 text-xs font-medium"
                  >
                    {clearing ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        Clearing...
                      </>
                    ) : (
                      'Yes, clear calls'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmClear(false)}
                    disabled={clearing}
                    className="h-7 text-xs text-muted-foreground"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {clearResult && (
              <div
                className={`p-3 rounded-lg text-xs leading-normal flex items-start gap-2 border animate-in fade-in duration-150 ${
                  clearResult.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-destructive/10 border-destructive/30 text-destructive'
                }`}
              >
                {clearResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                )}
                <span>{clearResult.message}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
