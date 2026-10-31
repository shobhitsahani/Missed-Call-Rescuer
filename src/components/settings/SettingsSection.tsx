import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface SettingsSectionProps {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge?: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  badge,
  headerAction,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <Card
      id={id}
      className={cn(
        'scroll-mt-24 sm:scroll-mt-28 p-6 space-y-6 border border-border shadow-2xs transition-shadow',
        className
      )}
    >
      <CardHeader className="p-0 border-b border-border pb-4 flex flex-row items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
              {title}
            </CardTitle>
            {badge}
          </div>
          <CardDescription className="text-[13px] text-muted-foreground leading-normal pl-10.5">
            {description}
          </CardDescription>
        </div>

        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </CardHeader>

      <CardContent className="p-0 space-y-6">{children}</CardContent>
    </Card>
  );
}
