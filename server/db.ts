import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { DEFAULT_PRESET, BUSINESS_PRESETS } from '../src/lib/presets';

const dataDir = path.join(process.cwd(), 'data');
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(dataDir, 'app.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hours TEXT,
  services TEXT,
  faqs TEXT,
  tone TEXT,
  voice TEXT,
  language TEXT,
  owner_email TEXT
);
CREATE TABLE IF NOT EXISTS missed_calls (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  FOREIGN KEY (business_id) REFERENCES businesses(id)
);
CREATE TABLE IF NOT EXISTS callback_jobs (
  id TEXT PRIMARY KEY,
  missed_call_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  schedule TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  last_error TEXT,
  FOREIGN KEY (missed_call_id) REFERENCES missed_calls(id)
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  missed_call_id TEXT,
  business_id TEXT NOT NULL,
  customer_phone TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  end_reason TEXT,
  latency_json TEXT,
  usage_json TEXT,
  notified_at TEXT,
  notify_status TEXT,
  notify_provider TEXT,
  notify_error TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id)
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  order_idx INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  interrupted INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL,
  FOREIGN KEY (call_id) REFERENCES calls(id)
);
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL UNIQUE,
  reason TEXT,
  urgency TEXT,
  preferred_time TEXT,
  contact_details TEXT,
  suggested_action TEXT,
  short_summary TEXT,
  sentiment TEXT,
  raw TEXT,
  FOREIGN KEY (call_id) REFERENCES calls(id)
);
`);

// Safe, idempotent column migration for existing databases
export function ensureColumn(table: string, column: string, typeDef: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`).run();
  }
}

// Call owner notification tracking columns
ensureColumn('calls', 'notified_at', 'TEXT');
ensureColumn('calls', 'notify_status', 'TEXT');
ensureColumn('calls', 'notify_provider', 'TEXT');
ensureColumn('calls', 'notify_error', 'TEXT');

// Business settings columns
ensureColumn('businesses', 'timezone', 'TEXT');

// Call token, expiry, single-use, and source columns on missed_calls
ensureColumn('missed_calls', 'token', 'TEXT');
ensureColumn('missed_calls', 'token_expires_at', 'TEXT');
ensureColumn('missed_calls', 'call_started_at', 'TEXT');
ensureColumn('missed_calls', 'source', "TEXT NOT NULL DEFAULT 'demo'");
ensureColumn('summaries', 'status', "TEXT NOT NULL DEFAULT 'completed'");

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_missed_calls_token ON missed_calls(token);`);

// Backfill tokens for existing rows without one
const rowsWithoutToken = db.prepare('SELECT id FROM missed_calls WHERE token IS NULL').all() as Array<{ id: string }>;
for (const row of rowsWithoutToken) {
  const randomToken = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE missed_calls SET token = ? WHERE id = ?').run(randomToken, row.id);
}

export const DEFAULT_BIZ = {
  id: DEFAULT_PRESET.id,
  name: DEFAULT_PRESET.name,
  hours: DEFAULT_PRESET.hours,
  services: JSON.stringify(DEFAULT_PRESET.services),
  faqs: JSON.stringify(DEFAULT_PRESET.faqs),
  tone: DEFAULT_PRESET.tone,
  voice: DEFAULT_PRESET.voice,
  language: DEFAULT_PRESET.language,
  timezone: DEFAULT_PRESET.timezone,
  owner_email: DEFAULT_PRESET.owner_email,
};

export { BUSINESS_PRESETS };

export function parseServices(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
  } catch {}
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseFaqs(raw: unknown): Array<{ question: string; answer: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Array<{ question: string; answer: string }>;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item === 'object').map((item) => {
        const entry = item as Record<string, unknown>;
        return {
          question: String(entry.question || '').trim(),
          answer: String(entry.answer || '').trim(),
        };
      });
    }
  } catch {}
  return [{ question: 'General inquiry', answer: String(raw).trim() }];
}

export interface BusinessRecord {
  id: string;
  name: string;
  hours: string;
  services: string;
  faqs: string;
  tone: string;
  voice: string;
  language?: string;
  timezone: string;
  owner_email?: string;
  [key: string]: unknown;
}

const existingBiz = db.prepare('SELECT * FROM businesses WHERE id=?').get(DEFAULT_BIZ.id) as
  | { id: string; voice?: string; timezone?: string }
  | undefined;
if (!existingBiz) {
  db.prepare(`INSERT INTO businesses (id,name,hours,services,faqs,tone,voice,language,timezone,owner_email) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(
      DEFAULT_BIZ.id,
      DEFAULT_BIZ.name,
      DEFAULT_BIZ.hours,
      DEFAULT_BIZ.services,
      DEFAULT_BIZ.faqs,
      DEFAULT_BIZ.tone,
      DEFAULT_BIZ.voice,
      DEFAULT_BIZ.language,
      DEFAULT_BIZ.timezone,
      DEFAULT_BIZ.owner_email
    );
} else {
  // Normalize legacy voice or missing timezone if needed
  if (!existingBiz.voice || existingBiz.voice === 'en-US') {
    db.prepare('UPDATE businesses SET voice=? WHERE id=?').run('aai-jane', DEFAULT_BIZ.id);
  }
  if (!existingBiz.timezone) {
    db.prepare('UPDATE businesses SET timezone=? WHERE id=?').run('Asia/Kolkata', DEFAULT_BIZ.id);
  }
}

export default db;
