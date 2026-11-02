import assert from 'assert';
import { getApiBase } from '../src/lib/api';

console.log('--- Running API Base Selection Tests ---\n');

const originalBase = process.env.NEXT_PUBLIC_API_BASE;
const originalNodeEnv = process.env.NODE_ENV;

try {
  process.env.NEXT_PUBLIC_API_BASE = 'https://api.example.com/v1///';
  assert.strictEqual(getApiBase(), 'https://api.example.com/v1');

  process.env.NEXT_PUBLIC_API_BASE = '  https://custom.example.com/  ';
  assert.strictEqual(getApiBase(), 'https://custom.example.com');

  delete process.env.NEXT_PUBLIC_API_BASE;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  assert.strictEqual(getApiBase(), 'https://missed-call-rescuer-api.onrender.com');

  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  assert.strictEqual(getApiBase(), 'http://localhost:4000');

  console.log('✓ Explicit API base wins, is normalized, and env fallbacks are correct.');
} finally {
  if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
  else process.env.NEXT_PUBLIC_API_BASE = originalBase;
  (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
}

console.log('\n🎉 API BASE TESTS PASSED!');
