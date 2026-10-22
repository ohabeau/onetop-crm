const express = require('express');
const crypto = require('crypto');
const { db, getSetting, setSetting } = require('../db');
const auth = require('../auth');
const leads = require('../services/leads');
const meta = require('../adapters/meta');
const telegram = require('../adapters/telegram');
const kakao = require('../adapters/kakao');

const router = express.Router();
const { requireAuth, requireRole } = auth;
const isAdmin = requireRole('admin');
const isManager = requireRole('admin', 'manager');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function today() {
  const d = new Date(Date.now() + 9 * 3600e3); // KST
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date(Date.now() + 9 * 3600e3 - n * 86400e3);
  return d.toISOString().slice(0, 10);
}
function range(q) {
  return { from: q.from || daysAgo(29), to: q.to || today() };
}

/* ───────────── 인증 ───────────── */

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || ''));
  if (!u || !auth.verifyPassword(String(password || ''), u.password_hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  const token = auth.createSession(u.id);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

router.post('/auth/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, statuses: leads.STATUSES, companyName: getSetting('company.name', '리드CRM') });
});

router.post('/me/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!auth.verifyPassword(String(current || ''), u.password_hash)) return res.status(400).json({ error: '현재 비밀번호가 틀립니다.' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(next)), req.user.id);
  res.json({ ok: true });
});

/* ───────────── 대시보드 / 광고 성과 ───────────── */

function campaignScope(user, partnerFilter) {
  const pid = user.partner_id || partnerFilter;
  return pid ? { sql: 'c.partner_id = ?', params: [pid] } : { sql: '1=1', params: [] };
}

function inList(arr) {
  return arr.map((s) => `'${s}'`).join(',');
}
const WON_SQL = inList(leads.WON);

// 공통 집계: 리드 조건(lw/lp), 광고비 조건(sw/sp)
function dashScope(req) {
  const { from, to } = range(req.query);
  const scope = auth.scopeClause(req.user);
  const partnerFilter = req.query.partner_id && !req.user.partner_id ? Number(req.query.partner_id) : null;
  const cs = campaignScope(req.user, partnerFilter);
  const lw = `${scope.sql} AND date(l.created_at) BETWEEN ? AND ?${partnerFilter ? ' AND l.partner_id = ?' : ''}`;
  const lp = [...scope.params, from, to, ...(partnerFilter ? [partnerFilter] : [])];
  const sw = `${cs.sql} AND s.date BETWEEN ? AND ?`;
  const sp = [...cs.params, from, to];
  return { from, to, scope, partnerFilter, lw, lp, sw, sp };
}

router.get('/dashboard', requireAuth, (req, res) => {
  const { from, to, scope, partnerFilter, lw, lp, sw, sp } = dashScope(req);
  const showMoney = req.user.role !== 'agent';

  const k = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN is_duplicate = 0 AND status != '허수' THEN 1 ELSE 0 END) valid,
      SUM(CASE WHEN status IN (${WON_SQL}) THEN 1 ELSE 0 END) won,
      SUM(CASE WHEN status IN (${WON_SQL}) THEN sale_amount ELSE 0 END) revenue,
      SUM(CASE WHEN status = '신규' THEN 1 ELSE 0 END) untouched,
      SUM(CASE WHEN status = '허수' THEN 1 ELSE 0 END) junk,
      SUM(is_duplicate) dups,
      AVG(CASE WHEN first_contact_at IS NOT NULL THEN (julianday(first_contact_at) - julianday(created_at)) * 1440 END) resp
    FROM leads l WHERE ${lw}`).get(...lp);
  const spend = db.prepare(`SELECT COALESCE(SUM(spend),0) spend, COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(clicks),0) clicks
    FROM ad_stats s JOIN campaigns c ON c.id = s.campaign_id WHERE ${sw}`).get(...sp);
  const todayCount = db.prepare(`SELECT COUNT(*) n FROM leads l WHERE ${scope.sql} AND date(l.created_at) = ?${partnerFilter ? ' AND l.partner_id = ?' : ''}`)
    .get(...scope.params, today(), ...(partnerFilter ? [partnerFilter] : [])).n;

  const leadDaily = db.prepare(`SELECT date(l.created_at) d, COUNT(*) n, SUM(CASE WHEN status IN (${WON_SQL}) THEN 1 ELSE 0 END) c,
      SUM(CASE WHEN status IN (${WON_SQL}) THEN sale_amount ELSE 0 END) rev
    FROM leads l WHERE ${lw} GROUP BY d`).all(...lp);
  const spendDaily = db.prepare(`SELECT s.date d, SUM(spend) spend FROM ad_stats s JOIN campaigns c ON c.id = s.campaign_id WHERE ${sw} GROUP BY d`).all(...sp);
  const days = [];
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d = new Date(d.getTime() + 86400e3)) days.push(d.toISOString().slice(0, 10));
  const lm = Object.fromEntries(leadDaily.map((r) => [r.d, r]));
  const sm = Object.fromEntries(spendDaily.map((r) => [r.d, r.spend]));
  const daily = days.map((d) => ({
    date: d, leads: lm[d] ? lm[d].n : 0, won: lm[d] ? lm[d].c : 0,
    spend: showMoney ? (sm[d] || 0) : null, revenue: showMoney ? (lm[d] ? lm[d].rev : 0) : null,
  }));

  // 매체별: DB 수, 광고비, DB 단가
  const platLeads = db.prepare(`SELECT l.source p, COUNT(*) n, SUM(CASE WHEN l.is_duplicate = 0 AND l.status != '허수' THEN 1 ELSE 0 END) v
    FROM leads l WHERE ${lw} GROUP BY l.source`).all(...lp);
  const platSpend = db.prepare(`SELECT c.platform p, SUM(spend) spend FROM ad_stats s JOIN campaigns c ON c.id = s.campaign_id WHERE ${sw} GROUP BY c.platform`).all(...sp);
  const platKeys = [...new Set([...platLeads.map((r) => r.p), ...platSpend.map((r) => r.p)])];
  const byPlatform = platKeys.map((p) => {
    const L = platLeads.find((r) => r.p === p) || { n: 0, v: 0 };
    const S = platSpend.find((r) => r.p === p) || { spend: 0 };
    return { platform: p, label: leads.PLATFORMS[p] || p, leads: L.n, valid: L.v, spend: showMoney ? S.spend : null, cpl: showMoney && L.v && S.spend ? Math.round(S.spend / L.v) : null };
  }).sort((a, b) => b.leads - a.leads);

  const byStatus = db.prepare(`SELECT status, COUNT(*) n FROM leads l WHERE ${lw} GROUP BY status`).all(...lp);
  const byType = db.prepare(`SELECT COALESCE(NULLIF(l.business_type,''),'(미입력)') label, COUNT(*) n FROM leads l WHERE ${lw} GROUP BY label ORDER BY n DESC LIMIT 8`).all(...lp).map((r) => ({ name: r.label, n: r.n }));
  const byHour = db.prepare(`SELECT CAST(strftime('%H', l.created_at) AS INTEGER) h, COUNT(*) n FROM leads l WHERE ${lw} GROUP BY h`).all(...lp);
  const hours = Array.from({ length: 24 }, (_, h) => (byHour.find((r) => r.h === h) || { n: 0 }).n);

  // 인구통계: 구매자 vs 허수
  const demo = (cond) => {
    const rows = db.prepare(`SELECT age_group a, gender g, COUNT(*) n FROM leads l WHERE ${lw} AND ${cond} AND age_group IS NOT NULL AND gender IS NOT NULL GROUP BY a, g ORDER BY n DESC`).all(...lp);
    const total = rows.reduce((s, r) => s + r.n, 0);
    return rows.slice(0, 5).map((r) => ({ label: `${r.a} ${r.g === '남' ? '남성' : '여성'}`, n: r.n, pct: total ? Math.round(100 * r.n / total) : 0 }));
  };

  const recent = db.prepare(`SELECT l.id, l.name, l.phone, l.status, l.source, l.created_at, l.business_type, l.is_duplicate, c.name campaign_name, u.name assignee_name
    FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id LEFT JOIN users u ON u.id = l.assignee_id
    WHERE ${scope.sql}${partnerFilter ? ' AND l.partner_id = ?' : ''} ORDER BY l.created_at DESC, l.id DESC LIMIT 8`).all(...scope.params, ...(partnerFilter ? [partnerFilter] : []));
  const callbacks = db.prepare(`SELECT l.id, l.name, l.phone, l.status, l.callback_at FROM leads l
    WHERE ${scope.sql} AND l.callback_at IS NOT NULL AND date(l.callback_at) <= ? AND l.status NOT IN (${inList(leads.CLOSED)})
    ORDER BY l.callback_at LIMIT 10`).all(...scope.params, today());

  res.json({
    range: { from, to },
    kpi: {
      total: k.total || 0, valid: k.valid || 0, won: k.won || 0, untouched: k.untouched || 0, junk: k.junk || 0, dups: k.dups || 0, today: todayCount,
      revenue: showMoney ? (k.revenue || 0) : null,
      spend: showMoney ? spend.spend : null, impressions: spend.impressions, clicks: spend.clicks,
      cpl: showMoney && k.valid ? Math.round(spend.spend / k.valid) : null,
      cpa: showMoney && k.won ? Math.round(spend.spend / k.won) : null,
      roas: showMoney && spend.spend ? Math.round(100 * (k.revenue || 0) / spend.spend) : null,
      convRate: k.valid ? +(100 * (k.won || 0) / k.valid).toFixed(1) : 0,
      ctr: spend.impressions ? +(100 * spend.clicks / spend.impressions).toFixed(2) : 0,
      respMinutes: k.resp != null ? Math.round(k.resp) : null,
    },
    daily, byPlatform, byStatus, byType, hours,
    demographics: { buyers: demo(`status IN (${WON_SQL})`), junk: demo(`status = '허수'`) },
    recent, callbacks,
  });
});

// 캠페인 / 타겟(광고세트) / 광고 단위 효율: 광고비, DB 수, DB 단가, 구매, 매출, ROAS
router.get('/ad-performance', requireAuth, isManager, (req, res) => {
  const { from, to, lw, lp, sw, sp } = dashScope(req);
  const level = ['campaign', 'adset', 'ad'].includes(req.query.level) ? req.query.level : 'campaign';
  const keyL = { campaign: 'l.campaign_id', adset: "l.campaign_id || '|' || COALESCE(l.adset_name,'')", ad: "l.campaign_id || '|' || COALESCE(l.adset_name,'') || '|' || COALESCE(l.ad_name,'')" }[level];
  const keyS = { campaign: 's.campaign_id', adset: "s.campaign_id || '|' || s.adset_name", ad: "s.campaign_id || '|' || s.adset_name || '|' || s.ad_name" }[level];
  const L = db.prepare(`SELECT ${keyL} k, l.campaign_id cid, MAX(l.adset_name) adset_name, MAX(l.ad_name) ad_name, COUNT(*) leads,
      SUM(CASE WHEN l.is_duplicate = 0 AND l.status != '허수' THEN 1 ELSE 0 END) valid,
      SUM(CASE WHEN l.status IN (${WON_SQL}) THEN 1 ELSE 0 END) won,
      SUM(CASE WHEN l.status IN (${WON_SQL}) THEN l.sale_amount ELSE 0 END) revenue
    FROM leads l WHERE ${lw} AND l.campaign_id IS NOT NULL GROUP BY k`).all(...lp);
  const S = db.prepare(`SELECT ${keyS} k, s.campaign_id cid, MAX(s.adset_name) adset_name, MAX(s.ad_name) ad_name,
      SUM(spend) spend, SUM(impressions) impressions, SUM(clicks) clicks
    FROM ad_stats s JOIN campaigns c ON c.id = s.campaign_id WHERE ${sw} ${level !== 'campaign' ? "AND s.adset_name != ''" : ''} ${level === 'ad' ? "AND s.ad_name != ''" : ''} GROUP BY k`).all(...sp);
  const camps = Object.fromEntries(db.prepare('SELECT c.id, c.name, c.platform, c.status, c.external_id, c.partner_id, p.name partner_name FROM campaigns c LEFT JOIN partners p ON p.id = c.partner_id').all().map((c) => [c.id, c]));
  const map = new Map();
  for (const r of S) map.set(String(r.k), { ...r, leads: 0, valid: 0, won: 0, revenue: 0 });
  for (const r of L) {
    const cur = map.get(String(r.k)) || { k: r.k, cid: r.cid, adset_name: r.adset_name, ad_name: r.ad_name, spend: 0, impressions: 0, clicks: 0 };
    map.set(String(r.k), { ...cur, leads: r.leads, valid: r.valid, won: r.won, revenue: r.revenue });
  }
  const rows = [...map.values()].map((r) => {
    const c = camps[r.cid] || {};
    return {
      key: r.k, campaign_id: r.cid, campaign_name: c.name, platform: c.platform, platform_label: leads.PLATFORMS[c.platform] || c.platform,
      partner_name: c.partner_name, adset_name: r.adset_name || '', ad_name: r.ad_name || '',
      spend: r.spend || 0, impressions: r.impressions || 0, clicks: r.clicks || 0, leads: r.leads || 0, valid: r.valid || 0, won: r.won || 0, revenue: r.revenue || 0,
      ctr: r.impressions ? +(100 * r.clicks / r.impressions).toFixed(2) : null,
      cpl: r.valid && r.spend ? Math.round(r.spend / r.valid) : null,
      cpa: r.won && r.spend ? Math.round(r.spend / r.won) : null,
      roas: r.spend ? Math.round(100 * (r.revenue || 0) / r.spend) : null,
      convRate: r.valid ? +(100 * r.won / r.valid).toFixed(1) : null,
    };
  }).sort((a, b) => b.spend - a.spend || b.leads - a.leads);

  // 효율 1위: 광고비가 있고 유효 DB 가 2건 이상인 항목 중 DB 단가가 가장 낮은 것 (평균 대비 % 저렴)
  const best = {};
  for (const lv of ['campaign', 'adset', 'ad']) {
    const kL = { campaign: 'l.campaign_id', adset: "COALESCE(l.adset_name,'')", ad: "COALESCE(l.ad_name,'')" }[lv];
    const kS = { campaign: 's.campaign_id', adset: 's.adset_name', ad: 's.ad_name' }[lv];
    const ls = db.prepare(`SELECT ${kL} k, SUM(CASE WHEN l.is_duplicate = 0 AND l.status != '허수' THEN 1 ELSE 0 END) v FROM leads l WHERE ${lw} GROUP BY k`).all(...lp);
    const ss = db.prepare(`SELECT ${kS} k, SUM(spend) spend FROM ad_stats s JOIN campaigns c ON c.id = s.campaign_id WHERE ${sw} ${lv !== 'campaign' ? `AND ${kS} != ''` : ''} GROUP BY k`).all(...sp);
    const cand = ss.map((s) => ({ k: s.k, spend: s.spend, v: (ls.find((l) => String(l.k) === String(s.k)) || { v: 0 }).v })).filter((x) => x.v >= 2 && x.spend > 0)
      .map((x) => ({ ...x, cpl: Math.round(x.spend / x.v) }));
    if (!cand.length) { best[lv] = null; continue; }
    const avg = cand.reduce((s, x) => s + x.spend, 0) / cand.reduce((s, x) => s + x.v, 0);
    const top = cand.sort((a, b) => a.cpl - b.cpl)[0];
    best[lv] = { name: lv === 'campaign' ? (camps[top.k] || {}).name : top.k, cpl: top.cpl, leads: top.v, avgCpl: Math.round(avg), cheaperPct: Math.max(0, Math.round(100 * (1 - top.cpl / avg))) };
  }
  res.json({ range: { from, to }, level, rows, best });
});

// 직원별 응답 속도 / 성과
router.get('/staff-performance', requireAuth, isManager, (req, res) => {
  const { lw, lp } = dashScope(req);
  const rows = db.prepare(`SELECT u.id, u.name, u.role, COUNT(l.id) assigned,
      SUM(CASE WHEN l.first_contact_at IS NOT NULL THEN 1 ELSE 0 END) contacted,
      SUM(CASE WHEN l.status = '신규' THEN 1 ELSE 0 END) untouched,
      AVG(CASE WHEN l.first_contact_at IS NOT NULL THEN (julianday(l.first_contact_at) - julianday(l.created_at)) * 1440 END) resp,
      SUM(CASE WHEN l.first_contact_at IS NOT NULL AND (julianday(l.first_contact_at) - julianday(l.created_at)) * 1440 <= 5 THEN 1 ELSE 0 END) within5,
      SUM(CASE WHEN l.status IN (${WON_SQL}) THEN 1 ELSE 0 END) won,
      SUM(CASE WHEN l.status IN (${WON_SQL}) THEN l.sale_amount ELSE 0 END) revenue
    FROM leads l JOIN users u ON u.id = l.assignee_id WHERE ${lw} GROUP BY u.id ORDER BY assigned DESC`).all(...lp);
  res.json(rows.map((r) => ({ ...r, resp: r.resp != null ? Math.round(r.resp) : null, convRate: r.assigned ? +(100 * r.won / r.assigned).toFixed(1) : 0 })));
});

router.get('/campaigns', requireAuth, (req, res) => {
  const cs = campaignScope(req.user);
  res.json(db.prepare(`SELECT c.*, p.name partner_name FROM campaigns c LEFT JOIN partners p ON p.id = c.partner_id WHERE ${cs.sql} ORDER BY c.id DESC`).all(...cs.params));
});

router.post('/campaigns', requireAuth, isAdmin, (req, res) => {
  const { name, external_id, partner_id, platform } = req.body || {};
  if (!name) return res.status(400).json({ error: '캠페인명을 입력하세요.' });
  const r = db.prepare('INSERT INTO campaigns(name, external_id, partner_id, platform) VALUES(?, ?, ?, ?)').run(name, external_id || null, partner_id || null, platform || 'meta');
  res.json({ id: Number(r.lastInsertRowid) });
});

router.put('/campaigns/:id', requireAuth, isAdmin, (req, res) => {
  const { name, external_id, partner_id, status, platform } = req.body || {};
  db.prepare('UPDATE campaigns SET name = COALESCE(?, name), external_id = ?, partner_id = ?, status = COALESCE(?, status), platform = COALESCE(?, platform) WHERE id = ?')
    .run(name || null, external_id || null, partner_id || null, status || null, platform || null, req.params.id);
  // 파트너 지정 시, 미배정 리드도 해당 파트너로 귀속
  if (partner_id) db.prepare('UPDATE leads SET partner_id = ? WHERE campaign_id = ? AND partner_id IS NULL').run(partner_id, req.params.id);
  res.json({ ok: true });
});

function saveStat(campaignId, adset, ad, date, spend, impressions, clicks) {
  db.prepare(`INSERT INTO ad_stats(campaign_id, adset_name, ad_name, date, spend, impressions, clicks) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, adset_name, ad_name, date) DO UPDATE SET spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks`)
    .run(campaignId, adset || '', ad || '', date, Math.round(Number(spend) || 0), Number(impressions) || 0, Number(clicks) || 0);
}

router.get('/ad-stats', requireAuth, isManager, (req, res) => {
  const { from, to } = range(req.query);
  const cs = campaignScope(req.user);
  res.json(db.prepare(`SELECT s.*, c.name campaign_name, c.platform FROM ad_stats s JOIN campaigns c ON c.id = s.campaign_id
    WHERE ${cs.sql} AND s.date BETWEEN ? AND ? ORDER BY s.date DESC, s.id DESC LIMIT 500`).all(...cs.params, from, to));
});

router.delete('/ad-stats/:id', requireAuth, isAdmin, (req, res) => {
  db.prepare('DELETE FROM ad_stats WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 일자별 광고비 수동 입력 (Meta 연동 전/타 매체용)
router.post('/ad-stats', requireAuth, isAdmin, (req, res) => {
  const { campaign_id, date, spend, impressions, clicks, adset_name, ad_name } = req.body || {};
  if (!campaign_id || !date) return res.status(400).json({ error: '캠페인과 날짜는 필수입니다.' });
  saveStat(campaign_id, adset_name, ad_name, date, spend, impressions, clicks);
  res.json({ ok: true });
});

router.post('/meta/sync-insights', requireAuth, isAdmin, wrap(async (req, res) => {
  const { from, to } = range(req.body || {});
  const rows = await meta.fetchInsights(from, to);
  if (rows === null) return res.status(400).json({ error: '설정에서 Meta 광고 계정 ID와 액세스 토큰을 먼저 입력하세요.' });
  let n = 0;
  for (const r of rows) {
    const cid = leads.upsertCampaign({ external_id: r.campaign_id, name: r.campaign_name, platform: 'meta' });
    saveStat(cid, r.adset_name, r.ad_name, r.date_start, r.spend, r.impressions, r.clicks);
    n++;
  }
  setSetting('meta.last_sync', new Date().toISOString());
  res.json({ ok: true, rows: n });
}));

/* ───────────── 리드(CRM) ───────────── */

function leadFilters(req) {
  const scope = auth.scopeClause(req.user);
  const where = [scope.sql];
  const params = [...scope.params];
  const q = req.query;
  if (q.from) { where.push('date(l.created_at) >= ?'); params.push(q.from); }
  if (q.to) { where.push('date(l.created_at) <= ?'); params.push(q.to); }
  if (q.status) { where.push(`l.status IN (${q.status.split(',').map(() => '?').join(',')})`); params.push(...q.status.split(',')); }
  if (q.campaign_id) { where.push('l.campaign_id = ?'); params.push(q.campaign_id); }
  if (q.partner_id && !req.user.partner_id) { where.push('l.partner_id = ?'); params.push(q.partner_id); }
  if (q.assignee_id) {
    if (q.assignee_id === 'none') where.push('l.assignee_id IS NULL');
    else { where.push('l.assignee_id = ?'); params.push(q.assignee_id); }
  }
  if (q.source) { where.push('l.source = ?'); params.push(q.source); }
  if (q.landing_id) { where.push('l.landing_id = ?'); params.push(q.landing_id); }
  if (q.hide_dup === '1') where.push("l.is_duplicate = 0 AND l.status != '허수'");
  if (q.q) {
    where.push('(l.name LIKE ? OR l.phone LIKE ? OR l.company LIKE ? OR l.business_type LIKE ? OR l.region LIKE ? OR REPLACE(l.phone,\'-\',\'\') LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like, like, like, `%${String(q.q).replace(/-/g, '')}%`);
  }
  return { sql: where.join(' AND '), params };
}

const LEAD_SELECT = `SELECT l.*, c.name campaign_name, p.name partner_name, u.name assignee_name
  FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id LEFT JOIN partners p ON p.id = l.partner_id LEFT JOIN users u ON u.id = l.assignee_id`;

router.get('/leads', requireAuth, (req, res) => {
  const f = leadFilters(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(200, Math.max(10, Number(req.query.size) || 50));
  const total = db.prepare(`SELECT COUNT(*) n FROM leads l WHERE ${f.sql}`).get(...f.params).n;
  const rows = db.prepare(`${LEAD_SELECT} WHERE ${f.sql} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`).all(...f.params, size, (page - 1) * size);
  const counts = db.prepare(`SELECT l.status, COUNT(*) n FROM leads l WHERE ${auth.scopeClause(req.user).sql} GROUP BY l.status`).all(...auth.scopeClause(req.user).params);
  res.json({ total, page, size, rows, counts });
});

router.get('/leads/export.csv', requireAuth, isManager, (req, res) => {
  const f = leadFilters(req);
  const rows = db.prepare(`${LEAD_SELECT} WHERE ${f.sql} ORDER BY l.created_at DESC, l.id DESC`).all(...f.params);
  const cols = [['id', 'ID'], ['created_at', '접수일시'], ['name', '이름'], ['phone', '연락처'], ['company', '상호'], ['business_type', '업종'],
    ['region', '지역'], ['annual_revenue', '매출'], ['desired_amount', '필요자금'], ['gender', '성별'], ['age_group', '연령대'],
    ['status', '상태'], ['sale_amount', '구매금액'], ['first_contact_at', '첫응대'], ['assignee_name', '담당자'],
    ['partner_name', '파트너'], ['campaign_name', '캠페인'], ['adset_name', '광고세트'], ['ad_name', '광고'], ['form_name', '양식'], ['source', '유입'], ['extra_json', '기타응답']];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map((c) => esc(c[1])).join(','), ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_${today()}.csv"`);
  res.send(csv);
});

function canAccessLead(user, lead) {
  if (!lead) return false;
  if (user.partner_id && lead.partner_id !== user.partner_id) return false;
  if (user.role === 'agent' && lead.assignee_id !== user.id) return false;
  return true;
}

router.get('/leads/:id', requireAuth, (req, res) => {
  const lead = leads.getLead(Number(req.params.id));
  if (!canAccessLead(req.user, lead)) return res.status(404).json({ error: '없는 DB 입니다.' });
  const activities = db.prepare(`SELECT a.*, u.name user_name FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id WHERE lead_id = ? ORDER BY a.id DESC`).all(lead.id);
  const notifications = db.prepare('SELECT * FROM notification_logs WHERE lead_id = ? ORDER BY id DESC').all(lead.id);
  const same = lead.phone ? db.prepare(`SELECT id, name, status, created_at FROM leads WHERE phone = ? AND id != ? ORDER BY id DESC`).all(lead.phone, lead.id) : [];
  res.json({ lead, activities, notifications, samePhone: same });
});

router.post('/leads', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name && !b.phone) return res.status(400).json({ error: '이름 또는 연락처를 입력하세요.' });
  const { lead } = await leads.createLead({
    name: b.name, phone: b.phone, company: b.company, business_type: b.business_type, region: b.region,
    annual_revenue: b.annual_revenue, desired_amount: b.desired_amount, extra: b.extra || {},
    source: b.source || 'manual', campaign_id: b.campaign_id ? Number(b.campaign_id) : null,
    partner_id: req.user.partner_id || (b.partner_id ? Number(b.partner_id) : null),
    assignee_id: req.user.role === 'agent' ? req.user.id : (b.assignee_id ? Number(b.assignee_id) : null),
  }, { userId: req.user.id, notify: b.notify !== false });
  res.json({ id: lead.id });
}));

router.put('/leads/:id', requireAuth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  let lead = leads.getLead(id);
  if (!canAccessLead(req.user, lead)) return res.status(404).json({ error: '없는 DB 입니다.' });
  const b = req.body || {};
  const editable = ['name', 'phone', 'company', 'business_type', 'region', 'annual_revenue', 'desired_amount', 'gender', 'age_group', 'callback_at', 'sale_amount'];
  const changes = [];
  for (const k of editable) {
    if (k in b && String(b[k] || '') !== String(lead[k] || '')) {
      const v = k === 'phone' ? leads.formatPhone(b[k]) : k === 'sale_amount' ? (Number(String(b[k]).replace(/[^0-9]/g, '')) || 0) : (b[k] || null);
      db.prepare(`UPDATE leads SET ${k} = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(v, id);
      changes.push(k);
    }
  }
  if (changes.includes('callback_at')) leads.logActivity(id, req.user.id, 'memo', b.callback_at ? `콜백 예약: ${b.callback_at.replace('T', ' ')}` : '콜백 예약 해제');
  if (changes.filter((c) => c !== 'callback_at').length) leads.logActivity(id, req.user.id, 'system', `정보 수정 (${changes.filter((c) => c !== 'callback_at').join(', ')})`);
  if ('assignee_id' in b && req.user.role !== 'agent') {
    const aid = b.assignee_id ? Number(b.assignee_id) : null;
    if (aid !== lead.assignee_id) {
      db.prepare("UPDATE leads SET assignee_id = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(aid, id);
      const u = aid ? db.prepare('SELECT name FROM users WHERE id = ?').get(aid) : null;
      leads.logActivity(id, req.user.id, 'assign', `담당자 변경: ${lead.assignee_name || '없음'} → ${u ? u.name : '없음'}`);
    }
  }
  if ('partner_id' in b && !req.user.partner_id) {
    db.prepare('UPDATE leads SET partner_id = ? WHERE id = ?').run(b.partner_id ? Number(b.partner_id) : null, id);
  }
  if (b.status && leads.STATUSES.includes(b.status)) await leads.changeStatus(id, b.status, req.user.id);
  lead = leads.getLead(id);
  res.json({ lead });
}));

// 일괄 처리: 상태 변경 / 담당자 배정
router.post('/leads/bulk', requireAuth, isManager, wrap(async (req, res) => {
  const { ids = [], status, assignee_id } = req.body || {};
  let n = 0;
  for (const id of ids.map(Number)) {
    const lead = leads.getLead(id);
    if (!canAccessLead(req.user, lead)) continue;
    if (assignee_id !== undefined) {
      const aid = assignee_id ? Number(assignee_id) : null;
      db.prepare('UPDATE leads SET assignee_id = ? WHERE id = ?').run(aid, id);
      const u = aid ? db.prepare('SELECT name FROM users WHERE id = ?').get(aid) : null;
      leads.logActivity(id, req.user.id, 'assign', `담당자 일괄 배정: ${u ? u.name : '없음'}`);
    }
    if (status && leads.STATUSES.includes(status)) await leads.changeStatus(id, status, req.user.id);
    n++;
  }
  res.json({ ok: true, count: n });
}));

router.delete('/leads/:id', requireAuth, isAdmin, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/leads/:id/memo', requireAuth, (req, res) => {
  const lead = leads.getLead(Number(req.params.id));
  if (!canAccessLead(req.user, lead)) return res.status(404).json({ error: '없는 DB 입니다.' });
  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: '메모 내용을 입력하세요.' });
  leads.logActivity(lead.id, req.user.id, 'memo', content);
  leads.markFirstContact(lead.id);
  db.prepare("UPDATE leads SET updated_at = datetime('now','localtime') WHERE id = ?").run(lead.id);
  res.json({ ok: true });
});

router.post('/leads/:id/kakao', requireAuth, wrap(async (req, res) => {
  const lead = leads.getLead(Number(req.params.id));
  if (!canAccessLead(req.user, lead)) return res.status(404).json({ error: '없는 DB 입니다.' });
  const tpl = db.prepare('SELECT * FROM kakao_templates WHERE id = ?').get((req.body || {}).template_id);
  if (!tpl) return res.status(400).json({ error: '템플릿을 선택하세요.' });
  const r = await leads.sendKakaoTemplate(lead, tpl, req.user.id);
  leads.markFirstContact(lead.id);
  res.json(r);
}));

router.post('/leads/:id/telegram', requireAuth, isManager, wrap(async (req, res) => {
  const lead = leads.getLead(Number(req.params.id));
  if (!canAccessLead(req.user, lead)) return res.status(404).json({ error: '없는 DB 입니다.' });
  res.json(await leads.notifyTelegram(lead));
}));

// CSV 업로드(엑셀에서 CSV 저장): 헤더 행 기반 매핑
router.post('/leads/import', requireAuth, isManager, wrap(async (req, res) => {
  const { csv, campaign_id, notify } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'CSV 내용이 없습니다.' });
  const rows = parseCsv(String(csv).replace(/^﻿/, ''));
  if (rows.length < 2) return res.status(400).json({ error: '데이터 행이 없습니다.' });
  const header = rows[0];
  let n = 0;
  for (const r of rows.slice(1)) {
    if (!r.some((c) => c && c.trim())) continue;
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i]; });
    const mapped = leads.mapFields(obj);
    await leads.createLead({ ...mapped, source: 'import', campaign_id: campaign_id ? Number(campaign_id) : null, partner_id: req.user.partner_id || null },
      { userId: req.user.id, notify: !!notify });
    n++;
  }
  res.json({ ok: true, count: n });
}));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}

/* ───────────── 알림톡 템플릿 / 발송 로그 ───────────── */

router.get('/kakao-templates', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM kakao_templates ORDER BY id').all());
});

router.post('/kakao-templates', requireAuth, isAdmin, (req, res) => {
  const t = req.body || {};
  if (!t.code || !t.name || !t.content) return res.status(400).json({ error: '템플릿 코드, 이름, 내용은 필수입니다.' });
  try {
    const r = db.prepare(`INSERT INTO kakao_templates(code, name, content, buttons_json, trigger_type, trigger_value, delay_minutes, match_field, match_value, active)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.code, t.name, t.content, t.buttons_json || null, t.trigger_type || 'manual',
      t.trigger_value || null, Number(t.delay_minutes) || 0, t.match_field || null, t.match_value || null, t.active === false ? 0 : 1);
    res.json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? '이미 있는 템플릿 코드입니다.' : e.message });
  }
});

router.put('/kakao-templates/:id', requireAuth, isAdmin, (req, res) => {
  const t = req.body || {};
  db.prepare(`UPDATE kakao_templates SET code=?, name=?, content=?, buttons_json=?, trigger_type=?, trigger_value=?, delay_minutes=?, match_field=?, match_value=?, active=? WHERE id=?`)
    .run(t.code, t.name, t.content, t.buttons_json || null, t.trigger_type || 'manual', t.trigger_value || null, Number(t.delay_minutes) || 0,
      t.match_field || null, t.match_value || null, t.active === false || t.active === 0 ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

router.delete('/kakao-templates/:id', requireAuth, isAdmin, (req, res) => {
  db.prepare('DELETE FROM kakao_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/kakao-templates/:id/preview', requireAuth, (req, res) => {
  const tpl = db.prepare('SELECT * FROM kakao_templates WHERE id = ?').get(req.params.id);
  const lead = req.body && req.body.lead_id ? leads.getLead(Number(req.body.lead_id)) : {
    name: '홍길동', phone: '010-1234-5678', company: '길동상사', business_type: '제조업', region: '서울', annual_revenue: '5억', desired_amount: '1억',
    status: '예약완료', assignee_name: '김상담', gender: '여', age_group: '30대', sale_amount: 1200000, created_at: today(), callback_at: `${today()} 14:00`,
  };
  res.json({ text: leads.renderTemplate(tpl.content, lead) });
});

router.get('/notifications', requireAuth, isManager, (req, res) => {
  const where = [];
  const params = [];
  if (req.query.channel) { where.push('n.channel = ?'); params.push(req.query.channel); }
  if (req.query.status) { where.push('n.status = ?'); params.push(req.query.status); }
  if (req.user.partner_id) { where.push('l.partner_id = ?'); params.push(req.user.partner_id); }
  const rows = db.prepare(`SELECT n.*, l.name lead_name FROM notification_logs n LEFT JOIN leads l ON l.id = n.lead_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY n.id DESC LIMIT 300`).all(...params);
  res.json(rows);
});

router.get('/webhook-logs', requireAuth, isAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 100').all());
});

/* ───────────── 파트너 / 사용자 ───────────── */

router.get('/partners', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM leads WHERE partner_id = p.id) lead_count,
      (SELECT COUNT(*) FROM users WHERE partner_id = p.id) user_count FROM partners p
      ${req.user.partner_id ? 'WHERE p.id = ?' : ''} ORDER BY p.id`).all(...(req.user.partner_id ? [req.user.partner_id] : []));
  res.json(rows);
});

router.post('/partners', requireAuth, isAdmin, (req, res) => {
  const { name, telegram_chat_id, plan, seats } = req.body || {};
  if (!name) return res.status(400).json({ error: '업체명을 입력하세요.' });
  const r = db.prepare('INSERT INTO partners(name, telegram_chat_id, plan, seats) VALUES(?, ?, ?, ?)').run(name, telegram_chat_id || null, plan || '일반', Number(seats) || 3);
  res.json({ id: Number(r.lastInsertRowid) });
});

router.put('/partners/:id', requireAuth, isAdmin, (req, res) => {
  const { name, telegram_chat_id, active, plan, seats } = req.body || {};
  db.prepare('UPDATE partners SET name = ?, telegram_chat_id = ?, active = ?, plan = COALESCE(?, plan), seats = COALESCE(?, seats) WHERE id = ?')
    .run(name, telegram_chat_id || null, active === false || active === 0 ? 0 : 1, plan || null, seats ? Number(seats) : null, req.params.id);
  res.json({ ok: true });
});

router.get('/users', requireAuth, (req, res) => {
  const where = req.user.partner_id ? 'WHERE u.partner_id = ?' : '';
  res.json(db.prepare(`SELECT u.id, u.username, u.name, u.role, u.partner_id, u.active, u.created_at, p.name partner_name,
      (SELECT COUNT(*) FROM leads WHERE assignee_id = u.id) lead_count
    FROM users u LEFT JOIN partners p ON p.id = u.partner_id ${where} ORDER BY u.id`).all(...(req.user.partner_id ? [req.user.partner_id] : [])));
});

router.post('/users', requireAuth, isManager, (req, res) => {
  const { username, password, name, role, partner_id } = req.body || {};
  if (!username || !password || !name) return res.status(400).json({ error: '아이디, 비밀번호, 이름은 필수입니다.' });
  const r = req.user.role === 'admin' ? (role || 'agent') : 'agent';
  const pid = req.user.partner_id || (partner_id ? Number(partner_id) : null);
  if (pid) {
    const p = db.prepare('SELECT seats FROM partners WHERE id = ?').get(pid);
    const used = db.prepare('SELECT COUNT(*) n FROM users WHERE partner_id = ? AND active = 1').get(pid).n;
    if (p && used >= p.seats) return res.status(400).json({ error: `이용 인원(${p.seats}명)을 모두 사용 중입니다. 인원을 늘려주세요.` });
  }
  try {
    const out = db.prepare('INSERT INTO users(username, password_hash, name, role, partner_id) VALUES(?, ?, ?, ?, ?)')
      .run(username, auth.hashPassword(password), name, r, pid);
    res.json({ id: Number(out.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? '이미 사용 중인 아이디입니다.' : e.message });
  }
});

router.put('/users/:id', requireAuth, isManager, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target || (req.user.partner_id && target.partner_id !== req.user.partner_id)) return res.status(404).json({ error: '없는 사용자' });
  const { name, role, partner_id, active, password } = req.body || {};
  db.prepare('UPDATE users SET name = ?, role = ?, partner_id = ?, active = ? WHERE id = ?').run(
    name || target.name,
    req.user.role === 'admin' ? (role || target.role) : target.role,
    req.user.role === 'admin' ? (partner_id ? Number(partner_id) : null) : target.partner_id,
    active === false || active === 0 ? 0 : 1, target.id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), target.id);
  if (active === false || active === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  res.json({ ok: true });
});

/* ───────────── 설정 / 연동 테스트 ───────────── */

const SETTING_KEYS = [
  'company.name', 'company.phone', 'app.base_url',
  'meta.verify_token', 'meta.app_secret', 'meta.page_access_token', 'meta.ads_access_token', 'meta.ad_account_id', 'meta.last_sync',
  'telegram.bot_token', 'telegram.chat_ids', 'telegram.notify_kakao',
  'kakao.provider', 'kakao.api_key', 'kakao.api_secret', 'kakao.user_id', 'kakao.pf_id', 'kakao.sender_phone', 'kakao.disable_sms',
  'lead.api_key', 'lead.auto_assign', 'lead.duplicate_days', 'lead.field_map',
];
const SECRET_KEYS = ['meta.app_secret', 'meta.page_access_token', 'meta.ads_access_token', 'telegram.bot_token', 'kakao.api_key', 'kakao.api_secret'];

router.get('/settings', requireAuth, isAdmin, (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) {
    const v = getSetting(k);
    out[k] = SECRET_KEYS.includes(k) && v ? `••••${v.slice(-4)}` : v;
  }
  res.json(out);
});

router.put('/settings', requireAuth, isAdmin, (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!SETTING_KEYS.includes(k)) continue;
    if (SECRET_KEYS.includes(k) && String(v).startsWith('••••')) continue; // 마스킹된 값은 유지
    if (k === 'lead.field_map' && v) {
      try { JSON.parse(v); } catch { return res.status(400).json({ error: '필드 매핑 JSON 형식이 올바르지 않습니다.' }); }
    }
    setSetting(k, v);
  }
  res.json({ ok: true });
});

router.post('/settings/generate-key', requireAuth, isAdmin, (req, res) => {
  const which = (req.body || {}).key === 'meta.verify_token' ? 'meta.verify_token' : 'lead.api_key';
  const v = crypto.randomBytes(18).toString('base64url');
  setSetting(which, v);
  res.json({ value: v });
});

router.post('/settings/test-telegram', requireAuth, isAdmin, wrap(async (req, res) => {
  const chatId = (req.body || {}).chat_id || String(getSetting('telegram.chat_ids')).split(',')[0];
  const r = await telegram.sendMessage(chatId, `✅ 텔레그램 연동 테스트 (${getSetting('company.name', '리드CRM')})`);
  res.json(r);
}));

router.post('/settings/test-kakao', requireAuth, isAdmin, wrap(async (req, res) => {
  const { phone, template_id } = req.body || {};
  const tpl = db.prepare('SELECT * FROM kakao_templates WHERE id = ?').get(template_id) || db.prepare('SELECT * FROM kakao_templates LIMIT 1').get();
  if (!tpl) return res.status(400).json({ error: '템플릿이 없습니다.' });
  const text = leads.renderTemplate(tpl.content, { name: '테스트', phone, status: '신규', created_at: today() });
  const r = await kakao.sendAlimtalk({ to: phone, templateCode: tpl.code, text, subject: tpl.name });
  leads.logNotification({ channel: 'kakao', target: phone, template_code: tpl.code, content: text, ...r });
  res.json({ ...r, text });
}));

// 텔레그램 봇에 최근 메시지를 보낸 채팅 목록 (chat_id 찾기 도우미)
router.get('/settings/telegram-chats', requireAuth, isAdmin, wrap(async (req, res) => {
  const token = getSetting('telegram.bot_token');
  if (!token) return res.status(400).json({ error: '봇 토큰을 먼저 저장하세요.' });
  const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const body = await r.json();
  const chats = {};
  for (const u of body.result || []) {
    const m = u.message || u.channel_post || u.my_chat_member;
    if (m && m.chat) chats[m.chat.id] = m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username;
  }
  res.json(Object.entries(chats).map(([id, name]) => ({ id, name })));
}));

// 웹훅 시뮬레이터: Meta 리드 웹훅과 동일한 경로로 테스트 리드 생성
router.post('/simulate/meta-lead', requireAuth, isAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const { lead } = await leads.createLead({
    ...leads.mapFields(b.field_data || {}),
    source: 'meta',
    meta_lead_id: `test_${Date.now()}`,
    campaign: { external_id: b.campaign_id || null, name: b.campaign_name || '테스트 캠페인' },
    ad_name: b.ad_name || '테스트 광고',
    adset_name: b.adset_name || '테스트 광고세트',
    form_name: b.form_name || '테스트 양식',
  });
  res.json({ id: lead.id });
}));

/* ───────────── 랜딩페이지 ───────────── */

const DEFAULT_LANDING_FIELDS = [
  { key: 'name', label: '성함', type: 'text', required: true },
  { key: 'phone', label: '연락처', type: 'tel', required: true },
  { key: 'gender', label: '성별', type: 'select', options: '남,여' },
  { key: 'age_group', label: '연령대', type: 'select', options: '20대,30대,40대,50대,60대+' },
  { key: 'desired_amount', label: '문의내용', type: 'textarea' },
];

router.get('/landing-pages', requireAuth, (req, res) => {
  const { from, to } = range(req.query);
  const where = req.user.partner_id ? 'WHERE lp.partner_id = ?' : '';
  const rows = db.prepare(`SELECT lp.*, p.name partner_name, c.name campaign_name,
      (SELECT COALESCE(SUM(views),0) FROM landing_hits h WHERE h.landing_id = lp.id AND h.date BETWEEN ? AND ?) views,
      (SELECT COUNT(*) FROM leads l WHERE l.landing_id = lp.id AND date(l.created_at) BETWEEN ? AND ?) leads,
      (SELECT COUNT(*) FROM leads l WHERE l.landing_id = lp.id AND l.status IN (${WON_SQL}) AND date(l.created_at) BETWEEN ? AND ?) won
    FROM landing_pages lp LEFT JOIN partners p ON p.id = lp.partner_id LEFT JOIN campaigns c ON c.id = lp.campaign_id
    ${where} ORDER BY lp.id DESC`).all(from, to, from, to, from, to, ...(req.user.partner_id ? [req.user.partner_id] : []));
  res.json({ range: { from, to }, rows: rows.map((r) => ({ ...r, cvr: r.views ? +(100 * r.leads / r.views).toFixed(1) : null })), defaultFields: DEFAULT_LANDING_FIELDS });
});

function landingBody(b) {
  let fields = b.fields_json;
  if (Array.isArray(fields)) fields = JSON.stringify(fields);
  try { JSON.parse(fields || '[]'); } catch { throw Object.assign(new Error('입력 항목 JSON 형식이 올바르지 않습니다.'), { status: 400 }); }
  return [b.title, b.headline || null, b.description || null, b.image_url || null, b.color || '#2563eb', fields || JSON.stringify(DEFAULT_LANDING_FIELDS),
    b.button_text || '무료 상담 신청', b.done_message || '신청이 완료되었습니다. 곧 연락드리겠습니다.', b.campaign_id ? Number(b.campaign_id) : null];
}

router.post('/landing-pages', requireAuth, isManager, (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: '제목을 입력하세요.' });
  const slug = String(b.slug || crypto.randomBytes(4).toString('hex')).toLowerCase().replace(/[^a-z0-9-]/g, '');
  try {
    const r = db.prepare(`INSERT INTO landing_pages(title, headline, description, image_url, color, fields_json, button_text, done_message, campaign_id, slug, partner_id)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...landingBody(b), slug, req.user.partner_id || (b.partner_id ? Number(b.partner_id) : null));
    res.json({ id: Number(r.lastInsertRowid), slug });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message).includes('UNIQUE') ? '이미 사용 중인 주소입니다.' : e.message });
  }
});

router.put('/landing-pages/:id', requireAuth, isManager, (req, res) => {
  const lp = db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(req.params.id);
  if (!lp || (req.user.partner_id && lp.partner_id !== req.user.partner_id)) return res.status(404).json({ error: '없는 랜딩페이지' });
  const b = req.body || {};
  try {
    db.prepare(`UPDATE landing_pages SET title=?, headline=?, description=?, image_url=?, color=?, fields_json=?, button_text=?, done_message=?, campaign_id=?, active=? WHERE id=?`)
      .run(...landingBody({ ...lp, ...b }), b.active === false || b.active === 0 ? 0 : 1, lp.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete('/landing-pages/:id', requireAuth, isManager, (req, res) => {
  const lp = db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(req.params.id);
  if (!lp || (req.user.partner_id && lp.partner_id !== req.user.partner_id)) return res.status(404).json({ error: '없는 랜딩페이지' });
  db.prepare('DELETE FROM landing_pages WHERE id = ?').run(lp.id);
  res.json({ ok: true });
});

/* ───────────── 가입 승인 (운영자) ───────────── */

router.get('/signups', requireAuth, isAdmin, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.name, u.email, u.phone, u.title, u.created_at, p.id partner_id, p.name partner_name, p.status partner_status
    FROM users u LEFT JOIN partners p ON p.id = u.partner_id WHERE u.active = 0 AND (p.status = 'pending' OR p.status IS NULL) ORDER BY u.id DESC`).all());
});

router.post('/signups/:id/approve', requireAuth, isAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '없는 신청' });
  const { plan, seats } = req.body || {};
  db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(u.id);
  if (u.partner_id) db.prepare("UPDATE partners SET status = 'approved', active = 1, plan = COALESCE(?, plan), seats = COALESCE(?, seats) WHERE id = ?").run(plan || null, seats ? Number(seats) : null, u.partner_id);
  res.json({ ok: true });
});

router.post('/signups/:id/reject', requireAuth, isAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '없는 신청' });
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  if (u.partner_id) {
    const others = db.prepare('SELECT COUNT(*) n FROM users WHERE partner_id = ?').get(u.partner_id).n;
    if (!others) db.prepare("DELETE FROM partners WHERE id = ? AND status = 'pending'").run(u.partner_id);
  }
  res.json({ ok: true });
});

module.exports = router;
