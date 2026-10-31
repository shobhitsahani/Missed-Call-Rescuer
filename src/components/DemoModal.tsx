'use client';

import * as React from 'react';
import { useState } from 'react';
import { API_BASE } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Loader2, Send, CheckCircle2, AlertCircle, Wrench } from 'lucide-react';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DemoModal({ isOpen, onClose }: DemoModalProps) {
  const [testingNotify, setTestingNotify] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

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
          message: `Success! Test alert sent via ${data.provider}. Check your notification channel.`,
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
                Diagnostics and real-time integration tools.
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
              Test the phone push notification flow to Telegram or Discord configured in{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono text-foreground border border-border">.env</code>.
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
