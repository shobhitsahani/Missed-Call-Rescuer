'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { setStoredToken } from '@/lib/api';

interface AccessScreenProps {
  onSuccess: () => void;
  apiBase?: string;
}

export function AccessScreen({ onSuccess, apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000' }: AccessScreenProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter the access code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 429) {
          setError('Too many attempts. Please wait 1 minute before trying again.');
        } else if (res.status === 401) {
          setError('Invalid access code. Please check your hackathon submission details.');
        } else {
          setError(data?.error || `Authentication failed (status ${res.status}).`);
        }
        return;
      }

      if (data?.token) {
        setStoredToken(data.token);
        onSuccess();
      } else {
        setError('Unexpected server response. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error connecting to the API server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-4">
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
            <Lock className="w-6 h-6 text-emerald-400" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight text-zinc-100">
            Missed-Call Rescuer
          </CardTitle>
          <CardDescription className="text-zinc-400 text-sm mt-1">
            Access to this live demo is protected to conserve voice and LLM API credits.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 pt-4">
            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="access-code" className="text-xs font-medium text-zinc-300">
                Judge Access Code
              </label>
              <Input
                id="access-code"
                type="password"
                placeholder="Enter access code..."
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                disabled={loading}
                className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500"
              />
              <p className="text-[11px] text-zinc-500 leading-tight">
                Enter the access code submitted in the private hackathon form.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 pt-2">
            <Button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Unlock Dashboard
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
