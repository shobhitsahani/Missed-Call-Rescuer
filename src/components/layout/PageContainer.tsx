import * as React from 'react';

export type PageContainerSize = 'narrow' | 'default' | 'wide';

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: PageContainerSize;
  children: React.ReactNode;
  className?: string;
}

const sizeClasses: Record<PageContainerSize, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-7xl',
};

export function PageContainer({
  size = 'default',
  children,
  className = '',
  ...props
}: PageContainerProps) {
  return (
    <div
      className={`w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 min-w-0 ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
