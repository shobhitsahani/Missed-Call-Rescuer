import { detectPlatform, NavigatorLike } from '../src/lib/platform';

interface TestCase {
  name: string;
  nav: NavigatorLike | undefined;
  expected: string;
}

const testCases: TestCase[] = [
  {
    name: 'macOS via userAgentData',
    nav: {
      userAgentData: { platform: 'macOS', mobile: false },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    },
    expected: 'mac',
  },
  {
    name: 'macOS legacy without userAgentData (Firefox/Safari)',
    nav: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    },
    expected: 'mac',
  },
  {
    name: 'Windows 11 via userAgentData',
    nav: {
      userAgentData: { platform: 'Windows', mobile: false },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      platform: 'Win32',
      maxTouchPoints: 0,
    },
    expected: 'windows',
  },
  {
    name: 'Windows legacy without userAgentData',
    nav: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
      platform: 'Win32',
      maxTouchPoints: 0,
    },
    expected: 'windows',
  },
  {
    name: 'Linux desktop via userAgentData',
    nav: {
      userAgentData: { platform: 'Linux', mobile: false },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
    },
    expected: 'linux',
  },
  {
    name: 'Linux desktop legacy without userAgentData',
    nav: {
      userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
    },
    expected: 'linux',
  },
  {
    name: 'iPhone Mobile Safari',
    nav: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    },
    expected: 'touch',
  },
  {
    name: 'iPadOS 13+ (reports as MacIntel but has touch points)',
    nav: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    },
    expected: 'touch',
  },
  {
    name: 'Android Mobile via userAgentData',
    nav: {
      userAgentData: { platform: 'Android', mobile: true },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    },
    expected: 'touch',
  },
  {
    name: 'Android legacy without userAgentData',
    nav: {
      userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/119.0 Firefox/119.0',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    },
    expected: 'touch',
  },
  {
    name: 'Unknown / server environment (undefined navigator)',
    nav: undefined,
    expected: 'other',
  },
];

console.log('Running platform detection test suite...\n');

let failed = 0;
for (const tc of testCases) {
  const result = detectPlatform(tc.nav);
  if (result === tc.expected) {
    console.log(`[PASS] ${tc.name} -> detected "${result}"`);
  } else {
    console.error(`[FAIL] ${tc.name}: expected "${tc.expected}", received "${result}"`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\nTest suite finished with ${failed} failure(s).`);
  process.exit(1);
} else {
  console.log(`\nAll ${testCases.length} platform tests passed successfully!`);
}
