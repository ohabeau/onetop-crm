const express = require('express');
const { db, tx } = require('../db');
const auth = require('../auth');
const leads = require('../services/leads');

const router = express.Router();

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function kstDate() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

/* 가입 신청: 업체 + 대표 계정 생성 → 운영자 승인 후 로그인 가능 */
router.post('/api/public/signup', (req, res) => {
  const b = req.body || {};
  const need = ['name', 'company', 'phone', 'email', 'username', 'password'];
  for (const k of need) if (!b[k]) return res.status(400).json({ error: '모든 항목을 입력해 주세요.' });
  if (String(b.password).length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  if (!b.agree) return res.status(400).json({ error: '이용약관과 개인정보처리방침에 동의해 주세요.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)) return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
  tx(() => {
    const p = db.prepare("INSERT INTO partners(name, status, active) VALUES(?, 'pending', 0)").run(b.company);
    db.prepare(`INSERT INTO users(username, password_hash, name, email, phone, title, role, partner_id, active)
      VALUES(?, ?, ?, ?, ?, ?, 'manager', ?, 0)`).run(b.username, auth.hashPassword(String(b.password)), b.name, b.email,
      leads.formatPhone(b.phone), b.title || '대표', Number(p.lastInsertRowid));
  });
  res.json({ ok: true });
});

/* 랜딩페이지 (공개) */
function renderField(f) {
  const req = f.required ? 'required' : '';
  const name = esc(f.key);
  if (f.type === 'select') {
    const opts = String(f.options || '').split(',').map((o) => o.trim()).filter(Boolean);
    return `<label>${esc(f.label)}${f.required ? ' *' : ''}<select name="${name}" ${req}><option value="">선택해 주세요</option>${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`;
  }
  if (f.type === 'radio') {
    const opts = String(f.options || '').split(',').map((o) => o.trim()).filter(Boolean);
    return `<fieldset><legend>${esc(f.label)}${f.required ? ' *' : ''}</legend><div class="radios">${opts.map((o, i) => `<label class="radio"><input type="radio" name="${name}" value="${esc(o)}" ${req && i === 0 ? 'required' : ''}> ${esc(o)}</label>`).join('')}</div></fieldset>`;
  }
  if (f.type === 'textarea') return `<label>${esc(f.label)}${f.required ? ' *' : ''}<textarea name="${name}" rows="3" ${req}></textarea></label>`;
  const type = f.type === 'tel' ? 'tel' : 'text';
  return `<label>${esc(f.label)}${f.required ? ' *' : ''}<input type="${type}" name="${name}" ${type === 'tel' ? 'inputmode="numeric" placeholder="010-0000-0000"' : ''} ${req}></label>`;
}

router.get('/l/:slug', (req, res) => {
  const lp = db.prepare('SELECT * FROM landing_pages WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!lp) return res.status(404).send('페이지를 찾을 수 없습니다.');
  db.prepare(`INSERT INTO landing_hits(landing_id, date, views) VALUES(?, ?, 1)
    ON CONFLICT(landing_id, date) DO UPDATE SET views = views + 1`).run(lp.id, kstDate());
  let fields = [];
  try { fields = JSON.parse(lp.fields_json); } catch { fields = []; }
  res.send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(lp.title)}</title>
<style>
:root{--c:${esc(lp.color)}}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#f4f5f7;color:#111}
.wrap{max-width:520px;margin:0 auto;background:#fff;min-height:100vh}
.hero{background:var(--c);color:#fff;padding:40px 24px 32px}.hero h1{margin:0 0 10px;font-size:26px;line-height:1.35;white-space:pre-line}.hero p{margin:0;opacity:.9;line-height:1.6;white-space:pre-line}
img.cover{width:100%;display:block}
form{padding:24px;display:grid;gap:14px}label,fieldset{display:grid;gap:6px;font-size:14px;font-weight:600;border:0;padding:0;margin:0}
legend{font-weight:600;font-size:14px;margin-bottom:6px}.radios{display:flex;gap:16px;flex-wrap:wrap}.radio{display:flex;align-items:center;gap:6px;font-weight:400}
input,select,textarea{font:inherit;font-weight:400;padding:12px;border:1px solid #d6d9de;border-radius:10px;width:100%}
.agree{display:flex;gap:8px;align-items:flex-start;font-weight:400;font-size:13px;color:#555}.agree input{width:auto;margin-top:2px}
button{background:var(--c);color:#fff;border:0;border-radius:12px;padding:16px;font-size:17px;font-weight:700;cursor:pointer}
.done{padding:60px 24px;text-align:center;font-size:17px;line-height:1.6;display:none}
</style></head><body><div class="wrap">
${lp.image_url ? `<img class="cover" src="${esc(lp.image_url)}" alt="">` : ''}
<div class="hero"><h1>${esc(lp.headline || lp.title)}</h1>${lp.description ? `<p>${esc(lp.description)}</p>` : ''}</div>
<form id="f">${fields.map(renderField).join('')}
<label class="agree"><input type="checkbox" name="agree" required> 상담을 위한 개인정보 수집·이용에 동의합니다. (수집 항목: 입력하신 정보, 보유 기간: 상담 종료 후 1년)</label>
<button type="submit">${esc(lp.button_text)}</button></form>
<div class="done" id="done">✅<br>${esc(lp.done_message)}</div>
</div>
<script>
const q=new URLSearchParams(location.search);
document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const btn=e.target.querySelector('button');btn.disabled=true;
const data=Object.fromEntries(new FormData(e.target));['utm_source','utm_campaign','utm_content','utm_term'].forEach(k=>{if(q.get(k))data[k]=q.get(k)});
const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
if(r.ok){e.target.style.display='none';document.getElementById('done').style.display='block';}else{btn.disabled=false;alert((await r.json()).error||'오류가 발생했습니다.');}
});
</script></body></html>`);
});

const UTM_PLATFORM = { facebook: 'meta', instagram: 'meta', meta: 'meta', fb: 'meta', ig: 'meta', google: 'google', youtube: 'google', naver: 'naver', kakao: 'kakao' };

router.post('/l/:slug', async (req, res) => {
  const lp = db.prepare('SELECT * FROM landing_pages WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!lp) return res.status(404).json({ error: '없는 페이지' });
  const b = { ...(req.body || {}) };
  if (!b.phone && !b.name) return res.status(400).json({ error: '연락처를 입력해 주세요.' });
  const utm = { source: b.utm_source, campaign: b.utm_campaign, content: b.utm_content, term: b.utm_term };
  ['agree', 'utm_source', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => delete b[k]);
  const mapped = leads.mapFields(b);
  const platform = UTM_PLATFORM[String(utm.source || '').toLowerCase()] || 'landing';
  try {
    const { lead } = await leads.createLead({
      ...mapped,
      source: platform,
      landing_id: lp.id,
      partner_id: lp.partner_id,
      campaign_id: !utm.campaign ? lp.campaign_id : null,
      campaign: utm.campaign ? { name: utm.campaign } : undefined,
      ad_name: utm.content, adset_name: utm.term, form_name: lp.title,
    });
    if (utm.campaign && lp.partner_id) db.prepare('UPDATE campaigns SET partner_id = COALESCE(partner_id, ?) WHERE id = ?').run(lp.partner_id, lead.campaign_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '접수 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
