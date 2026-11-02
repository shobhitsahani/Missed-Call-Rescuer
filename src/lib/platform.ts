'use client';

import { useSyncExternalStore } from 'react';

export type Platform = 'mac' | 'windows' | 'linux' | 'touch' | 'other';

export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: {
    platform?: string;
    mobile?: boolean;
  };
}

/**
 * Pure function to detect operating system platform from navigator properties.
 * Accepts optional NavigatorLike mock for isolated unit testing.
 */
export function detectPlatform(nav?: NavigatorLike | null): Platform {
  // If running in SSR / server environment without an explicit mock, return 'other'
  if (typeof window === 'undefined' && arguments.length === 0) {
    return 'other';
  }

  // If explicit argument was passed in test, use it; otherwise read global navigator in browser
  const n = arguments.length > 0
    ? (nav ?? undefined)
    : (typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : undefined);

  if (!n) return 'other';

  const userAgent = (n.userAgent || '').toLowerCase();
  const platform = (n.userAgentData?.platform || n.platform || '').toLowerCase();
  const isMobile = Boolean(n.userAgentData?.mobile);
  const maxTouchPoints = typeof n.maxTouchPoints === 'number' ? n.maxTouchPoints : 0;

  // 1. Touch & Mobile devices: iPhone, iPad, iPod, Android, touchscreen tablets
  // iPadOS 13+ identifies as MacIntel with maxTouchPoints > 1
  if (
    isMobile ||
    /iphone|ipod|ipad|android|mobile|silk|tablet/.test(userAgent) ||
    /iphone|ipod|ipad|android/.test(platform) ||
    (platform.includes('mac') && maxTouchPoints > 1)
  ) {
    return 'touch';
  }

  // 2. macOS
  if (platform.includes('mac') || userAgent.includes('macintosh') || userAgent.includes('mac os x')) {
    return 'mac';
  }

  // 3. Windows
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }

  // 4. Linux
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'linux';
  }

  return 'other';
}

/**
 * Client hook for hydration-safe platform detection.
 * Renders neutral fallback before mount to avoid hydration mismatches.
 */
export function usePlatform(): { platform: Platform; mounted: boolean } {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const platform = mounted ? detectPlatform() : 'other';

  return { platform, mounted };
}
