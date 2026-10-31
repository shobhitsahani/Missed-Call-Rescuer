'use client';

import * as React from 'react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, RotateCcw } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled runtime error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center shadow-lg border-destructive/30">
        <CardContent className="p-0 flex flex-col items-center">
          <div className="h-12 w-12 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive mb-4">
            <AlertCircle className="h-6 w-6" />
          </div>

          <h1 className="text-xl font-bold tracking-tight text-foreground">Something went wrong</h1>
          <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-sm">
            {error.message || 'An unexpected client runtime exception occurred.'}
          </p>

          <div className="mt-6 flex items-center gap-3">
            <Button size="sm" onClick={() => reset()} className="text-xs gap-1.5 font-medium shadow-xs">
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Try again</span>
            </Button>
            <Button asChild variant="outline" size="sm" className="text-xs">
              <a href="/">Go to dashboard</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
