// 날짜 집계와 SQLite 'localtime' 이 한국 시간 기준이 되도록 (서버가 해외 리전이어도)
process.env.TZ = process.env.TZ || 'Asia/Seoul';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  telegram_chat_id TEXT,
  plan TEXT NOT NULL DEFAULT '일반',          -- 요금 등급
  seats INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'approved',   -- pending | approved | suspended
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  title TEXT,                                  -- 대표 | 직원
  role TEXT NOT NULL DEFAULT 'agent',          -- admin | manager | agent
  partner_id INTEGER REFERENCES partners(id),  -- null = 본사(전체 열람)
  active INTEGER NOT NULL DEFAULT 1,            -- 0 = 승인 대기/비활성
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE,          -- Meta campaign id
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'meta',
  partner_id INTEGER REFERENCES partners(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 일자별 광고 성과 (Meta Insights 동기화 또는 수동 입력). 광고세트/광고 단위까지 저장, 캠페인 단위 입력은 빈 문자열.
CREATE TABLE IF NOT EXISTS ad_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  adset_name TEXT NOT NULL DEFAULT '',
  ad_name TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  spend INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  UNIQUE(campaign_id, adset_name, ad_name, date)
);

-- 랜딩페이지 (자체 호스팅 폼)
CREATE TABLE IF NOT EXISTS landing_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER REFERENCES partners(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  headline TEXT,
  description TEXT,
  image_url TEXT,
  color TEXT NOT NULL DEFAULT '#2563eb',
  fields_json TEXT NOT NULL,         -- [{key,label,type,options,required}]
  button_text TEXT NOT NULL DEFAULT '무료 상담 신청',
  done_message TEXT NOT NULL DEFAULT '신청이 완료되었습니다. 곧 연락드리겠습니다.',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS landing_hits (
  landing_id INTEGER NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(landing_id, date)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT,
  company TEXT,
  business_type TEXT,
  region TEXT,
  annual_revenue TEXT,
  desired_amount TEXT,
  gender TEXT,                      -- 남 | 여
  age_group TEXT,                   -- 20대, 30대 ...
  extra_json TEXT,                  -- 폼의 기타 응답
  source TEXT NOT NULL DEFAULT 'meta',  -- meta | google | naver | kakao | landing | sheet | manual | import
  landing_id INTEGER REFERENCES landing_pages(id) ON DELETE SET NULL,
  sale_amount INTEGER NOT NULL DEFAULT 0, -- 구매/계약 금액 (매출 계산)
  first_contact_at TEXT,            -- 첫 응대 시각 (응답 속도)
  campaign_id INTEGER REFERENCES campaigns(id),
  ad_name TEXT,
  adset_name TEXT,
  form_name TEXT,
  meta_lead_id TEXT UNIQUE,
  partner_id INTEGER REFERENCES partners(id),
  assignee_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT '신규',
  callback_at TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_partner ON leads(partner_id);

CREATE TABLE IF NOT EXISTS lead_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,               -- memo | status | assign | kakao | telegram | system
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 알림톡 템플릿 (유형별)
CREATE TABLE IF NOT EXISTS kakao_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,        -- 카카오 검수된 템플릿 코드
  name TEXT NOT NULL,
  content TEXT NOT NULL,            -- #{이름} 형태 치환 변수
  buttons_json TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual',  -- manual | lead_created | status_change
  delay_minutes INTEGER NOT NULL DEFAULT 0,      -- 트리거 후 지연 발송
  trigger_value TEXT,               -- status_change 일 때 대상 상태
  match_field TEXT,                 -- 유형 조건 필드 (예: business_type)
  match_value TEXT,                 -- 유형 조건 값
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 지연 발송 대기열 (예: 재구매 안내 30일 후)
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES kakao_templates(id) ON DELETE CASCADE,
  send_at TEXT NOT NULL,
  expect_status TEXT,               -- 발송 시점에도 이 상태일 때만 발송
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,            -- telegram | kakao
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  target TEXT,
  template_code TEXT,
  content TEXT,
  status TEXT NOT NULL,             -- sent | failed | mock
  provider TEXT,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  payload TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== null && row.value !== '') return row.value;
  const env = process.env[key.toUpperCase().replace(/\./g, '_')];
  return env !== undefined ? env : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, getSetting, setSetting, tx };
