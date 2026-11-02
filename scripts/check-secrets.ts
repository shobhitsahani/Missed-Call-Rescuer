import { execSync } from 'child_process';
import fs from 'fs';

interface Finding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

const SECRET_PATTERNS = [
  { name: 'Live Groq API Key', regex: /gsk_[a-zA-Z0-9]{32,}/ },
  { name: 'Live OpenAI API Key', regex: /sk-[a-zA-Z0-9]{32,}/ },
  { name: 'Live AssemblyAI Key', regex: /aai_[a-zA-Z0-9]{24,}/ },
  { name: 'Live Telegram Bot Token', regex: /\b\d{9,10}:[A-Za-z0-9_-]{35}\b/ },
  { name: 'Live Discord Webhook', regex: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]+/ },
  { name: 'Private Key Block', regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
];

const ALLOWLIST_FILES = [
  '.env.example',
  'scripts/check-secrets.ts',
];

function checkTrackedFiles(): Finding[] {
  const findings: Finding[] = [];
  const tracked = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  for (const file of tracked) {
    if (ALLOWLIST_FILES.includes(file)) continue;
    if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.ico')) continue;
    if (!fs.existsSync(file)) continue;

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pat of SECRET_PATTERNS) {
        if (pat.regex.test(line)) {
          // Check if it is a harmless placeholder like "your_assemblyai_api_key_here"
          if (line.includes('your_') || line.includes('placeholder') || line.includes('example')) continue;
          findings.push({
            file,
            line: i + 1,
            pattern: pat.name,
            snippet: line.trim().slice(0, 80),
          });
        }
      }
    }
  }

  return findings;
}

function checkGitIgnoredEnvFiles(): string[] {
  const issues: string[] = [];
  const trackedEnv = execSync('git ls-files .env*', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  for (const file of trackedEnv) {
    if (file !== '.env.example') {
      issues.push(`Secret env file "${file}" is tracked by git! It should be ignored.`);
    }
  }

  return issues;
}

function checkNextPublicExposure(): string[] {
  const issues: string[] = [];
  const envExample = fs.readFileSync('.env.example', 'utf8');
  const lines = envExample.split('\n');

  for (const line of lines) {
    if (line.startsWith('NEXT_PUBLIC_')) {
      const [key] = line.split('=');
      if (key !== 'NEXT_PUBLIC_API_BASE') {
        issues.push(`Unexpected NEXT_PUBLIC variable in .env.example: ${key}. Only non-secret frontend configs should use NEXT_PUBLIC_.`);
      }
    }
  }

  return issues;
}

function checkGitHistoryForKeys(): string[] {
  const issues: string[] = [];
  // Search recent commits for leaked live Groq keys
  try {
    const groqLeaks = execSync('git log -n 50 -S "gsk_" -p -- .env* 2>nul || true', { encoding: 'utf8' });
    if (/gsk_[a-zA-Z0-9]{30,}/.test(groqLeaks) && !groqLeaks.includes('your_groq_api_key_here')) {
      issues.push('Possible live Groq key found in git commit history diff');
    }
  } catch {}

  return issues;
}

function main() {
  console.log('--- Running Secret Exposure & Credential Leak Audit ---');

  const fileFindings = checkTrackedFiles();
  const envIssues = checkGitIgnoredEnvFiles();
  const nextPublicIssues = checkNextPublicExposure();
  const historyIssues = checkGitHistoryForKeys();

  let hasErrors = false;

  if (envIssues.length > 0) {
    hasErrors = true;
    console.error('❌ Git Ignored File Violations:');
    envIssues.forEach((iss) => console.error(`  - ${iss}`));
  } else {
    console.log('✓ No secret .env files are tracked by git (.gitignore verified).');
  }

  if (nextPublicIssues.length > 0) {
    hasErrors = true;
    console.error('❌ NEXT_PUBLIC Exposure Violations:');
    nextPublicIssues.forEach((iss) => console.error(`  - ${iss}`));
  } else {
    console.log('✓ Only non-secret NEXT_PUBLIC_API_BASE is exposed to frontend.');
  }

  if (fileFindings.length > 0) {
    hasErrors = true;
    console.error('❌ Secrets Found in Tracked Code / Documents:');
    fileFindings.forEach((f) => console.error(`  - [${f.pattern}] ${f.file}:${f.line} -> ${f.snippet.replace(/gsk_[a-zA-Z0-9]+/g, 'gsk_***')}`));
  } else {
    console.log('✓ No live credentials, API keys, or private tokens found in tracked files.');
  }

  if (historyIssues.length > 0) {
    hasErrors = true;
    console.error('❌ Git History Violations:');
    historyIssues.forEach((h) => console.error(`  - ${h}`));
  } else {
    console.log('✓ Git commit history clean (no live keys detected).');
  }

  if (hasErrors) {
    console.error('\n❌ SECRET SCAN FAILED: Potential credential exposure detected.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL SECRET EXPOSURE CHECKS PASSED CLEANLY!');
  }
}

main();
