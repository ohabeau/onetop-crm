const { db, getSetting, tx } = require('../db');
const telegram = require('../adapters/telegram');
const kakao = require('../adapters/kakao');

const STATUSES = ['신규', '부재1차', '부재2차', '상담중', '예약완료', '구매완료', '재구매', '보류', '허수'];
const WON = ['구매완료', '재구매'];
const CLOSED = [...WON, '허수'];
const PLATFORMS = { meta: '메타', google: '구글', naver: '네이버', kakao: '카카오', landing: '랜딩', sheet: '구글시트', manual: '직접등록', import: '엑셀' };

// Meta 폼 field_data 의 키(name) → 리드 컬럼 매핑. 설정에서 덮어쓸 수 있다.
const DEFAULT_FIELD_MAP = {
  name: ['full_name', 'name', '이름', '성함', '대표자명'],
  phone: ['phone_number', 'phone', '연락처', '휴대폰', '전화번호'],
  company: ['company_name', 'company', '상호', '회사명', '업체명'],
  business_type: ['job_title', 'business_type', '업종', '사업자유형', '사업자 유형'],
  region: ['city', 'region', '지역', '사업장지역', '사업장 지역'],
  annual_revenue: ['annual_revenue', '매출', '연매출', '연 매출'],
  desired_amount: ['desired_amount', '필요자금', '희망금액', '필요 자금', '관심상품', '문의내용'],
  gender: ['gender', '성별'],
  age_group: ['age', 'age_group', '나이', '연령', '연령대'],
};

function normalizeGender(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (/^(m|male|남)/.test(s)) return '남';
  if (/^(f|female|여)/.test(s)) return '여';
  return null;
}

function normalizeAge(v) {
  const s = String(v || '');
  if (!s) return null;
  if (/대/.test(s)) {
    const d = Number((s.match(/\d+/) || [])[0]);
    return Number.isFinite(d) ? (d >= 60 ? '60대+' : `${d}대`) : s;
  }
  let n = Number(s.match(/\d+/) ? s.match(/\d+/)[0] : NaN);
  if (n > 1900) n = new Date().getFullYear() - n + 1; // 출생연도
  if (!Number.isFinite(n) || n < 10 || n > 110) return null;
  return n >= 60 ? '60대+' : `${Math.floor(n / 10) * 10}대`;
}

function fieldMap() {
  try {
    const custom = JSON.parse(getSetting('lead.field_map') || '{}');
    return { ...DEFAULT_FIELD_MAP, ...custom };
  } catch {
    return DEFAULT_FIELD_MAP;
  }
}

function normalizeKey(k) {
  return String(k).toLowerCase().replace(/[\s_?:]/g, '');
}

// [{name, values:[...]}] 또는 {key: value} 를 리드 컬럼 + extra 로 나눈다.
function mapFields(fieldData) {
  const flat = {};
  if (Array.isArray(fieldData)) {
    fieldData.forEach((f) => { flat[f.name] = Array.isArray(f.values) ? f.values.join(', ') : f.values; });
  } else if (fieldData && typeof fieldData === 'object') {
    Object.assign(flat, fieldData);
  }
  const map = fieldMap();
  const out = {};
  const used = new Set();
  for (const [col, aliases] of Object.entries(map)) {
    const wanted = aliases.map(normalizeKey);
    for (const [k, v] of Object.entries(flat)) {
      if (!used.has(k) && wanted.includes(normalizeKey(k))) {
        out[col] = v == null ? '' : String(v);
        used.add(k);
        break;
      }
    }
  }
  const extra = {};
  for (const [k, v] of Object.entries(flat)) if (!used.has(k)) extra[k] = v;
  if ('gender' in out) out.gender = normalizeGender(out.gender);
  if ('age_group' in out) out.age_group = normalizeAge(out.age_group);
  return { ...out, extra };
}

function formatPhone(p) {
  const d = kakao.normalizePhone(p).replace(/^82/, '0');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d || null;
}

function upsertCampaign({ external_id, name, platform }) {
  if (!external_id && !name) return null;
  if (external_id) {
    const row = db.prepare('SELECT id FROM campaigns WHERE external_id = ?').get(String(external_id));
    if (row) {
      if (name) db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(name, row.id);
      return row.id;
    }
  } else {
    const row = db.prepare('SELECT id FROM campaigns WHERE name = ? AND external_id IS NULL').get(name);
    if (row) return row.id;
  }
  const r = db.prepare('INSERT INTO campaigns(external_id, name, platform) VALUES(?, ?, ?)')
    .run(external_id ? String(external_id) : null, name || `캠페인 ${external_id}`, platform || 'meta');
  return Number(r.lastInsertRowid);
}

// 파트너 내 활성 상담원에게 순번 배정
function pickAssignee(partnerId) {
  if (getSetting('lead.auto_assign', '1') !== '1') return null;
  const agents = db.prepare(`SELECT id FROM users WHERE active = 1 AND role = 'agent' AND ${partnerId ? 'partner_id = ?' : 'partner_id IS NULL'} ORDER BY id`)
    .all(...(partnerId ? [partnerId] : []));
  if (!agents.length) return null;
  const key = `lead.rr_cursor.${partnerId || 0}`;
  const cur = Number(getSetting(key, '0')) || 0;
  const pick = agents[cur % agents.length].id;
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(cur + 1));
  return pick;
}

function logActivity(leadId, userId, type, content) {
  db.prepare('INSERT INTO lead_activities(lead_id, user_id, type, content) VALUES(?, ?, ?, ?)').run(leadId, userId || null, type, content);
}

function logNotification(n) {
  db.prepare(`INSERT INTO notification_logs(channel, lead_id, target, template_code, content, status, provider, response)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(n.channel, n.lead_id || null, n.target || null, n.template_code || null,
    n.content || null, n.status, n.provider || null, n.response || null);
}

function getLead(id) {
  return db.prepare(`
    SELECT l.*, c.name AS campaign_name, p.name AS partner_name, u.name AS assignee_name
    FROM leads l
    LEFT JOIN campaigns c ON c.id = l.campaign_id
    LEFT JOIN partners p ON p.id = l.partner_id
    LEFT JOIN users u ON u.id = l.assignee_id
    WHERE l.id = ?`).get(id);
}

function renderTemplate(content, lead) {
  const extra = (() => { try { return JSON.parse(lead.extra_json || '{}'); } catch { return {}; } })();
  const vars = {
    이름: lead.name, 고객명: lead.name, 연락처: lead.phone, 상호: lead.company,
    업종: lead.business_type, 지역: lead.region, 매출: lead.annual_revenue, 필요자금: lead.desired_amount,
    상태: lead.status, 담당자: lead.assignee_name, 파트너: lead.partner_name, 캠페인: lead.campaign_name,
    성별: lead.gender, 연령대: lead.age_group, 구매금액: lead.sale_amount ? Number(lead.sale_amount).toLocaleString('ko-KR') : '',
    접수일: (lead.created_at || '').slice(0, 10), 콜백일시: lead.callback_at || '',
    회사대표번호: getSetting('company.phone'), 업체명: lead.partner_name || getSetting('company.name'),
    // 솔라피 템플릿에서 흔히 쓰는 이름: 회사명 = 보내는 업체, 회신번호 = 대표번호(없으면 발신번호)
    회사명: lead.partner_name || getSetting('company.name'),
    회신번호: getSetting('company.phone') || getSetting('kakao.sender_phone'),
    ...extra,
  };
  return content.replace(/#\{([^}]+)\}/g, (_, k) => (vars[k.trim()] != null ? String(vars[k.trim()]) : ''));
}

async function sendKakaoTemplate(lead, tpl, userId) {
  const text = renderTemplate(tpl.content, lead);
  let buttons = [];
  try { buttons = JSON.parse(tpl.buttons_json || '[]'); } catch { buttons = []; }
  const res = await kakao.sendAlimtalk({ to: lead.phone, templateCode: tpl.code, text, buttons, subject: tpl.name });
  logNotification({ channel: 'kakao', lead_id: lead.id, target: lead.phone, template_code: tpl.code, content: text, ...res });
  logActivity(lead.id, userId, 'kakao', `알림톡 [${tpl.name}] ${res.status === 'failed' ? '발송 실패' : res.status === 'mock' ? '발송(테스트 모드)' : '발송'}`);
  // 알림톡 결과를 텔레그램으로도 알림 (설정: fail | all | none)
  const mode = getSetting('telegram.notify_kakao', 'fail');
  if (mode === 'all' || (mode === 'fail' && res.status === 'failed')) {
    const ok = res.status !== 'failed';
    const msg = `${ok ? '✅' : '❗'} ${escapeHtml(lead.name || '고객')}님 [${escapeHtml(tpl.name)}] 알림톡 ${ok ? '발송 완료' : '발송 실패'}${ok ? '' : `\n사유: ${escapeHtml(String(res.response || '').slice(0, 200))}`}`;
    sendTelegramToLeadTargets(lead, msg).catch((e) => console.error('[telegram]', e));
  }
  return { ...res, text };
}

function templateMatches(tpl, lead) {
  if (!tpl.match_field || !tpl.match_value) return true;
  const v = String(lead[tpl.match_field] || '');
  return tpl.match_value.split(',').map((s) => s.trim()).filter(Boolean).some((m) => v.includes(m));
}

// 트리거별 자동 알림톡: 유형 조건이 맞는 템플릿 중 조건 있는 것 우선, 없으면 기본 템플릿.
// delay_minutes 가 있으면 대기열에 넣고, 발송 시점에 상태가 그대로일 때만 보낸다.
async function runKakaoTriggers(lead, triggerType, triggerValue, userId) {
  if (!lead.phone || lead.is_duplicate || lead.status === '허수') return [];
  const tpls = db.prepare(`SELECT * FROM kakao_templates WHERE active = 1 AND trigger_type = ? AND (trigger_value IS NULL OR trigger_value = '' OR trigger_value = ?)`)
    .all(triggerType, triggerValue || '');
  const specific = tpls.filter((t) => t.match_field && t.match_value && templateMatches(t, lead));
  const chosen = specific.length ? specific : tpls.filter((t) => !(t.match_field && t.match_value));
  const results = [];
  for (const t of chosen) {
    if (t.delay_minutes > 0) {
      db.prepare(`INSERT INTO scheduled_messages(lead_id, template_id, send_at, expect_status) VALUES(?, ?, datetime('now','localtime', ?), ?)`)
        .run(lead.id, t.id, `+${t.delay_minutes} minutes`, lead.status);
      logActivity(lead.id, userId, 'kakao', `알림톡 [${t.name}] 예약 (${formatDelay(t.delay_minutes)} 후)`);
      results.push({ status: 'scheduled' });
    } else {
      results.push(await sendKakaoTemplate(lead, t, userId));
    }
  }
  return results;
}

function formatDelay(m) {
  if (m % 1440 === 0) return `${m / 1440}일`;
  if (m % 60 === 0) return `${m / 60}시간`;
  return `${m}분`;
}

let schedulerBusy = false;
async function processScheduled() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const due = db.prepare(`SELECT * FROM scheduled_messages WHERE done = 0 AND send_at <= datetime('now','localtime') ORDER BY id LIMIT 50`).all();
    for (const m of due) {
      db.prepare('UPDATE scheduled_messages SET done = 1 WHERE id = ?').run(m.id);
      const lead = getLead(m.lead_id);
      const tpl = db.prepare('SELECT * FROM kakao_templates WHERE id = ? AND active = 1').get(m.template_id);
      if (!lead || !tpl) continue;
      if (m.expect_status && lead.status !== m.expect_status) {
        logActivity(lead.id, null, 'kakao', `예약 알림톡 [${tpl.name}] 취소 (상태 변경됨: ${lead.status})`);
        continue;
      }
      await sendKakaoTemplate(lead, tpl, null);
    }
  } catch (e) {
    console.error('[scheduler]', e);
  } finally {
    schedulerBusy = false;
  }
}

// 운영사 공통 채팅방 + 업체 전용 채팅방 둘 다
async function sendTelegramToLeadTargets(lead, text) {
  const targets = new Set(String(getSetting('telegram.chat_ids') || '').split(',').map((s) => s.trim()).filter(Boolean));
  if (lead.partner_id) {
    const p = db.prepare('SELECT telegram_chat_id FROM partners WHERE id = ?').get(lead.partner_id);
    if (p && p.telegram_chat_id) String(p.telegram_chat_id).split(',').map((s) => s.trim()).filter(Boolean).forEach((c) => targets.add(c));
  }
  if (!targets.size) targets.add('');
  const results = [];
  for (const chatId of targets) {
    const res = await telegram.sendMessage(chatId, text);
    logNotification({ channel: 'telegram', lead_id: lead.id, target: chatId || '(미설정)', content: text, ...res });
    results.push(res);
  }
  return results;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function notifyTelegram(lead) {
  const lines = [
    `🔔 <b>신규 DB 접수</b>${lead.is_duplicate ? ' (중복)' : ''}`,
    `이름: ${escapeHtml(lead.name)}`,
    `연락처: ${escapeHtml(lead.phone)}`,
    lead.company && `상호: ${escapeHtml(lead.company)}`,
    lead.business_type && `업종: ${escapeHtml(lead.business_type)}`,
    lead.region && `지역: ${escapeHtml(lead.region)}`,
    lead.annual_revenue && `매출: ${escapeHtml(lead.annual_revenue)}`,
    lead.desired_amount && `필요자금: ${escapeHtml(lead.desired_amount)}`,
    lead.campaign_name && `캠페인: ${escapeHtml(lead.campaign_name)}`,
    lead.ad_name && `광고: ${escapeHtml(lead.ad_name)}`,
    lead.partner_name && `파트너: ${escapeHtml(lead.partner_name)}`,
    lead.assignee_name && `담당: ${escapeHtml(lead.assignee_name)}`,
    `접수: ${lead.created_at}`,
  ].filter(Boolean);
  if (lead.source) lines.splice(1, 0, `유입: ${PLATFORMS[lead.source] || lead.source}`);
  const baseUrl = getSetting('app.base_url');
  if (baseUrl) lines.push(`<a href="${baseUrl.replace(/\/$/, '')}/#/leads/${lead.id}">CRM에서 보기</a>`);
  const text = lines.join('\n');
  const results = await sendTelegramToLeadTargets(lead, text);
  logActivity(lead.id, null, 'telegram', `텔레그램 알림 ${results.some((r) => r.status === 'sent') ? '전송' : results[0].status === 'mock' ? '(테스트 모드)' : '실패'}`);
  return results;
}

/**
 * 리드 생성 공통 진입점 (Meta 웹훅, 랜딩폼, 수동 등록, 엑셀 업로드)
 * input: { name, phone, company, ..., extra, source, campaign:{external_id,name}, ad_name, adset_name, form_name, meta_lead_id, partner_id, created_at }
 */
async function createLead(input, { userId = null, notify = true } = {}) {
  if (input.meta_lead_id) {
    const exists = db.prepare('SELECT id FROM leads WHERE meta_lead_id = ?').get(String(input.meta_lead_id));
    if (exists) return { lead: getLead(exists.id), created: false };
  }
  const phone = formatPhone(input.phone);
  const leadId = tx(() => {
    const campaignId = input.campaign_id || upsertCampaign({ platform: input.source, ...(input.campaign || {}) });
    let partnerId = input.partner_id || null;
    if (!partnerId && campaignId) {
      const c = db.prepare('SELECT partner_id FROM campaigns WHERE id = ?').get(campaignId);
      partnerId = c ? c.partner_id : null;
    }
    const dupWindow = Number(getSetting('lead.duplicate_days', '30')) || 30;
    const dup = phone ? db.prepare(`SELECT id FROM leads WHERE phone = ? AND created_at >= datetime('now','localtime', ?)`).get(phone, `-${dupWindow} days`) : null;
    const assignee = input.assignee_id || (dup ? null : pickAssignee(partnerId));
    const r = db.prepare(`INSERT INTO leads(name, phone, company, business_type, region, annual_revenue, desired_amount, gender, age_group, extra_json,
        source, landing_id, campaign_id, ad_name, adset_name, form_name, meta_lead_id, partner_id, assignee_id, status, is_duplicate, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), COALESCE(?, datetime('now','localtime')))`)
      .run(input.name || null, phone, input.company || null, input.business_type || null, input.region || null,
        input.annual_revenue || null, input.desired_amount || null, input.gender || null, input.age_group || null, JSON.stringify(input.extra || {}),
        input.source || 'manual', input.landing_id || null, campaignId, input.ad_name || null, input.adset_name || null, input.form_name || null,
        input.meta_lead_id ? String(input.meta_lead_id) : null, partnerId, assignee, '신규', dup ? 1 : 0,
        input.created_at || null, input.created_at || null);
    const id = Number(r.lastInsertRowid);
    logActivity(id, userId, 'system', `DB 접수 (${input.source || 'manual'})${dup ? ` - ${dupWindow}일 내 중복 번호 (#${dup.id})` : ''}`);
    if (assignee) {
      const u = db.prepare('SELECT name FROM users WHERE id = ?').get(assignee);
      logActivity(id, userId, 'assign', `담당자 자동 배정: ${u ? u.name : assignee}`);
    }
    return id;
  });
  const lead = getLead(leadId);
  if (notify) {
    // 알림 실패가 리드 저장을 막지 않도록 백그라운드 처리
    Promise.resolve()
      .then(() => notifyTelegram(lead))
      .then(() => runKakaoTriggers(lead, 'lead_created', null, userId))
      .catch((e) => console.error('[notify]', e));
  }
  return { lead, created: true };
}

async function changeStatus(leadId, status, userId) {
  const before = getLead(leadId);
  if (!before) throw new Error('not found');
  if (before.status === status) return before;
  db.prepare("UPDATE leads SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, leadId);
  markFirstContact(leadId);
  logActivity(leadId, userId, 'status', `상태 변경: ${before.status} → ${status}`);
  const lead = getLead(leadId);
  runKakaoTriggers(lead, 'status_change', status, userId).catch((e) => console.error('[kakao]', e));
  return lead;
}

// 신규 DB 에 처음 손댄 시각 = 응답 속도 측정 기준
function markFirstContact(leadId) {
  db.prepare("UPDATE leads SET first_contact_at = datetime('now','localtime') WHERE id = ? AND first_contact_at IS NULL").run(leadId);
}

module.exports = {
  STATUSES, WON, CLOSED, PLATFORMS, markFirstContact, processScheduled, sendTelegramToLeadTargets, mapFields, formatPhone, upsertCampaign, createLead, changeStatus, getLead,
  logActivity, logNotification, renderTemplate, sendKakaoTemplate, notifyTelegram,
};
