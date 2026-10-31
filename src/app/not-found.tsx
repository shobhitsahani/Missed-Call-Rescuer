import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PhoneMissed, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center shadow-lg">
        <CardContent className="p-0 flex flex-col items-center">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4">
            <PhoneMissed className="h-6 w-6" />
          </div>

          <h1 className="text-xl font-bold tracking-tight text-foreground">Page Not Found</h1>
          <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-sm">
            The page or call token you requested does not exist or has expired.
          </p>

          <div className="mt-6">
            <Button asChild size="sm" className="text-xs gap-1.5 font-medium shadow-xs">
              <Link href="/">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Dashboard</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
