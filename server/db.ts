import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'app.db');
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

const seedBiz = {
  id: 'biz_1',
  name: 'Acme Plumbing',
  hours: 'Mon-Fri 8am-6pm, Sat 9am-1pm',
  services: 'Emergency plumbing, leak repair, drain cleaning, water heater install',
  faqs: 'We offer 24/7 emergency service. Free estimates. Licensed and insured.',
  tone: 'friendly, professional, concise',
  voice: 'en-US',
  language: 'en',
  owner_email: 'owner@acmeplumbing.example',
};
const exists = db.prepare('SELECT id FROM businesses WHERE id=?').get(seedBiz.id);
if (!exists) {
  db.prepare(`INSERT INTO businesses (id,name,hours,services,faqs,tone,voice,language,owner_email) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(seedBiz.id, seedBiz.name, seedBiz.hours, seedBiz.services, seedBiz.faqs, seedBiz.tone, seedBiz.voice, seedBiz.language, seedBiz.owner_email);
}

export default db;