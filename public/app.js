/* 원탑(One TOP) CRM 프론트엔드 (의존성 없는 SPA, 해시 라우팅) */
'use strict';

const S = {
  me: null, statuses: [], companyName: '원탑 CRM',
  partners: [], users: [], campaigns: [], templates: [],
  range: null, charts: [], leadView: 'list',
};
const PLATFORM = { meta: '메타', google: '구글', naver: '네이버', kakao: '카카오', landing: '랜딩', sheet: '구글시트', manual: '직접등록', import: '엑셀' };
const LOGO = '<img class="logo logo-l" src="/logo.png" alt="원탑 CRM"><img class="logo logo-d" src="/logo-dark.png" alt="원탑 CRM">';
const ROLE = { admin: '운영자', manager: '관리자', agent: '상담원' };

/* ───────── 유틸 ───────── */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || Number.isNaN(n) ? '-' : Number(n).toLocaleString('ko-KR'));
const won = (n) => (n == null ? '-' : `₩${fmt(n)}`);
const pct = (n) => (n == null ? '-' : `${n}%`);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const isMgr = () => S.me && ['admin', 'manager'].includes(S.me.role);
const isAdmin = () => S.me && S.me.role === 'admin';
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstDaysAgo = (n) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
const badge = (st) => `<span class="badge st-${esc(st)}">${esc(st)}</span>`;
const pf = (p) => `<span class="pf pf-${esc(p)}">${esc(PLATFORM[p] || p || '-')}</span>`;
const mins = (m) => (m == null ? '-' : m < 60 ? `${m}분` : m < 1440 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 1440)}일`);
const ago = (t) => {
  if (!t) return '';
  const d = (Date.now() + 9 * 3600e3 - new Date(t.replace(' ', 'T') + 'Z').getTime()) / 60000;
  if (d < 1) return '방금';
  if (d < 60) return `${Math.floor(d)}분 전`;
  if (d < 1440) return `${Math.floor(d / 60)}시간 전`;
  return t.slice(5, 16);
};
const maskPhone = (p) => p || '';

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(`/api${path}`, o);
  if (r.status === 401 && !path.startsWith('/auth')) { S.me = null; location.hash = '#/login'; throw new Error('로그인이 필요합니다.'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `오류 (${r.status})`);
  return data;
}

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = `t${err ? ' err' : ''}`;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function guard(fn) {
  return async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
}

function modal(html, { center = true, onMount } = {}) {
  const ov = document.createElement('div');
  ov.className = `overlay${center ? ' center' : ''}`;
  ov.innerHTML = center ? `<div class="modal">${html}</div>` : `<div class="drawer">${html}</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  $('#modal-root').appendChild(ov);
  $$('[data-close]', ov).forEach((b) => b.addEventListener('click', close));
  if (onMount) onMount(ov.firstElementChild, close);
  return close;
}

function formData(el) {
  const o = {};
  $$('[name]', el).forEach((i) => {
    if (i.type === 'checkbox') o[i.name] = i.checked;
    else o[i.name] = i.value;
  });
  return o;
}

function destroyCharts() {
  S.charts.forEach((c) => c.destroy());
  S.charts = [];
}

function chart(canvas, cfg) {
  if (!window.Chart) { canvas.parentElement.innerHTML = '<div class="empty">차트 라이브러리를 불러오지 못했습니다.</div>'; return; }
  const text2 = css('--text-2');
  const grid = css('--grid');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = text2;
  const c = new Chart(canvas, {
    ...cfg,
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: cfg.data.datasets.length > 1, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
        tooltip: { padding: 10, callbacks: cfg.tooltip || {} },
      },
      scales: cfg.type === 'doughnut' ? {} : {
        x: { grid: { display: false }, border: { color: grid }, ticks: { maxRotation: 0, autoSkipPadding: 12 }, ...(cfg.x || {}) },
        y: { grid: { color: grid }, border: { display: false }, beginAtZero: true, ticks: { precision: 0, callback: cfg.yfmt || ((v) => fmt(v)) } },
      },
      ...(cfg.options || {}),
    },
  });
  S.charts.push(c);
  return c;
}

/* ───────── 기간 선택 ───────── */
function defaultRange() { return { from: kstDaysAgo(29), to: kstToday(), preset: '30' }; }
function rangeBar(onChange) {
  const r = S.range;
  const presets = [['0', '오늘'], ['7', '7일'], ['30', '30일'], ['month', '이번 달'], ['last', '지난 달']];
  const html = `<div class="row">
    <div class="seg">${presets.map(([k, l]) => `<button data-p="${k}" class="${r.preset === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <input type="date" name="from" value="${r.from}" style="width:auto"> ~ <input type="date" name="to" value="${r.to}" style="width:auto">
  </div>`;
  const mount = (el) => {
    $$('[data-p]', el).forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.p;
      const t = kstToday();
      if (p === 'month') S.range = { from: t.slice(0, 8) + '01', to: t, preset: p };
      else if (p === 'last') {
        const d = new Date(t.slice(0, 8) + '01T00:00:00Z'); d.setUTCDate(0);
        const end = d.toISOString().slice(0, 10);
        S.range = { from: end.slice(0, 8) + '01', to: end, preset: p };
      } else S.range = { from: p === '0' ? t : kstDaysAgo(Number(p) - 1), to: t, preset: p };
      onChange();
    }));
    $$('input[type=date]', el).forEach((i) => i.addEventListener('change', () => {
      S.range = { ...S.range, [i.name]: i.value, preset: '' };
      onChange();
    }));
  };
  return { html, mount };
}

/* ───────── 공통 데이터 ───────── */
async function loadRefs() {
  const [partners, users, campaigns, templates] = await Promise.all([
    api('/partners'), api('/users'), api('/campaigns'), api('/kakao-templates'),
  ]);
  Object.assign(S, { partners, users, campaigns, templates });
}
const userOpts = (sel, partnerId) => S.users.filter((u) => u.active && (!partnerId || u.partner_id === partnerId || !u.partner_id))
  .map((u) => `<option value="${u.id}" ${String(sel) === String(u.id) ? 'selected' : ''}>${esc(u.name)}${u.partner_name ? ` (${esc(u.partner_name)})` : ''}</option>`).join('');
const partnerOpts = (sel) => S.partners.map((p) => `<option value="${p.id}" ${String(sel) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
const campaignOpts = (sel) => S.campaigns.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const statusOpts = (sel) => S.statuses.map((s) => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('');

/* ───────── 레이아웃 ───────── */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  leads: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.6 3 5.2"/>',
  ads: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  landing: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h8M8 16h5"/>',
  staff: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  kakao: '<path d="M12 4C7 4 3 7.2 3 11.2c0 2.5 1.6 4.7 4 6l-1 3.8 4.2-2.8c.6.1 1.2.1 1.8.1 5 0 9-3.2 9-7.1S17 4 12 4z"/>',
  logs: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;
const NAV = [
  ['dashboard', '대시보드', icon('dashboard'), () => true],
  ['leads', '고객 DB', icon('leads'), () => true],
  ['ads', '광고 효율', icon('ads'), isMgr],
  ['landing', '랜딩페이지', icon('landing'), isMgr],
  ['staff', '직원·응답속도', icon('staff'), isMgr],
  ['kakao', '알림톡', icon('kakao'), isMgr],
  ['logs', '발송 기록', icon('logs'), isMgr],
  ['settings', '설정', icon('settings'), () => true],
];

function shell(active) {
  const items = NAV.filter((n) => n[3]());
  const mobile = items.filter((n) => ['dashboard', 'leads', 'ads', 'kakao', 'settings'].includes(n[0]));
  return `<div class="shell">
    <aside class="side">
      <a class="brand" href="#/dashboard">${LOGO}</a>
      <nav class="nav">${items.map(([k, l, i]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}"><span class="ico">${i}</span>${l}</a>`).join('')}</nav>
      <div class="me">
        <div><b>${esc(S.me.name)}</b> <span class="muted small">${ROLE[S.me.role]}</span></div>
        <div class="muted small">${esc(S.me.partner_name || '전체 업체')}</div>
        <div class="row" style="margin-top:8px"><button class="btn sm" id="theme-btn">화면 모드</button><button class="btn sm" id="logout">로그아웃</button></div>
      </div>
    </aside>
    <div>
      <div class="mobile-top"><a class="brand" href="#/dashboard" style="padding:0">${LOGO}</a><span class="spacer"></span><button class="btn sm" id="logout-m">로그아웃</button></div>
      <main class="main" id="view"></main>
    </div>
    <nav class="tabbar">${mobile.map(([k, l, i]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}"><span class="ico">${i}</span>${l}</a>`).join('')}</nav>
  </div>`;
}

function mountShell(active) {
  $('#app').innerHTML = shell(active);
  const logout = guard(async () => { await api('/auth/logout', { method: 'POST' }); S.me = null; location.hash = '#/login'; });
  $('#logout').addEventListener('click', logout);
  $('#logout-m').addEventListener('click', logout);
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('theme', next); } catch { /* 저장 불가 */ }
    route();
  });
}

/* ───────── 로그인 / 가입 ───────── */
function authFrame(inner) {
  return `<div class="auth"><div class="auth-box">
    <div class="auth-hero">
      <div class="brand" style="padding:0"><img class="logo" src="/logo-dark.png" alt="One TOP CRM" style="height:34px"></div>
      <div><h1 style="font-size:24px;margin-bottom:14px">광고 DB가 들어오는 순간부터<br>매출까지, 한 곳에서.</h1>
      <ul><li>메타·구글·네이버·카카오·랜딩 DB 실시간 수집</li><li>신규 DB 텔레그램 알림 + 고객 알림톡 자동 발송</li>
      <li>부재·예약·구매 단계별 알림톡 자동화</li><li>광고비 · DB 단가 · 매출 · ROAS 대시보드</li><li>직원 계정과 응답 속도 관리</li></ul></div>
      <div class="small" style="opacity:.75">홈 화면에 추가하면 앱처럼 쓸 수 있습니다.</div>
    </div>
    <div class="auth-form">${inner}</div>
  </div></div>`;
}

function pageLogin() {
  $('#app').innerHTML = authFrame(`
    <h1>로그인</h1>
    <form id="lf" class="grid" style="gap:12px">
      <label class="f">아이디<input type="text" name="username" autocomplete="username" required></label>
      <label class="f">비밀번호<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn primary" style="padding:11px">로그인</button>
    </form>
    <div class="small muted">계정이 없으신가요? <a href="#/signup">가입 신청</a></div>`);
  $('#lf').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    await api('/auth/login', { method: 'POST', body: formData(e.target) });
    await boot();
    location.hash = '#/dashboard';
  }));
}

function pageSignup() {
  $('#app').innerHTML = authFrame(`
    <h1>가입 신청</h1>
    <form id="sf" class="form-grid">
      <label class="f">성함<input type="text" name="name" required></label>
      <label class="f">직책<select name="title"><option>대표</option><option>직원</option></select></label>
      <label class="f full">회사명<input type="text" name="company" required></label>
      <label class="f">전화번호<input type="tel" name="phone" required></label>
      <label class="f">이메일<input type="email" name="email" required></label>
      <label class="f">아이디<input type="text" name="username" required></label>
      <label class="f">비밀번호<input type="password" name="password" minlength="6" required></label>
      <label class="check full"><input type="checkbox" name="agree" required> [필수] 이용약관과 개인정보처리방침에 동의합니다.</label>
      <button class="btn primary full" style="padding:11px">가입 신청</button>
    </form>
    <div class="small muted">이미 계정이 있으신가요? <a href="#/login">로그인</a></div>`);
  $('#sf').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const r = await fetch('/api/public/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData(e.target)) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $('.auth-form').innerHTML = '<h1>신청이 접수되었습니다</h1><p>운영자가 확인 후 승인하면 로그인할 수 있습니다.</p><a class="btn" href="#/login">로그인 화면으로</a>';
  }));
}

/* ───────── 대시보드 ───────── */
async function pageDashboard(view) {
  const rb = rangeBar(() => pageDashboard(view));
  const pFilter = !S.me.partner_id && S.partners.length
    ? `<select id="pf" style="width:auto"><option value="">전체 업체</option>${partnerOpts(S.dashPartner)}</select>` : '';
  view.innerHTML = `<div class="page-head"><h1>대시보드</h1>${pFilter}${rb.html}</div><div id="dash"><div class="empty">불러오는 중…</div></div>`;
  rb.mount(view);
  if ($('#pf', view)) $('#pf', view).addEventListener('change', (e) => { S.dashPartner = e.target.value; pageDashboard(view); });
  const d = await api(`/dashboard?${qs({ from: S.range.from, to: S.range.to, partner_id: S.dashPartner })}`);
  const k = d.kpi;
  const money = isMgr();
  const statusCount = Object.fromEntries(d.byStatus.map((s) => [s.status, s.n]));
  const maxPl = Math.max(1, ...d.byPlatform.map((p) => p.leads));
  const maxSpend = Math.max(1, ...d.byPlatform.map((p) => p.spend || 0));
  const demoList = (rows, color) => rows.length ? rows.map((r) => `<div class="bar-row"><span>${esc(r.label)}</span><div class="track"><div class="fill" style="width:${r.pct}%;--bc:var(${color})"></div></div><span class="r num">${r.pct}% · ${r.n}</span></div>`).join('') : '<div class="empty">데이터 없음</div>';
  $('#dash', view).innerHTML = `
  <div class="grid g4">
    <div class="card kpi hero"><div class="label">오늘 들어온 DB</div><div class="value">${fmt(k.today)}건</div><div class="sub">기간 합계 ${fmt(k.total)}건 · 유효 ${fmt(k.valid)}건</div></div>
    ${money ? `<div class="card kpi"><div class="label">광고비</div><div class="value">${won(k.spend)}</div><div class="sub">CTR ${pct(k.ctr)} · 클릭 ${fmt(k.clicks)}</div></div>
    <div class="card kpi"><div class="label">DB 단가 (유효 DB 기준)</div><div class="value">${won(k.cpl)}</div><div class="sub">구매 1건당 ${won(k.cpa)}</div></div>
    <div class="card kpi"><div class="label">매출 · 광고비 대비</div><div class="value">${won(k.revenue)}</div><div class="sub">ROAS <b style="color:var(--good)">${pct(k.roas)}</b> · 구매 ${fmt(k.won)}건 (${pct(k.convRate)})</div></div>`
    : `<div class="card kpi"><div class="label">구매</div><div class="value">${fmt(k.won)}건</div><div class="sub">전환율 ${pct(k.convRate)}</div></div>
       <div class="card kpi"><div class="label">부재 (1차 · 2차)</div><div class="value">${fmt(statusCount['부재1차'] || 0)} · ${fmt(statusCount['부재2차'] || 0)}</div><div class="sub">다시 연락할 고객</div></div>
       <div class="card kpi"><div class="label">오늘까지 콜백</div><div class="value">${fmt(d.callbacks.length)}건</div><div class="sub">예약·재통화 일정</div></div>`}
  </div>
  <div class="grid g4" style="margin-top:14px">
    <div class="card kpi"><div class="label">미처리 (신규 상태)</div><div class="value" style="color:${k.untouched ? 'var(--accent)' : 'inherit'}">${fmt(k.untouched)}건</div><div class="sub"><a href="#/leads?status=신규">바로 처리하기 →</a></div></div>
    <div class="card kpi"><div class="label">평균 첫 응대 시간</div><div class="value">${mins(k.respMinutes)}</div><div class="sub">DB 접수 → 첫 상태변경·메모·발송</div></div>
    <div class="card kpi"><div class="label">허수 · 중복</div><div class="value">${fmt(k.junk)} · ${fmt(k.dups)}</div><div class="sub">유효 DB 에서 제외</div></div>
    <div class="card kpi"><div class="label">예약 · 상담중</div><div class="value">${fmt(statusCount['예약완료'] || 0)} · ${fmt(statusCount['상담중'] || 0)}</div><div class="sub">진행 중인 고객</div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-head"><h2>일별 DB 접수</h2><span class="muted small">구매 전환 포함</span></div><div class="chart-box"><canvas id="c-daily"></canvas></div></div>
    ${money ? '<div class="card"><div class="card-head"><h2>일별 광고비 · 매출</h2><span class="muted small">원</span></div><div class="chart-box"><canvas id="c-money"></canvas></div></div>'
      : '<div class="card"><div class="card-head"><h2>시간대별 DB</h2></div><div class="chart-box"><canvas id="c-hours"></canvas></div></div>'}
  </div>
  <div class="grid g3" style="margin-top:14px">
    <div class="card"><div class="card-head"><h2>매체별 DB · 단가</h2></div>
      ${d.byPlatform.length ? d.byPlatform.map((p) => `<div style="padding:6px 0">
        <div class="row"><span class="pf pf-${p.platform}"><b>${esc(p.label)}</b></span><span class="spacer"></span><span class="num">${fmt(p.leads)}건</span>${money ? `<span class="muted small num" style="width:92px;text-align:right">단가 ${won(p.cpl)}</span>` : ''}</div>
        <div class="bar-row" style="grid-template-columns:1fr;padding:4px 0 0"><div class="track"><div class="fill pf-${p.platform}" style="width:${100 * p.leads / maxPl}%;--bc:var(--pf)"></div></div></div>
        ${money && p.spend ? `<div class="muted small">광고비 ${won(p.spend)} (${Math.round(100 * p.spend / maxSpend)}%)</div>` : ''}</div>`).join('') : '<div class="empty">데이터 없음</div>'}
    </div>
    <div class="card"><div class="card-head"><h2>단계별 현황</h2></div><div class="chart-box"><canvas id="c-status"></canvas></div></div>
    <div class="card"><div class="card-head"><h2>인구통계</h2><span class="muted small">연령 · 성별</span></div>
      <h3 style="margin-bottom:4px">■ 구매한 사람</h3>${demoList(d.demographics.buyers, '--s1')}
      <h3 style="margin:12px 0 4px">■ 허수 유형</h3>${demoList(d.demographics.junk, '--s2')}
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-head"><h2>최근 들어온 DB</h2><a href="#/leads" class="small">전체 보기</a></div>
      <div class="list">${d.recent.map((l) => `<a class="item" href="#/leads/${l.id}" style="color:inherit">
        ${pf(l.source)}<b>${esc(l.name || '(이름 없음)')}</b><span class="muted small hide-sm">${esc(l.business_type || '')}</span>
        <span class="spacer"></span>${l.is_duplicate ? '<span class="badge bad">중복</span>' : ''}${badge(l.status)}<span class="muted small" style="width:70px;text-align:right">${ago(l.created_at)}</span></a>`).join('') || '<div class="empty">아직 DB가 없습니다.</div>'}</div>
    </div>
    <div class="card"><div class="card-head"><h2>오늘까지 연락할 고객</h2><span class="muted small">콜백 예약</span></div>
      <div class="list">${d.callbacks.map((l) => `<a class="item" href="#/leads/${l.id}" style="color:inherit"><b>${esc(l.name)}</b><span class="muted hide-sm">${esc(l.phone)}</span><span class="spacer"></span>${badge(l.status)}<span class="small num">${esc(l.callback_at.replace('T', ' ').slice(5, 16))}</span></a>`).join('') || '<div class="empty">예정된 콜백이 없습니다.</div>'}</div>
    </div>
  </div>
  ${money ? `<div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-head"><h2>시간대별 DB</h2></div><div class="chart-box"><canvas id="c-hours"></canvas></div></div>
    <div class="card"><div class="card-head"><h2>업종별 DB</h2></div>${(() => { const m = Math.max(1, ...d.byType.map((t) => t.n)); return d.byType.map((t) => `<div class="bar-row"><span class="trunc">${esc(t.name)}</span><div class="track"><div class="fill" style="width:${100 * t.n / m}%"></div></div><span class="r num">${fmt(t.n)}건</span></div>`).join('') || '<div class="empty">데이터 없음</div>'; })()}</div>
  </div>` : ''}`;

  const labels = d.daily.map((x) => x.date.slice(5).replace('-', '/'));
  chart($('#c-daily'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'DB', data: d.daily.map((x) => x.leads), backgroundColor: css('--s1'), borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 18 },
      { label: '구매', data: d.daily.map((x) => x.won), backgroundColor: css('--s3'), borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 18 },
    ] },
  });
  if ($('#c-money')) {
    chart($('#c-money'), {
      type: 'line',
      data: { labels, datasets: [
        { label: '광고비', data: d.daily.map((x) => x.spend), borderColor: css('--s2'), backgroundColor: css('--s2'), borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: '매출', data: d.daily.map((x) => x.revenue), borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, pointRadius: 0, tension: 0.3 },
      ] },
      yfmt: (v) => (v >= 10000 ? `${fmt(v / 10000)}만` : fmt(v)),
      tooltip: { label: (c) => ` ${c.dataset.label}: ${won(c.parsed.y)}` },
    });
  }
  chart($('#c-hours'), {
    type: 'bar',
    data: { labels: d.hours.map((_, h) => `${h}시`), datasets: [{ label: 'DB', data: d.hours, backgroundColor: css('--s1'), borderRadius: { topLeft: 4, topRight: 4 } }] },
  });
  const order = S.statuses.filter((s) => statusCount[s]);
  chart($('#c-status'), {
    type: 'bar',
    data: { labels: order, datasets: [{ label: '건수', data: order.map((s) => statusCount[s]), backgroundColor: css('--s1'), borderRadius: { topRight: 4, bottomRight: 4 }, maxBarThickness: 16 }] },
    options: { indexAxis: 'y', scales: { x: { grid: { color: css('--grid') }, border: { display: false }, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
  });
}

/* ───────── 고객 DB (목록 / 보드) ───────── */
function leadQuery() {
  const h = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(h));
}

async function pageLeads(view) {
  const q = { page: 1, ...leadQuery() };
  S.leadFilter = { ...(S.leadFilter || {}), ...q };
  const f = S.leadFilter;
  const isBoard = S.leadView === 'board';
  view.innerHTML = `<div class="page-head"><h1>고객 DB</h1>
      <div class="seg"><button data-v="list" class="${!isBoard ? 'on' : ''}">목록</button><button data-v="board" class="${isBoard ? 'on' : ''}">보드</button></div>
      <button class="btn" id="add-lead">+ DB 등록</button>
      ${isMgr() ? '<button class="btn" id="import">엑셀(CSV) 업로드</button><button class="btn" id="export">내려받기</button>' : ''}
    </div>
    <div class="tabs" id="st-tabs"></div>
    <div class="filters">
      <input type="search" name="q" placeholder="이름·연락처·상호 검색" value="${esc(f.q || '')}" style="width:200px">
      <select name="source"><option value="">전체 매체</option>${Object.entries(PLATFORM).map(([k, v]) => `<option value="${k}" ${f.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select name="campaign_id"><option value="">전체 캠페인</option>${campaignOpts(f.campaign_id)}</select>
      ${!S.me.partner_id ? `<select name="partner_id"><option value="">전체 업체</option>${partnerOpts(f.partner_id)}</select>` : ''}
      ${S.me.role !== 'agent' ? `<select name="assignee_id"><option value="">전체 담당자</option><option value="none" ${f.assignee_id === 'none' ? 'selected' : ''}>미배정</option>${userOpts(f.assignee_id)}</select>` : ''}
      <input type="date" name="from" value="${esc(f.from || '')}" style="width:auto"> ~ <input type="date" name="to" value="${esc(f.to || '')}" style="width:auto">
      <label class="check"><input type="checkbox" name="hide_dup" ${f.hide_dup === '1' ? 'checked' : ''}> 허수·중복 숨기기</label>
      <button class="btn ghost sm" id="reset">초기화</button>
    </div>
    <div id="lead-body"><div class="empty">불러오는 중…</div></div>`;

  $$('[data-v]', view).forEach((b) => b.addEventListener('click', () => { S.leadView = b.dataset.v; pageLeads(view); }));
  $$('.filters [name]', view).forEach((i) => i.addEventListener(i.type === 'search' ? 'input' : 'change', debounce(() => {
    f[i.name] = i.type === 'checkbox' ? (i.checked ? '1' : '') : i.value;
    f.page = 1;
    loadLeadBody(view);
  }, i.type === 'search' ? 300 : 0)));
  $('#reset', view).addEventListener('click', () => { S.leadFilter = {}; history.replaceState(null, '', '#/leads'); pageLeads(view); });
  $('#add-lead', view).addEventListener('click', () => leadForm());
  if ($('#import', view)) $('#import', view).addEventListener('click', importDialog);
  if ($('#export', view)) $('#export', view).addEventListener('click', () => { const { page, size, ...rest } = f; location.href = `/api/leads/export.csv?${qs(rest)}`; });
  await loadLeadBody(view);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); if (!ms) return fn(...a); t = setTimeout(() => fn(...a), ms); };
}

async function loadLeadBody(view) {
  const f = S.leadFilter;
  const isBoard = S.leadView === 'board';
  const params = { ...f, size: isBoard ? 200 : 50 };
  if (isBoard) delete params.status;
  const d = await api(`/leads?${qs(params)}`);
  const counts = Object.fromEntries(d.counts.map((c) => [c.status, c.n]));
  const all = d.counts.reduce((s, c) => s + c.n, 0);
  $('#st-tabs', view).innerHTML = isBoard ? '' : [['', '전체', all], ...S.statuses.map((s) => [s, s, counts[s] || 0])]
    .map(([v, l, n]) => `<button data-st="${v}" class="${(f.status || '') === v ? 'on' : ''}">${l}<span class="cnt">${fmt(n)}</span></button>`).join('');
  $$('[data-st]', view).forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.st; f.page = 1; loadLeadBody(view); }));
  const body = $('#lead-body', view);
  if (isBoard) return renderBoard(body, d.rows, view);

  const pages = Math.max(1, Math.ceil(d.total / d.size));
  body.innerHTML = `<div class="card" style="padding:0 16px">
    ${isMgr() ? `<div class="row" style="padding:10px 0" id="bulk"><label class="check"><input type="checkbox" id="chk-all"> 전체 선택</label>
      <span class="muted small" id="sel-n">0건 선택</span>
      <select id="bulk-status" style="width:auto"><option value="">상태 일괄 변경</option>${statusOpts()}</select>
      <select id="bulk-assignee" style="width:auto"><option value="">담당자 일괄 배정</option><option value="0">배정 해제</option>${userOpts()}</select>
      <button class="btn sm" id="bulk-go">적용</button><span class="spacer"></span><span class="muted small">총 ${fmt(d.total)}건</span></div>` : `<div class="muted small" style="padding:10px 0">총 ${fmt(d.total)}건</div>`}
    <div class="table-wrap"><table>
      <thead><tr>${isMgr() ? '<th></th>' : ''}<th>접수일시</th><th>매체</th><th>이름</th><th>연락처</th><th>업종</th><th>성별/연령</th><th>캠페인 · 광고</th><th>상태</th><th>담당</th><th class="r">구매금액</th></tr></thead>
      <tbody>${d.rows.map((l) => `<tr class="click" data-id="${l.id}">
        ${isMgr() ? `<td><input type="checkbox" class="chk" value="${l.id}"></td>` : ''}
        <td class="num small">${esc(l.created_at.slice(2, 16))}</td><td>${pf(l.source)}</td>
        <td><b>${esc(l.name || '-')}</b>${l.is_duplicate ? ' <span class="badge bad">중복</span>' : ''}</td><td class="num">${esc(maskPhone(l.phone))}</td>
        <td>${esc(l.business_type || '')}</td><td class="small">${esc([l.gender, l.age_group].filter(Boolean).join(' · '))}</td>
        <td class="trunc small" title="${esc([l.campaign_name, l.adset_name, l.ad_name].filter(Boolean).join(' › '))}">${esc(l.campaign_name || '-')}<div class="muted">${esc(l.ad_name || '')}</div></td>
        <td>${badge(l.status)}</td><td>${esc(l.assignee_name || '-')}</td><td class="r num">${l.sale_amount ? fmt(l.sale_amount) : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    ${d.rows.length ? '' : '<div class="empty">조건에 맞는 DB가 없습니다.</div>'}
    <div class="pager" style="padding-bottom:12px"><button class="btn sm" data-pg="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>이전</button><span class="small">${d.page} / ${pages}</span><button class="btn sm" data-pg="${d.page + 1}" ${d.page >= pages ? 'disabled' : ''}>다음</button></div>
  </div>`;
  $$('tr.click', body).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('input')) return; openLead(Number(tr.dataset.id)); }));
  $$('[data-pg]', body).forEach((b) => b.addEventListener('click', () => { f.page = Number(b.dataset.pg); loadLeadBody(view); }));
  if (isMgr()) {
    const upd = () => { $('#sel-n', body).textContent = `${$$('.chk:checked', body).length}건 선택`; };
    $$('.chk', body).forEach((c) => c.addEventListener('change', upd));
    $('#chk-all', body).addEventListener('change', (e) => { $$('.chk', body).forEach((c) => { c.checked = e.target.checked; }); upd(); });
    $('#bulk-go', body).addEventListener('click', guard(async () => {
      const ids = $$('.chk:checked', body).map((c) => Number(c.value));
      const status = $('#bulk-status', body).value;
      const a = $('#bulk-assignee', body).value;
      if (!ids.length || (!status && !a)) return toast('대상과 변경 내용을 선택하세요.', true);
      const payload = { ids };
      if (status) payload.status = status;
      if (a) payload.assignee_id = a === '0' ? null : Number(a);
      const r = await api('/leads/bulk', { method: 'POST', body: payload });
      toast(`${r.count}건 변경했습니다.`);
      loadLeadBody(view);
    }));
  }
}

function renderBoard(body, rows, view) {
  const cols = S.statuses.filter((s) => !S.leadFilter.status || s === S.leadFilter.status);
  body.innerHTML = `<div class="board">${cols.map((st) => {
    const items = rows.filter((r) => r.status === st);
    return `<div class="col" data-st="${esc(st)}"><div class="col-head">${badge(st)}<span class="muted small">${items.length}</span></div>
      ${items.map((l) => `<div class="lead-card" draggable="true" data-id="${l.id}">
        <div class="t">${esc(l.name || '-')}${l.is_duplicate ? '<span class="badge bad">중복</span>' : ''}<span class="spacer"></span>${pf(l.source)}</div>
        <div class="m num">${esc(l.phone || '')} · ${ago(l.created_at)}</div>
        <div class="m">${esc([l.business_type, l.assignee_name && `담당 ${l.assignee_name}`].filter(Boolean).join(' · '))}</div>
        ${l.callback_at ? `<div class="m">📅 ${esc(l.callback_at.replace('T', ' ').slice(5, 16))}</div>` : ''}
      </div>`).join('')}</div>`;
  }).join('')}</div>
  ${rows.length >= 200 ? '<div class="muted small" style="margin-top:8px">최근 200건만 보드에 표시합니다. 기간·검색 조건으로 좁혀 보세요.</div>' : ''}`;
  let dragId = null;
  $$('.lead-card', body).forEach((c) => {
    c.addEventListener('dragstart', () => { dragId = Number(c.dataset.id); });
    c.addEventListener('click', () => openLead(Number(c.dataset.id)));
  });
  $$('.col', body).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', guard(async (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      if (!dragId) return;
      await api(`/leads/${dragId}`, { method: 'PUT', body: { status: col.dataset.st } });
      toast(`'${col.dataset.st}' 로 이동했습니다.`);
      dragId = null;
      loadLeadBody(view);
    }));
  });
}

function leadForm() {
  modal(`<h2>DB 직접 등록</h2>
    <form class="form-grid" id="lf">
      <label class="f">이름<input type="text" name="name"></label>
      <label class="f">연락처<input type="tel" name="phone"></label>
      <label class="f">상호<input type="text" name="company"></label>
      <label class="f">업종<input type="text" name="business_type"></label>
      <label class="f">성별<select name="gender"><option value=""></option><option>남</option><option>여</option></select></label>
      <label class="f">연령대<select name="age_group"><option value=""></option>${['20대', '30대', '40대', '50대', '60대+'].map((a) => `<option>${a}</option>`).join('')}</select></label>
      <label class="f">지역<input type="text" name="region"></label>
      <label class="f">유입 매체<select name="source">${Object.entries(PLATFORM).map(([k, v]) => `<option value="${k}" ${k === 'manual' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f full">문의 내용<textarea name="desired_amount" rows="2"></textarea></label>
      <label class="f">캠페인<select name="campaign_id"><option value=""></option>${campaignOpts()}</select></label>
      ${!S.me.partner_id ? `<label class="f">업체<select name="partner_id"><option value=""></option>${partnerOpts()}</select></label>` : ''}
      ${S.me.role !== 'agent' ? `<label class="f">담당자<select name="assignee_id"><option value="">자동 배정</option>${userOpts()}</select></label>` : ''}
      <label class="check full"><input type="checkbox" name="notify" checked> 텔레그램 알림 + 접수 알림톡 보내기</label>
    </form>
    <div class="modal-foot"><button class="btn" data-close>취소</button><button class="btn primary" id="save">등록</button></div>`, {
    onMount: (el, close) => $('#save', el).addEventListener('click', guard(async () => {
      const b = formData($('#lf', el));
      const r = await api('/leads', { method: 'POST', body: b });
      close();
      toast('등록했습니다.');
      route();
      openLead(r.id);
    })),
  });
}

function importDialog() {
  modal(`<h2>엑셀(CSV) 업로드</h2>
    <div class="notice">엑셀에서 <b>CSV UTF-8</b> 형식으로 저장한 파일을 올려주세요. 첫 줄은 제목 행이며 <b>이름, 연락처, 상호, 업종, 지역, 성별, 나이</b> 등의 제목을 자동으로 인식합니다. 나머지 열은 기타 응답으로 보관됩니다.</div>
    <input type="file" id="file" accept=".csv,text/csv">
    <label class="f">캠페인 지정 (선택)<select id="camp"><option value=""></option>${campaignOpts()}</select></label>
    <label class="check"><input type="checkbox" id="notify"> 업로드한 DB에도 알림(텔레그램·알림톡) 보내기</label>
    <div class="modal-foot"><button class="btn" data-close>취소</button><button class="btn primary" id="go">업로드</button></div>`, {
    onMount: (el, close) => $('#go', el).addEventListener('click', guard(async () => {
      const file = $('#file', el).files[0];
      if (!file) return toast('파일을 선택하세요.', true);
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
      const r = await api('/leads/import', { method: 'POST', body: { csv: text, campaign_id: $('#camp', el).value, notify: $('#notify', el).checked } });
      close();
      toast(`${r.count}건 업로드했습니다.`);
      route();
    })),
  });
}

/* 고객 상세 */
async function openLead(id) {
  const d = await api(`/leads/${id}`).catch((e) => { toast(e.message, true); return null; });
  if (!d) return;
  const l = d.lead;
  let extra = {};
  try { extra = JSON.parse(l.extra_json || '{}'); } catch { extra = {}; }
  const ICON = { memo: '✎', status: '◆', assign: '👤', kakao: '✉', telegram: '➤', system: '•' };
  const tplOpts = S.templates.filter((t) => t.active).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  modal(`
    <div class="row"><h1 style="margin-right:auto">${esc(l.name || '(이름 없음)')} ${badge(l.status)} ${l.is_duplicate ? '<span class="badge bad">중복</span>' : ''}</h1><button class="btn" data-close>닫기</button></div>
    <div class="row muted small">${pf(l.source)} · 접수 ${esc(l.created_at)} ${l.first_contact_at ? `· 첫 응대 ${esc(l.first_contact_at.slice(11, 16))}` : '· <b style="color:var(--accent)">아직 응대 전</b>'}</div>
    ${l.phone ? `<div class="row"><a class="btn primary" href="tel:${esc(l.phone)}">📞 ${esc(l.phone)} 전화</a><a class="btn" href="sms:${esc(l.phone)}">문자</a></div>` : ''}
    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>진행 관리</h2></div>
        <div class="form-grid" id="prog">
          <label class="f">상태<select name="status">${statusOpts(l.status)}</select></label>
          <label class="f">담당자<select name="assignee_id" ${S.me.role === 'agent' ? 'disabled' : ''}><option value="">미배정</option>${userOpts(l.assignee_id, l.partner_id)}</select></label>
          <label class="f">콜백·예약 일시<input type="datetime-local" name="callback_at" value="${esc((l.callback_at || '').replace(' ', 'T').slice(0, 16))}"></label>
          <label class="f">구매 금액(원)<input type="text" inputmode="numeric" name="sale_amount" value="${l.sale_amount ? fmt(l.sale_amount) : ''}"></label>
        </div>
        <div class="row" style="margin-top:10px"><span class="muted small">상태를 바꾸면 그 상태에 연결된 알림톡이 자동 발송됩니다.</span><span class="spacer"></span><button class="btn primary" id="save-prog">저장</button></div>
      </div>
      <div class="card"><div class="card-head"><h2>고객 정보</h2><button class="btn sm" id="edit-info">수정</button></div>
        <dl class="kv" id="info">
          <dt>연락처</dt><dd class="num">${esc(l.phone || '-')}</dd><dt>상호</dt><dd>${esc(l.company || '-')}</dd>
          <dt>업종</dt><dd>${esc(l.business_type || '-')}</dd><dt>지역</dt><dd>${esc(l.region || '-')}</dd>
          <dt>성별/연령</dt><dd>${esc([l.gender, l.age_group].filter(Boolean).join(' · ') || '-')}</dd>
          <dt>매출</dt><dd>${esc(l.annual_revenue || '-')}</dd><dt>문의</dt><dd>${esc(l.desired_amount || '-')}</dd>
          ${Object.entries(extra).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
        </dl>
      </div>
    </div>
    <div class="card"><div class="card-head"><h2>유입 경로</h2></div>
      <dl class="kv"><dt>업체</dt><dd>${esc(l.partner_name || '-')}</dd><dt>캠페인</dt><dd>${esc(l.campaign_name || '-')}</dd><dt>광고세트</dt><dd>${esc(l.adset_name || '-')}</dd>
      <dt>광고</dt><dd>${esc(l.ad_name || '-')}</dd><dt>양식</dt><dd>${esc(l.form_name || '-')}</dd>${l.meta_lead_id ? `<dt>메타 리드ID</dt><dd class="small">${esc(l.meta_lead_id)}</dd>` : ''}</dl>
      ${d.samePhone.length ? `<div class="notice warn" style="margin-top:10px">같은 번호로 접수된 이력 ${d.samePhone.length}건: ${d.samePhone.map((s) => `<a href="#" data-open="${s.id}">#${s.id} ${esc(s.created_at.slice(0, 10))} (${esc(s.status)})</a>`).join(', ')}</div>` : ''}
    </div>
    <div class="card"><div class="card-head"><h2>알림톡 보내기</h2></div>
      <div class="row"><select id="tpl" style="width:auto;flex:1">${tplOpts}</select><button class="btn" id="prev">미리보기</button><button class="btn primary" id="send">발송</button>
      ${isMgr() ? '<button class="btn" id="tg">텔레그램 재전송</button>' : ''}</div>
      <div id="prev-box" style="margin-top:10px"></div>
    </div>
    <div class="card"><div class="card-head"><h2>상담 메모 · 이력</h2></div>
      <div class="row"><textarea id="memo" rows="2" placeholder="통화 내용, 특이사항을 남겨주세요" style="flex:1"></textarea><button class="btn primary" id="add-memo">메모 저장</button></div>
      <div class="timeline" style="margin-top:8px">${d.activities.map((a) => `<div class="tl"><span>${ICON[a.type] || '•'}</span><div><div>${esc(a.content)}</div><div class="who">${esc(a.user_name || '시스템')} · ${esc(a.created_at)}</div></div></div>`).join('')}</div>
    </div>
    ${d.notifications.length ? `<div class="card"><div class="card-head"><h2>발송 기록</h2></div><div class="table-wrap"><table><thead><tr><th>시각</th><th>채널</th><th>템플릿</th><th>결과</th></tr></thead><tbody>
      ${d.notifications.map((n) => `<tr><td class="small num">${esc(n.created_at.slice(5, 16))}</td><td>${n.channel === 'kakao' ? '알림톡' : '텔레그램'}</td><td>${esc(n.template_code || '-')}</td><td>${sendBadge(n.status)}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    ${isAdmin() ? '<div class="row"><span class="spacer"></span><button class="btn danger sm" id="del">이 DB 삭제</button></div>' : ''}
  `, {
    center: false,
    onMount: (el, close) => {
      const refresh = () => { close(); openLead(id); };
      $$('[data-open]', el).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); close(); openLead(Number(a.dataset.open)); }));
      $('#save-prog', el).addEventListener('click', guard(async () => {
        const b = formData($('#prog', el));
        if (S.me.role === 'agent') delete b.assignee_id;
        b.callback_at = b.callback_at ? b.callback_at.replace('T', ' ') : '';
        await api(`/leads/${id}`, { method: 'PUT', body: b });
        toast('저장했습니다.');
        refresh();
        if (location.hash.startsWith('#/leads') || location.hash.startsWith('#/dashboard')) softReload();
      }));
      $('#add-memo', el).addEventListener('click', guard(async () => {
        const content = $('#memo', el).value.trim();
        if (!content) return;
        await api(`/leads/${id}/memo`, { method: 'POST', body: { content } });
        refresh();
      }));
      $('#prev', el).addEventListener('click', guard(async () => {
        const r = await api(`/kakao-templates/${$('#tpl', el).value}/preview`, { method: 'POST', body: { lead_id: id } });
        $('#prev-box', el).innerHTML = `<div class="preview-head">알림톡 도착</div><div class="preview-bubble">${esc(r.text)}</div>`;
      }));
      $('#send', el).addEventListener('click', guard(async () => {
        if (!$('#tpl', el).value) return toast('템플릿이 없습니다.', true);
        const r = await api(`/leads/${id}/kakao`, { method: 'POST', body: { template_id: $('#tpl', el).value } });
        toast(r.status === 'failed' ? '발송 실패 (발송 기록 확인)' : r.status === 'mock' ? '테스트 모드로 기록했습니다 (API 키 미설정)' : '발송했습니다.', r.status === 'failed');
        refresh();
      }));
      if ($('#tg', el)) $('#tg', el).addEventListener('click', guard(async () => { await api(`/leads/${id}/telegram`, { method: 'POST' }); toast('텔레그램 전송을 요청했습니다.'); refresh(); }));
      $('#edit-info', el).addEventListener('click', () => editInfo(l, refresh));
      if ($('#del', el)) $('#del', el).addEventListener('click', guard(async () => {
        if (!confirm('이 DB를 삭제할까요? 되돌릴 수 없습니다.')) return;
        await api(`/leads/${id}`, { method: 'DELETE' });
        close();
        softReload();
      }));
    },
  });
}

function sendBadge(s) {
  return s === 'sent' ? '<span class="badge ok">✓ 발송</span>' : s === 'failed' ? '<span class="badge bad">✕ 실패</span>' : s === 'mock' ? '<span class="badge warn">테스트</span>' : `<span class="badge">${esc(s)}</span>`;
}

function editInfo(l, done) {
  modal(`<h2>고객 정보 수정</h2><form class="form-grid" id="ef">
    ${[['name', '이름'], ['phone', '연락처'], ['company', '상호'], ['business_type', '업종'], ['region', '지역'], ['annual_revenue', '매출'], ['desired_amount', '문의 내용']]
      .map(([k, t]) => `<label class="f">${t}<input type="text" name="${k}" value="${esc(l[k] || '')}"></label>`).join('')}
    <label class="f">성별<select name="gender"><option value=""></option>${['남', '여'].map((g) => `<option ${l.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
    <label class="f">연령대<select name="age_group"><option value=""></option>${['20대', '30대', '40대', '50대', '60대+'].map((a) => `<option ${l.age_group === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
  </form><div class="modal-foot"><button class="btn" data-close>취소</button><button class="btn primary" id="ok">저장</button></div>`, {
    onMount: (el, close) => $('#ok', el).addEventListener('click', guard(async () => {
      await api(`/leads/${l.id}`, { method: 'PUT', body: formData($('#ef', el)) });
      close();
      done();
    })),
  });
}

function softReload() {
  const view = $('#view');
  if (!view) return;
  const name = (location.hash.slice(2).split(/[/?]/)[0]) || 'dashboard';
  if (name === 'leads') loadLeadBody(view).catch(() => {});
  else if (name === 'dashboard') { destroyCharts(); pageDashboard(view).catch(() => {}); }
}

/* ───────── 광고 효율 ───────── */
async function pageAds(view) {
  S.adLevel = S.adLevel || 'campaign';
  const rb = rangeBar(() => pageAds(view));
  view.innerHTML = `<div class="page-head"><h1>광고 효율</h1>${rb.html}
    ${isAdmin() ? '<button class="btn" id="sync">메타 광고비 불러오기</button><button class="btn" id="manual">광고비 직접 입력</button><button class="btn" id="camps">캠페인 관리</button>' : ''}</div>
    <div id="ad-body"><div class="empty">불러오는 중…</div></div>`;
  rb.mount(view);
  if (isAdmin()) {
    $('#sync', view).addEventListener('click', guard(async () => {
      const r = await api('/meta/sync-insights', { method: 'POST', body: { from: S.range.from, to: S.range.to } });
      toast(`${r.rows}개 행을 불러왔습니다.`);
      pageAds(view);
    }));
    $('#manual', view).addEventListener('click', () => spendDialog(() => pageAds(view)));
    $('#camps', view).addEventListener('click', () => campaignDialog(() => pageAds(view)));
  }
  const d = await api(`/ad-performance?${qs({ from: S.range.from, to: S.range.to, level: S.adLevel })}`);
  const bestCard = (title, b) => `<div class="card best"><div class="rank">${title} 1위</div>
    ${b ? `<div class="name trunc" title="${esc(b.name)}">${esc(b.name || '(이름 없음)')}</div><div class="num">DB당 <b>${won(b.cpl)}</b> · ${fmt(b.leads)}건</div>
    <div class="small muted">평균 ${won(b.avgCpl)}보다 <b style="color:var(--good)">${b.cheaperPct}% 저렴</b></div>` : '<div class="muted small" style="margin-top:6px">광고비와 DB가 쌓이면 표시됩니다.</div>'}</div>`;
  const lv = S.adLevel;
  const tot = d.rows.reduce((a, r) => ({ spend: a.spend + r.spend, leads: a.leads + r.leads, valid: a.valid + r.valid, won: a.won + r.won, revenue: a.revenue + r.revenue }), { spend: 0, leads: 0, valid: 0, won: 0, revenue: 0 });
  $('#ad-body', view).innerHTML = `
    <div class="grid g3">${bestCard('캠페인', d.best.campaign)}${bestCard('타겟(광고세트)', d.best.adset)}${bestCard('광고 소재', d.best.ad)}</div>
    <div class="card" style="margin-top:14px">
      <div class="card-head"><h2>성과 상세</h2><div class="seg">${[['campaign', '캠페인'], ['adset', '타겟'], ['ad', '광고']].map(([k, l]) => `<button data-lv="${k}" class="${lv === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="table-wrap"><table><thead><tr><th>매체</th><th>캠페인</th>${lv !== 'campaign' ? '<th>타겟</th>' : ''}${lv === 'ad' ? '<th>광고</th>' : ''}
        <th class="r">광고비</th><th class="r">노출</th><th class="r">CTR</th><th class="r">DB</th><th class="r">유효</th><th class="r">DB 단가</th><th class="r">구매</th><th class="r">전환율</th><th class="r">매출</th><th class="r">ROAS</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr><td>${pf(r.platform)}</td><td class="trunc" title="${esc(r.campaign_name)}">${esc(r.campaign_name || '-')}</td>
        ${lv !== 'campaign' ? `<td class="trunc">${esc(r.adset_name || '-')}</td>` : ''}${lv === 'ad' ? `<td class="trunc">${esc(r.ad_name || '-')}</td>` : ''}
        <td class="r num">${fmt(r.spend)}</td><td class="r num">${fmt(r.impressions)}</td><td class="r num">${pct(r.ctr)}</td><td class="r num">${fmt(r.leads)}</td><td class="r num">${fmt(r.valid)}</td>
        <td class="r num"><b>${r.cpl != null ? fmt(r.cpl) : '-'}</b></td><td class="r num">${fmt(r.won)}</td><td class="r num">${pct(r.convRate)}</td><td class="r num">${fmt(r.revenue)}</td>
        <td class="r num" style="color:${r.roas >= 100 ? 'var(--good)' : r.roas != null ? 'var(--bad)' : 'inherit'}">${pct(r.roas)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><th></th>${lv !== 'campaign' ? '<th></th>' : ''}${lv === 'ad' ? '<th></th>' : ''}<th class="r num">${fmt(tot.spend)}</th><th></th><th></th><th class="r num">${fmt(tot.leads)}</th><th class="r num">${fmt(tot.valid)}</th>
        <th class="r num">${tot.valid ? fmt(Math.round(tot.spend / tot.valid)) : '-'}</th><th class="r num">${fmt(tot.won)}</th><th></th><th class="r num">${fmt(tot.revenue)}</th><th class="r num">${tot.spend ? pct(Math.round(100 * tot.revenue / tot.spend)) : '-'}</th></tr></tfoot>
      </table></div>
      ${d.rows.length ? '' : '<div class="empty">이 기간의 광고 데이터가 없습니다.</div>'}
      <div class="muted small" style="margin-top:8px">DB 단가 = 광고비 ÷ 유효 DB(허수·중복 제외). ROAS = 매출 ÷ 광고비. 매출은 '구매완료·재구매' 상태의 구매 금액 합계입니다.</div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>DB 단가 비교</h2><span class="muted small">원</span></div><div class="chart-box" style="height:${Math.max(160, Math.min(d.rows.filter((r) => r.cpl).length, 12) * 30 + 40)}px"><canvas id="c-cpl"></canvas></div></div>`;
  $$('[data-lv]', view).forEach((b) => b.addEventListener('click', () => { S.adLevel = b.dataset.lv; pageAds(view); }));
  const top = d.rows.filter((r) => r.cpl).sort((a, b) => a.cpl - b.cpl).slice(0, 12);
  const label = (r) => (lv === 'campaign' ? r.campaign_name : lv === 'adset' ? r.adset_name : r.ad_name) || '-';
  chart($('#c-cpl'), {
    type: 'bar',
    data: { labels: top.map(label), datasets: [{ label: 'DB 단가', data: top.map((r) => r.cpl), backgroundColor: css('--s1'), borderRadius: { topRight: 4, bottomRight: 4 }, maxBarThickness: 16 }] },
    tooltip: { label: (c) => ` DB 단가 ${won(c.parsed.x)}` },
    options: { indexAxis: 'y', scales: { x: { grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: (v) => fmt(v) } }, y: { grid: { display: false } } } },
  });
}

function spendDialog(done) {
  modal(`<h2>광고비 직접 입력</h2>
    <div class="notice">메타 외 매체(구글·네이버·카카오)나 API 연동 전에는 일자별 광고비를 직접 입력하세요. 같은 날짜·캠페인·타겟·광고는 덮어씁니다.</div>
    <form class="form-grid" id="sf">
      <label class="f full">캠페인<select name="campaign_id" required>${campaignOpts()}</select></label>
      <label class="f">날짜<input type="date" name="date" value="${kstToday()}"></label>
      <label class="f">광고비(원)<input type="number" name="spend" min="0"></label>
      <label class="f">노출<input type="number" name="impressions" min="0"></label>
      <label class="f">클릭<input type="number" name="clicks" min="0"></label>
      <label class="f">타겟(광고세트) <span class="hint">선택</span><input type="text" name="adset_name"></label>
      <label class="f">광고 <span class="hint">선택</span><input type="text" name="ad_name"></label>
    </form>
    <div class="modal-foot"><button class="btn" data-close>닫기</button><button class="btn primary" id="ok">저장</button></div>`, {
    onMount: (el, close) => $('#ok', el).addEventListener('click', guard(async () => {
      await api('/ad-stats', { method: 'POST', body: formData($('#sf', el)) });
      toast('저장했습니다.');
      close();
      done();
    })),
  });
}

function campaignDialog(done) {
  const rows = () => S.campaigns.map((c) => `<tr data-id="${c.id}"><td><input type="text" name="name" value="${esc(c.name)}"></td>
    <td><select name="platform">${['meta', 'google', 'naver', 'kakao', 'landing'].map((p) => `<option value="${p}" ${c.platform === p ? 'selected' : ''}>${PLATFORM[p]}</option>`).join('')}</select></td>
    <td><input type="text" name="external_id" value="${esc(c.external_id || '')}" placeholder="매체 캠페인 ID"></td>
    <td><select name="partner_id"><option value="">-</option>${partnerOpts(c.partner_id)}</select></td><td><button class="btn sm" data-save>저장</button></td></tr>`).join('');
  modal(`<h2>캠페인 관리</h2>
    <div class="notice">캠페인에 <b>업체</b>를 지정하면 그 캠페인으로 들어오는 DB가 해당 업체로 자동 분배됩니다. 메타 캠페인은 DB가 들어오면 자동으로 생성됩니다.</div>
    <div class="table-wrap"><table><thead><tr><th>이름</th><th>매체</th><th>캠페인 ID</th><th>업체</th><th></th></tr></thead><tbody id="cb">${rows()}</tbody></table></div>
    <div class="row"><input type="text" id="nn" placeholder="새 캠페인 이름" style="flex:1"><select id="np" style="width:auto">${['meta', 'google', 'naver', 'kakao'].map((p) => `<option value="${p}">${PLATFORM[p]}</option>`).join('')}</select><button class="btn" id="add">추가</button></div>
    <div class="modal-foot"><button class="btn" data-close>닫기</button></div>`, {
    onMount: (el, close) => {
      const bind = () => $$('[data-save]', el).forEach((b) => b.addEventListener('click', guard(async () => {
        const tr = b.closest('tr');
        await api(`/campaigns/${tr.dataset.id}`, { method: 'PUT', body: formData(tr) });
        toast('저장했습니다.');
      })));
      bind();
      $('#add', el).addEventListener('click', guard(async () => {
        const name = $('#nn', el).value.trim();
        if (!name) return;
        await api('/campaigns', { method: 'POST', body: { name, platform: $('#np', el).value } });
        S.campaigns = await api('/campaigns');
        $('#cb', el).innerHTML = rows();
        bind();
        $('#nn', el).value = '';
      }));
      el.closest('.overlay').addEventListener('mousedown', async (e) => { if (e.target === el.closest('.overlay')) { S.campaigns = await api('/campaigns'); done(); } });
      $('[data-close]', el).addEventListener('click', async () => { S.campaigns = await api('/campaigns'); done(); });
    },
  });
}

/* ───────── 랜딩페이지 ───────── */
async function pageLanding(view) {
  const rb = rangeBar(() => pageLanding(view));
  view.innerHTML = `<div class="page-head"><h1>랜딩페이지</h1>${rb.html}<button class="btn primary" id="new">+ 새 랜딩페이지</button></div><div id="lp"></div>`;
  rb.mount(view);
  const d = await api(`/landing-pages?${qs({ from: S.range.from, to: S.range.to })}`);
  $('#new', view).addEventListener('click', () => landingEditor(null, d.defaultFields, () => pageLanding(view)));
  $('#lp', view).innerHTML = d.rows.length ? `<div class="grid g3">${d.rows.map((p) => `<div class="card" style="padding:0;overflow:hidden">
      <div style="background:${esc(p.color)};color:#fff;padding:18px 16px;min-height:96px"><div class="small" style="opacity:.85">/l/${esc(p.slug)}</div><h2 style="margin-top:4px;white-space:pre-line">${esc(p.headline || p.title)}</h2></div>
      <div style="padding:14px 16px;display:grid;gap:10px">
        <div class="row"><b>${esc(p.title)}</b>${p.active ? '' : '<span class="badge">중지</span>'}<span class="spacer"></span><span class="muted small">${esc(p.partner_name || '')}</span></div>
        <div class="grid g3" style="gap:6px;text-align:center">
          <div><div class="muted small">방문</div><b class="num">${fmt(p.views)}</b></div><div><div class="muted small">DB</div><b class="num">${fmt(p.leads)}</b></div><div><div class="muted small">전환율</div><b class="num">${pct(p.cvr)}</b></div>
        </div>
        <div class="row"><a class="btn sm" href="/l/${esc(p.slug)}" target="_blank" rel="noopener">열기</a><button class="btn sm copy" data-url="${location.origin}/l/${esc(p.slug)}">주소 복사</button>
        <a class="btn sm" href="#/leads?landing_id=${p.id}">DB 보기</a><span class="spacer"></span><button class="btn sm" data-edit="${p.id}">편집</button></div>
      </div></div>`).join('')}</div>
      <div class="muted small" style="margin-top:10px">광고 링크 뒤에 <code>?utm_source=meta&amp;utm_campaign=캠페인명&amp;utm_content=광고명</code> 을 붙이면 매체·캠페인·광고별로 DB가 분류됩니다.</div>`
    : '<div class="card empty">아직 랜딩페이지가 없습니다. 새로 만들어 광고에 연결해 보세요.</div>';
  $$('.copy', view).forEach((b) => b.addEventListener('click', () => { navigator.clipboard.writeText(b.dataset.url); toast('주소를 복사했습니다.'); }));
  $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => landingEditor(d.rows.find((r) => r.id === Number(b.dataset.edit)), d.defaultFields, () => pageLanding(view))));
}

function landingEditor(p, defaults, done) {
  const v = p || { title: '', slug: '', headline: '', description: '', color: '#1a62fb', button_text: '무료 상담 신청', done_message: '신청이 완료되었습니다. 곧 연락드리겠습니다.', fields_json: JSON.stringify(defaults), active: 1 };
  let fields = [];
  try { fields = JSON.parse(v.fields_json); } catch { fields = defaults; }
  const fieldRow = (f) => `<tr><td><input type="text" data-k="label" value="${esc(f.label)}"></td>
    <td><select data-k="key">${[['name', '이름'], ['phone', '연락처'], ['company', '상호'], ['business_type', '업종'], ['region', '지역'], ['gender', '성별'], ['age_group', '연령대'], ['annual_revenue', '매출'], ['desired_amount', '문의내용']]
      .map(([k, l]) => `<option value="${k}" ${f.key === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="${esc(f.key)}" ${!['name', 'phone', 'company', 'business_type', 'region', 'gender', 'age_group', 'annual_revenue', 'desired_amount'].includes(f.key) ? 'selected' : ''}>${esc(f.key)} (기타)</option></select></td>
    <td><select data-k="type">${[['text', '한 줄'], ['tel', '전화'], ['select', '선택'], ['radio', '버튼 선택'], ['textarea', '여러 줄']].map(([k, l]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input type="text" data-k="options" value="${esc(f.options || '')}" placeholder="쉼표로 구분"></td>
    <td><input type="checkbox" data-k="required" ${f.required ? 'checked' : ''}></td><td><button class="btn sm ghost" data-rm>✕</button></td></tr>`;
  modal(`<h2>${p ? '랜딩페이지 편집' : '새 랜딩페이지'}</h2>
    <form class="form-grid" id="lf">
      <label class="f">관리용 이름<input type="text" name="title" value="${esc(v.title)}" required></label>
      <label class="f">주소 <span class="hint">/l/주소 (영문·숫자)</span><input type="text" name="slug" value="${esc(v.slug)}" ${p ? 'disabled' : ''} placeholder="비우면 자동 생성"></label>
      <label class="f full">큰 제목<textarea name="headline" rows="2">${esc(v.headline || '')}</textarea></label>
      <label class="f full">설명<textarea name="description" rows="2">${esc(v.description || '')}</textarea></label>
      <label class="f">대표 이미지 주소 <span class="hint">선택</span><input type="text" name="image_url" value="${esc(v.image_url || '')}"></label>
      <label class="f">테마 색<input type="color" name="color" value="${esc(v.color)}" style="height:38px;padding:2px"></label>
      <label class="f">버튼 문구<input type="text" name="button_text" value="${esc(v.button_text)}"></label>
      <label class="f">연결 캠페인 <span class="hint">utm 없을 때</span><select name="campaign_id"><option value=""></option>${campaignOpts(v.campaign_id)}</select></label>
      <label class="f full">완료 문구<input type="text" name="done_message" value="${esc(v.done_message)}"></label>
      ${p ? `<label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> 공개 중</label>` : ''}
    </form>
    <h3>입력 항목</h3>
    <div class="table-wrap"><table><thead><tr><th>표시 이름</th><th>저장 위치</th><th>형식</th><th>선택지</th><th>필수</th><th></th></tr></thead><tbody id="fb">${fields.map(fieldRow).join('')}</tbody></table></div>
    <button class="btn sm" id="addf" style="justify-self:start">+ 항목 추가</button>
    <div class="modal-foot">${p ? '<button class="btn danger" id="del" style="margin-right:auto">삭제</button>' : ''}<button class="btn" data-close>취소</button><button class="btn primary" id="ok">저장</button></div>`, {
    onMount: (el, close) => {
      const bindRm = () => $$('[data-rm]', el).forEach((b) => { b.onclick = () => b.closest('tr').remove(); });
      bindRm();
      $('#addf', el).addEventListener('click', () => { $('#fb', el).insertAdjacentHTML('beforeend', fieldRow({ key: 'desired_amount', label: '새 항목', type: 'text' })); bindRm(); });
      $('#ok', el).addEventListener('click', guard(async () => {
        const b = formData($('#lf', el));
        b.fields_json = $$('#fb tr', el).map((tr) => {
          const o = {};
          $$('[data-k]', tr).forEach((i) => { o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; });
          return o;
        });
        if (p) await api(`/landing-pages/${p.id}`, { method: 'PUT', body: b });
        else await api('/landing-pages', { method: 'POST', body: b });
        toast('저장했습니다.');
        close();
        done();
      }));
      if ($('#del', el)) $('#del', el).addEventListener('click', guard(async () => {
        if (!confirm('랜딩페이지를 삭제할까요? 접수된 DB는 남습니다.')) return;
        await api(`/landing-pages/${p.id}`, { method: 'DELETE' });
        close();
        done();
      }));
    },
  });
}

/* ───────── 직원 · 응답속도 ───────── */
async function pageStaff(view) {
  const rb = rangeBar(() => pageStaff(view));
  view.innerHTML = `<div class="page-head"><h1>직원 · 응답 속도</h1>${rb.html}<button class="btn primary" id="new">+ 직원 계정</button></div><div id="sb"></div>`;
  rb.mount(view);
  const [perf] = await Promise.all([api(`/staff-performance?${qs({ from: S.range.from, to: S.range.to })}`), loadRefs()]);
  $('#new', view).addEventListener('click', () => userDialog(null, () => pageStaff(view)));
  $('#sb', view).innerHTML = `
    <div class="card"><div class="card-head"><h2>직원별 응답 속도 · 성과</h2><span class="muted small">첫 응대 = DB 접수 후 첫 상태 변경·메모·알림톡 발송까지</span></div>
      <div class="table-wrap"><table><thead><tr><th>이름</th><th class="r">배정</th><th class="r">응대</th><th class="r">미처리</th><th class="r">평균 첫 응대</th><th class="r">5분 내 응대</th><th class="r">구매</th><th class="r">전환율</th><th class="r">매출</th></tr></thead>
      <tbody>${perf.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td class="r num">${fmt(r.assigned)}</td><td class="r num">${fmt(r.contacted)}</td>
        <td class="r num" style="color:${r.untouched ? 'var(--accent)' : 'inherit'}">${fmt(r.untouched)}</td>
        <td class="r num"><b style="color:${r.resp != null && r.resp <= 10 ? 'var(--good)' : r.resp > 60 ? 'var(--bad)' : 'inherit'}">${mins(r.resp)}</b></td>
        <td class="r num">${r.contacted ? pct(Math.round(100 * r.within5 / r.contacted)) : '-'}</td><td class="r num">${fmt(r.won)}</td><td class="r num">${pct(r.convRate)}</td><td class="r num">${fmt(r.revenue)}</td></tr>`).join('')}</tbody></table></div>
      ${perf.length ? '' : '<div class="empty">배정된 DB가 없습니다.</div>'}
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>계정</h2><span class="muted small">상담원은 자기에게 배정된 DB만 봅니다</span></div>
      <div class="table-wrap"><table><thead><tr><th>이름</th><th>아이디</th><th>권한</th><th>업체</th><th class="r">누적 배정</th><th>상태</th><th></th></tr></thead>
      <tbody>${S.users.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td>${ROLE[u.role]}</td><td>${esc(u.partner_name || '전체')}</td><td class="r num">${fmt(u.lead_count)}</td>
        <td>${u.active ? '<span class="badge ok">사용</span>' : '<span class="badge">중지</span>'}</td><td><button class="btn sm" data-u="${u.id}">수정</button></td></tr>`).join('')}</tbody></table></div>
      <div class="muted small" style="margin-top:8px">새 DB는 같은 업체의 사용 중인 상담원에게 순서대로 자동 배정됩니다 (설정에서 끌 수 있음).</div>
    </div>`;
  $$('[data-u]', view).forEach((b) => b.addEventListener('click', () => userDialog(S.users.find((u) => u.id === Number(b.dataset.u)), () => pageStaff(view))));
}

function userDialog(u, done) {
  modal(`<h2>${u ? '계정 수정' : '직원 계정 만들기'}</h2>
    <form class="form-grid" id="uf">
      <label class="f">이름<input type="text" name="name" value="${esc(u ? u.name : '')}" required></label>
      <label class="f">아이디<input type="text" name="username" value="${esc(u ? u.username : '')}" ${u ? 'disabled' : ''} required></label>
      <label class="f">${u ? '새 비밀번호 <span class="hint">바꿀 때만</span>' : '비밀번호'}<input type="password" name="password" minlength="6"></label>
      ${isAdmin() ? `<label class="f">권한<select name="role">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${(u ? u.role : 'agent') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">업체<select name="partner_id"><option value="">전체 (운영사)</option>${partnerOpts(u ? u.partner_id : '')}</select></label>` : ''}
      ${u ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> 사용</label>` : ''}
    </form>
    <div class="modal-foot"><button class="btn" data-close>취소</button><button class="btn primary" id="ok">저장</button></div>`, {
    onMount: (el, close) => $('#ok', el).addEventListener('click', guard(async () => {
      const b = formData($('#uf', el));
      if (u) await api(`/users/${u.id}`, { method: 'PUT', body: b });
      else await api('/users', { method: 'POST', body: b });
      toast('저장했습니다.');
      close();
      done();
    })),
  });
}

/* ───────── 알림톡 템플릿 ───────── */
const VARS = ['이름', '연락처', '상호', '업종', '지역', '성별', '연령대', '상태', '담당자', '콜백일시', '구매금액', '접수일', '업체명', '회사대표번호'];

async function pageKakao(view) {
  S.templates = await api('/kakao-templates');
  const trig = (t) => (t.trigger_type === 'lead_created' ? 'DB 접수 시' : t.trigger_type === 'status_change' ? `상태 → ${t.trigger_value}` : '수동 발송');
  view.innerHTML = `<div class="page-head"><h1>알림톡 자동화</h1>${isAdmin() ? '<button class="btn" id="import-solapi">솔라피 템플릿 불러오기</button><button class="btn primary" id="new">+ 템플릿 추가</button>' : ''}</div>
    <div class="notice" style="margin-bottom:14px">고객이 DB를 남기거나 상태가 바뀌면 연결된 알림톡이 자동으로 나갑니다. <b>유형 조건</b>을 걸면 업종·성별 등 고객 유형별로 다른 템플릿이 나갑니다. 템플릿은 카카오 비즈니스 채널에서 <b>검수 완료된 코드</b>와 내용이 같아야 발송됩니다.</div>
    <div class="grid g2">${S.templates.map((t) => `<div class="card">
      <div class="card-head"><h2>${esc(t.name)}</h2>${t.active ? '<span class="badge ok">사용</span>' : '<span class="badge">중지</span>'}</div>
      <div class="row small" style="margin-bottom:8px"><span class="badge">${esc(trig(t))}</span>${t.delay_minutes ? `<span class="badge warn">${fmtDelay(t.delay_minutes)} 후</span>` : ''}
        ${t.match_field ? `<span class="badge">${esc(t.match_field)} ∋ ${esc(t.match_value)}</span>` : ''}<span class="muted">코드 ${esc(t.code)}</span></div>
      <div class="preview-bubble">${esc(t.content)}</div>
      ${isAdmin() ? `<div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn sm" data-e="${t.id}">수정</button></div>` : ''}
    </div>`).join('')}</div>`;
  if ($('#new', view)) $('#new', view).addEventListener('click', () => tplDialog(null, () => pageKakao(view)));
  if ($('#import-solapi', view)) $('#import-solapi', view).addEventListener('click', guard(async () => {
    const r = await api('/kakao-templates/import-solapi', { method: 'POST' });
    toast(`승인된 템플릿 ${r.added}개 추가, ${r.updated}개 갱신${r.skipped.length ? `, 검수 중·반려 ${r.skipped.length}개 제외` : ''}. 각 템플릿의 발송 시점을 지정해 주세요.`);
    pageKakao(view);
  }));
  $$('[data-e]', view).forEach((b) => b.addEventListener('click', () => tplDialog(S.templates.find((t) => t.id === Number(b.dataset.e)), () => pageKakao(view))));
}

function fmtDelay(m) {
  if (m % 1440 === 0) return `${m / 1440}일`;
  if (m % 60 === 0) return `${m / 60}시간`;
  return `${m}분`;
}

function tplDialog(t, done) {
  const v = t || { code: '', name: '', content: '', trigger_type: 'manual', trigger_value: '', delay_minutes: 0, match_field: '', match_value: '', buttons_json: '', active: 1 };
  const unit = v.delay_minutes && v.delay_minutes % 1440 === 0 ? 1440 : v.delay_minutes && v.delay_minutes % 60 === 0 ? 60 : 1;
  modal(`<h2>${t ? '템플릿 수정' : '템플릿 추가'}</h2>
    <form class="form-grid" id="tf">
      <label class="f">템플릿 이름<input type="text" name="name" value="${esc(v.name)}" required></label>
      <label class="f">템플릿 코드 <span class="hint">카카오 검수 코드</span><input type="text" name="code" value="${esc(v.code)}" required></label>
      <label class="f">언제 보낼까요<select name="trigger_type"><option value="manual" ${v.trigger_type === 'manual' ? 'selected' : ''}>수동 발송만</option><option value="lead_created" ${v.trigger_type === 'lead_created' ? 'selected' : ''}>DB 접수 시</option><option value="status_change" ${v.trigger_type === 'status_change' ? 'selected' : ''}>상태가 바뀔 때</option></select></label>
      <label class="f">대상 상태<select name="trigger_value"><option value=""></option>${statusOpts(v.trigger_value)}</select></label>
      <label class="f">지연 발송 <span class="hint">0 = 즉시, 발송 시점에 상태가 그대로일 때만</span><div class="row" style="flex-wrap:nowrap"><input type="number" min="0" id="dv" value="${v.delay_minutes ? v.delay_minutes / unit : 0}"><select id="du" style="width:auto"><option value="1" ${unit === 1 ? 'selected' : ''}>분</option><option value="60" ${unit === 60 ? 'selected' : ''}>시간</option><option value="1440" ${unit === 1440 ? 'selected' : ''}>일</option></select></div></label>
      <label class="f">유형 조건 <span class="hint">선택</span><div class="row" style="flex-wrap:nowrap"><select name="match_field" style="width:auto"><option value=""></option>${[['business_type', '업종'], ['gender', '성별'], ['age_group', '연령대'], ['region', '지역'], ['source', '매체']].map(([k, l]) => `<option value="${k}" ${v.match_field === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input type="text" name="match_value" value="${esc(v.match_value || '')}" placeholder="예: 음식점,도소매"></div></label>
      <label class="f full">내용 <span class="hint">변수: ${VARS.map((x) => `<code class="copy" data-var="${x}">#{${x}}</code>`).join(' ')}</span><textarea name="content" rows="8">${esc(v.content)}</textarea></label>
      <label class="f full">버튼 JSON <span class="hint">선택. 예: [{"buttonType":"WL","buttonName":"상담 예약","linkMo":"https://..."}]</span><textarea name="buttons_json" rows="2">${esc(v.buttons_json || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> 사용</label>
    </form>
    <div class="modal-foot">${t ? '<button class="btn danger" id="del" style="margin-right:auto">삭제</button>' : ''}<button class="btn" data-close>취소</button><button class="btn primary" id="ok">저장</button></div>`, {
    onMount: (el, close) => {
      const ta = $('[name=content]', el);
      $$('[data-var]', el).forEach((c) => c.addEventListener('click', () => {
        const ins = `#{${c.dataset.var}}`;
        const p = ta.selectionStart;
        ta.value = ta.value.slice(0, p) + ins + ta.value.slice(ta.selectionEnd);
        ta.focus();
      }));
      $('#ok', el).addEventListener('click', guard(async () => {
        const b = formData($('#tf', el));
        b.delay_minutes = Number($('#dv', el).value || 0) * Number($('#du', el).value);
        if (b.buttons_json) { try { JSON.parse(b.buttons_json); } catch { throw new Error('버튼 JSON 형식이 올바르지 않습니다.'); } }
        if (t) await api(`/kakao-templates/${t.id}`, { method: 'PUT', body: b });
        else await api('/kakao-templates', { method: 'POST', body: b });
        toast('저장했습니다.');
        close();
        done();
      }));
      if ($('#del', el)) $('#del', el).addEventListener('click', guard(async () => {
        if (!confirm('템플릿을 삭제할까요?')) return;
        await api(`/kakao-templates/${t.id}`, { method: 'DELETE' });
        close();
        done();
      }));
    },
  });
}

/* ───────── 발송 기록 ───────── */
async function pageLogs(view) {
  S.logFilter = S.logFilter || { channel: '', status: '' };
  const f = S.logFilter;
  view.innerHTML = `<div class="page-head"><h1>발송 기록</h1>
    <select id="ch" style="width:auto"><option value="">전체 채널</option><option value="kakao" ${f.channel === 'kakao' ? 'selected' : ''}>알림톡</option><option value="telegram" ${f.channel === 'telegram' ? 'selected' : ''}>텔레그램</option></select>
    <select id="st" style="width:auto"><option value="">전체 결과</option><option value="sent" ${f.status === 'sent' ? 'selected' : ''}>발송</option><option value="failed" ${f.status === 'failed' ? 'selected' : ''}>실패</option><option value="mock" ${f.status === 'mock' ? 'selected' : ''}>테스트</option></select></div>
    <div class="card" style="padding:0 16px"><div class="table-wrap"><table><thead><tr><th>시각</th><th>채널</th><th>고객</th><th>수신</th><th>템플릿</th><th>내용</th><th>결과</th></tr></thead><tbody id="lb"></tbody></table></div></div>`;
  $('#ch', view).addEventListener('change', (e) => { f.channel = e.target.value; pageLogs(view); });
  $('#st', view).addEventListener('change', (e) => { f.status = e.target.value; pageLogs(view); });
  const rows = await api(`/notifications?${qs(f)}`);
  $('#lb', view).innerHTML = rows.map((n) => `<tr class="${n.lead_id ? 'click' : ''}" data-id="${n.lead_id || ''}"><td class="small num">${esc(n.created_at.slice(5, 16))}</td><td>${n.channel === 'kakao' ? '알림톡' : '텔레그램'}</td>
    <td>${esc(n.lead_name || '-')}</td><td class="num small">${esc(n.target || '')}</td><td>${esc(n.template_code || '-')}</td>
    <td class="trunc small" title="${esc(n.content)}">${esc((n.content || '').replace(/<[^>]+>/g, '').slice(0, 60))}</td><td title="${esc(n.response || '')}">${sendBadge(n.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">기록이 없습니다.</td></tr>';
  $$('tr.click', view).forEach((tr) => tr.addEventListener('click', () => openLead(Number(tr.dataset.id))));
}

/* ───────── 설정 ───────── */
async function pageSettings(view) {
  if (!isAdmin()) return pageMySettings(view);
  const [s, signups] = await Promise.all([api('/settings'), api('/signups')]);
  await loadRefs();
  const origin = s['app.base_url'] || location.origin;
  const v = (k) => esc(s[k] || '');
  const sheetScript = `function onFormSubmit(e) {\n  var r = e.namedValues; var data = {};\n  for (var k in r) data[k] = r[k][0];\n  data.utm_source = 'sheet';\n  UrlFetchApp.fetch('${origin}/webhooks/lead?key=${s['lead.api_key']}', {\n    method: 'post', contentType: 'application/json', payload: JSON.stringify(data)\n  });\n}`;
  view.innerHTML = `<div class="page-head"><h1>설정</h1></div>
  ${signups.length ? `<div class="card" style="margin-bottom:14px"><div class="card-head"><h2>가입 승인 대기 <span class="badge warn">${signups.length}</span></h2></div>
    <div class="table-wrap"><table><thead><tr><th>신청일</th><th>회사</th><th>성함</th><th>직책</th><th>연락처</th><th>이메일</th><th>아이디</th><th>등급</th><th></th></tr></thead><tbody>
    ${signups.map((u) => `<tr data-id="${u.id}"><td class="small">${esc(u.created_at.slice(0, 10))}</td><td><b>${esc(u.partner_name || '')}</b></td><td>${esc(u.name)}</td><td>${esc(u.title || '')}</td><td>${esc(u.phone || '')}</td><td>${esc(u.email || '')}</td><td>${esc(u.username)}</td>
      <td><select name="plan" style="width:auto">${['일반', '한비즈 고객사', '프리미엄 수강생', '수강생'].map((p) => `<option>${p}</option>`).join('')}</select></td>
      <td class="row"><button class="btn sm primary" data-ap>승인</button><button class="btn sm danger" data-rj>거절</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>기본 정보</h2></div>
      <form class="form-grid" data-sec>
        <label class="f">서비스/회사 이름<input type="text" name="company.name" value="${v('company.name')}" placeholder="예: 한빛컨설팅 (알림톡 #{업체명})"></label>
        <label class="f">대표 번호<input type="text" name="company.phone" value="${v('company.phone')}" placeholder="예: 1588-0000 (알림톡 #{회사대표번호})"></label>
        <label class="f full">사이트 주소 <span class="hint">텔레그램 알림의 'CRM에서 보기' 링크, 웹훅 주소 안내에 사용</span><input type="text" name="app.base_url" value="${v('app.base_url')}" placeholder="${esc(location.origin)}"></label>
      </form><div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn primary" data-save>저장</button></div>
    </div>
    <div class="card"><div class="card-head"><h2>DB 분배 · 중복</h2></div>
      <form class="form-grid" data-sec>
        <label class="f">자동 배정<select name="lead.auto_assign"><option value="1" ${s['lead.auto_assign'] !== '0' ? 'selected' : ''}>상담원에게 순서대로</option><option value="0" ${s['lead.auto_assign'] === '0' ? 'selected' : ''}>사용 안 함</option></select></label>
        <label class="f">중복 판정 기간(일)<input type="number" name="lead.duplicate_days" value="${v('lead.duplicate_days') || 30}"></label>
        <label class="f full">필드 매핑 JSON <span class="hint">폼 질문 이름 → 저장 위치. 비우면 기본값</span><textarea name="lead.field_map" rows="3" placeholder='{"business_type":["업종","어떤 일을 하시나요?"]}'>${v('lead.field_map')}</textarea></label>
      </form><div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn primary" data-save>저장</button></div>
    </div>

    <div class="card span2"><div class="card-head"><h2>메타(페이스북·인스타그램) 인스턴트 양식</h2>${s['meta.page_access_token'] ? '<span class="badge ok">연결됨</span>' : '<span class="badge warn">미연결</span>'}</div>
      <div class="notice" style="margin-bottom:10px">① Meta for Developers 앱 → Webhooks → <b>Page</b> 의 <b>leadgen</b> 필드를 구독하고 아래 콜백 주소와 확인 토큰을 입력하세요. ② 페이지에 앱을 연결(leads_retrieval 권한)한 뒤 <b>페이지 액세스 토큰</b>을 넣으면 리드 상세(이름·연락처·광고명)를 자동으로 가져옵니다. ③ 광고비 자동 수집은 광고 계정 ID와 ads_read 권한 토큰이 필요합니다.</div>
      <form class="form-grid" data-sec>
        <label class="f">콜백 URL<input type="text" readonly value="${esc(origin)}/webhooks/meta" class="copy-in"></label>
        <label class="f">확인 토큰 (Verify Token)<div class="row" style="flex-wrap:nowrap"><input type="text" name="meta.verify_token" value="${v('meta.verify_token')}"><button type="button" class="btn sm" data-gen="meta.verify_token">새로 만들기</button></div></label>
        <label class="f">앱 시크릿 <span class="hint">서명 검증용</span><input type="text" name="meta.app_secret" value="${v('meta.app_secret')}"></label>
        <label class="f">페이지 ID ${s['meta.page_name'] ? `<span class="hint">${esc(s['meta.page_name'])}</span>` : ''}<div class="row" style="flex-wrap:nowrap"><input type="text" name="meta.page_id" value="${v('meta.page_id')}"><button type="button" class="btn sm" id="connect-page">페이지 연결</button></div></label>
        <label class="f">페이지 액세스 토큰 <span class="hint">비우면 '페이지 연결'이 광고 API 토큰으로 받아옴</span><input type="text" name="meta.page_access_token" value="${v('meta.page_access_token')}"></label>
        <label class="f">광고 계정 ID<input type="text" name="meta.ad_account_id" value="${v('meta.ad_account_id')}" placeholder="act_1234567890"></label>
        <label class="f">광고 API 토큰 (ads_read)<input type="text" name="meta.ads_access_token" value="${v('meta.ads_access_token')}"></label>
      </form>
      <div class="row" style="margin-top:10px"><span class="muted small">${s['meta.last_sync'] ? `마지막 광고비 동기화 ${esc(s['meta.last_sync'].slice(0, 16).replace('T', ' '))}` : ''}</span><span class="spacer"></span>
        <button class="btn" id="sim">테스트 리드 넣어보기</button><button class="btn" id="whlog">수신 기록</button><button class="btn primary" data-save>저장</button></div>
    </div>

    <div class="card"><div class="card-head"><h2>텔레그램 알림</h2>${s['telegram.bot_token'] ? '<span class="badge ok">연결됨</span>' : '<span class="badge warn">미연결</span>'}</div>
      <div class="notice" style="margin-bottom:10px">@BotFather 에서 봇을 만들고 토큰을 넣으세요. 봇을 알림 받을 방에 초대하고 아무 메시지나 보낸 뒤 <b>채팅방 찾기</b>를 누르면 채팅 ID가 나옵니다. 업체별 방은 아래 업체 관리에서 지정합니다.</div>
      <form class="form-grid" data-sec>
        <label class="f full">봇 토큰<input type="text" name="telegram.bot_token" value="${v('telegram.bot_token')}"></label>
        <label class="f full">운영사 공통 채팅 ID <span class="hint">여러 개는 쉼표로</span><input type="text" name="telegram.chat_ids" value="${v('telegram.chat_ids')}"></label>
        <label class="f full">알림톡 결과도 텔레그램으로<select name="telegram.notify_kakao"><option value="fail" ${(s['telegram.notify_kakao'] || 'fail') === 'fail' ? 'selected' : ''}>실패만 알림</option><option value="all" ${s['telegram.notify_kakao'] === 'all' ? 'selected' : ''}>발송 완료 + 실패</option><option value="none" ${s['telegram.notify_kakao'] === 'none' ? 'selected' : ''}>알리지 않음</option></select></label>
      </form>
      <div id="chats" class="small" style="margin-top:8px"></div>
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="find-chat">채팅방 찾기</button><button class="btn" id="tg-test">테스트 전송</button><button class="btn primary" data-save>저장</button></div>
    </div>

    <div class="card"><div class="card-head"><h2>카카오 알림톡</h2>${s['kakao.provider'] && s['kakao.provider'] !== 'mock' && s['kakao.api_key'] ? '<span class="badge ok">연결됨</span>' : '<span class="badge warn">테스트 모드</span>'}</div>
      <div class="notice" style="margin-bottom:10px">알림톡은 카카오 공식 딜러사 API로 발송합니다. 비즈니스 채널 연결(발신 프로필 키)과 템플릿 검수가 먼저 필요합니다. 키가 없으면 실제 발송 없이 기록만 남깁니다.</div>
      <form class="form-grid" data-sec>
        <label class="f">발송 대행사<select name="kakao.provider">${[['mock', '테스트(발송 안 함)'], ['solapi', '솔라피 (SOLAPI)'], ['aligo', '알리고 (Aligo)']].map(([k, l]) => `<option value="${k}" ${(s['kakao.provider'] || 'mock') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">발신 번호<input type="text" name="kakao.sender_phone" value="${v('kakao.sender_phone')}"></label>
        <label class="f">API Key<input type="text" name="kakao.api_key" value="${v('kakao.api_key')}"></label>
        <label class="f">API Secret <span class="hint">솔라피</span><input type="text" name="kakao.api_secret" value="${v('kakao.api_secret')}"></label>
        <label class="f">발신 프로필 키 (pfId / senderkey)<input type="text" name="kakao.pf_id" value="${v('kakao.pf_id')}"></label>
        <label class="f">아이디 <span class="hint">알리고</span><input type="text" name="kakao.user_id" value="${v('kakao.user_id')}"></label>
        <label class="check full"><input type="checkbox" id="nosms" ${s['kakao.disable_sms'] === '1' ? 'checked' : ''}> 알림톡 실패 시 문자로 대체 발송하지 않기</label>
      </form>
      <div class="row" style="margin-top:10px"><input type="tel" id="kphone" placeholder="테스트 받을 번호" style="width:160px"><button class="btn" id="k-test">테스트 발송</button><span class="spacer"></span><button class="btn primary" data-save>저장</button></div>
    </div>

    <div class="card span2"><div class="card-head"><h2>랜딩페이지 · 구글 시트 · 외부 폼 연동</h2></div>
      <div class="form-grid">
        <label class="f">수신 주소 (POST, JSON 또는 form)<input type="text" readonly value="${esc(origin)}/webhooks/lead?key=${v('lead.api_key')}"></label>
        <label class="f">API 키<div class="row" style="flex-wrap:nowrap"><input type="text" readonly value="${v('lead.api_key')}"><button class="btn sm" data-gen="lead.api_key">재발급</button></div></label>
      </div>
      <div class="grid g2" style="margin-top:10px">
        <div><h3 style="margin-bottom:6px">외부 랜딩/폼에서 보내기</h3><pre>curl -X POST '${esc(origin)}/webhooks/lead?key=${v('lead.api_key')}' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"홍길동","phone":"010-1234-5678","업종":"음식점",
       "utm_campaign":"9월 이벤트","utm_content":"영상A"}'</pre></div>
        <div><h3 style="margin-bottom:6px">구글 폼/시트 (Apps Script, 폼 제출 트리거)</h3><pre>${esc(sheetScript)}</pre></div>
      </div>
    </div>

    <div class="card span2"><div class="card-head"><h2>업체 관리</h2><span class="muted small">업체별로 DB·직원·텔레그램 방이 분리됩니다</span></div>
      <div class="table-wrap"><table><thead><tr><th>업체명</th><th>등급</th><th>인원</th><th>텔레그램 채팅 ID</th><th class="r">DB</th><th class="r">계정</th><th>사용</th><th></th></tr></thead><tbody id="pb">
      ${S.partners.map((p) => `<tr data-id="${p.id}"><td><input type="text" name="name" value="${esc(p.name)}"></td>
        <td><select name="plan" style="width:auto">${['일반', '한비즈 고객사', '프리미엄 수강생', '수강생'].map((x) => `<option ${p.plan === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
        <td><input type="number" name="seats" value="${p.seats}" min="1" max="100" style="width:70px"></td>
        <td><input type="text" name="telegram_chat_id" value="${esc(p.telegram_chat_id || '')}"></td><td class="r num">${fmt(p.lead_count)}</td><td class="r num">${fmt(p.user_count)}</td>
        <td><input type="checkbox" name="active" ${p.active ? 'checked' : ''}></td><td><button class="btn sm" data-ps>저장</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:10px"><input type="text" id="pn" placeholder="새 업체 이름" style="max-width:260px"><button class="btn" id="padd">업체 추가</button></div>
    </div>
  </div>
  <div style="margin-top:14px">${await myPasswordCard()}</div>`;

  const saveAll = guard(async () => {
    const body = {};
    $$('[data-sec]', view).forEach((f) => Object.assign(body, formData(f)));
    body['kakao.disable_sms'] = $('#nosms', view).checked ? '1' : '0';
    await api('/settings', { method: 'PUT', body });
    toast('저장했습니다.');
    const me = await api('/me');
    S.companyName = me.companyName;
  });
  $$('[data-save]', view).forEach((b) => b.addEventListener('click', saveAll));
  $$('[data-gen]', view).forEach((b) => b.addEventListener('click', guard(async () => {
    if (b.dataset.gen === 'lead.api_key' && !confirm('키를 재발급하면 기존 연동 주소가 동작하지 않습니다. 계속할까요?')) return;
    await api('/settings/generate-key', { method: 'POST', body: { key: b.dataset.gen } });
    pageSettings(view);
  })));
  $$('input[readonly]', view).forEach((i) => i.addEventListener('click', () => { i.select(); navigator.clipboard.writeText(i.value); toast('복사했습니다.'); }));
  $('#tg-test', view).addEventListener('click', guard(async () => {
    await saveAll();
    const r = await api('/settings/test-telegram', { method: 'POST', body: {} });
    toast(r.status === 'sent' ? '전송했습니다. 텔레그램을 확인하세요.' : r.status === 'mock' ? '봇 토큰·채팅 ID가 없어 전송하지 않았습니다.' : `실패: ${r.response}`, r.status === 'failed');
  }));
  $('#find-chat', view).addEventListener('click', guard(async () => {
    await saveAll();
    const chats = await api('/settings/telegram-chats');
    $('#chats', view).innerHTML = chats.length ? `최근 대화한 방: ${chats.map((c) => `<code class="copy" data-c="${esc(c.id)}">${esc(c.name)} (${esc(c.id)})</code>`).join(' ')}` : '최근 메시지가 없습니다. 봇이 있는 방에서 메시지를 보낸 뒤 다시 눌러주세요.';
    $$('[data-c]', view).forEach((c) => c.addEventListener('click', () => {
      const i = $('[name="telegram.chat_ids"]', view);
      i.value = [i.value, c.dataset.c].filter(Boolean).join(',');
    }));
  }));
  $('#k-test', view).addEventListener('click', guard(async () => {
    const phone = $('#kphone', view).value;
    if (!phone) return toast('받을 번호를 입력하세요.', true);
    await saveAll();
    const r = await api('/settings/test-kakao', { method: 'POST', body: { phone } });
    toast(r.status === 'sent' ? '발송 요청했습니다.' : r.status === 'mock' ? '테스트 모드: 기록만 남겼습니다.' : `실패: ${String(r.response).slice(0, 80)}`, r.status === 'failed');
  }));
  $('#sim', view).addEventListener('click', simulateDialog);
  $('#connect-page', view).addEventListener('click', guard(async () => {
    await saveAll();
    const r = await api('/meta/connect-page', { method: 'POST', body: { page_id: $('[name="meta.page_id"]', view).value } });
    toast(`'${r.page}' 페이지의 리드가 이 CRM으로 들어오도록 연결했습니다.`);
    pageSettings(view);
  }));
  $('#whlog', view).addEventListener('click', guard(async () => {
    const rows = await api('/webhook-logs');
    modal(`<h2>웹훅 수신 기록</h2><div class="table-wrap"><table><thead><tr><th>시각</th><th>출처</th><th>결과</th><th>내용</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="small">${esc(r.created_at.slice(5, 19))}</td><td>${esc(r.source)}</td><td>${esc(r.result)}</td><td class="trunc small" title="${esc(r.payload)}">${esc((r.payload || '').slice(0, 80))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">기록 없음</td></tr>'}
      </tbody></table></div><div class="modal-foot"><button class="btn" data-close>닫기</button></div>`);
  }));
  $$('[data-ap]', view).forEach((b) => b.addEventListener('click', guard(async () => {
    const tr = b.closest('tr');
    await api(`/signups/${tr.dataset.id}/approve`, { method: 'POST', body: { plan: $('[name=plan]', tr).value } });
    toast('승인했습니다.');
    pageSettings(view);
  })));
  $$('[data-rj]', view).forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm('가입 신청을 거절(삭제)할까요?')) return;
    await api(`/signups/${b.closest('tr').dataset.id}/reject`, { method: 'POST' });
    pageSettings(view);
  })));
  $$('[data-ps]', view).forEach((b) => b.addEventListener('click', guard(async () => {
    const tr = b.closest('tr');
    await api(`/partners/${tr.dataset.id}`, { method: 'PUT', body: formData(tr) });
    toast('저장했습니다.');
  })));
  $('#padd', view).addEventListener('click', guard(async () => {
    const name = $('#pn', view).value.trim();
    if (!name) return;
    await api('/partners', { method: 'POST', body: { name } });
    pageSettings(view);
  }));
  bindPassword(view);
}

function simulateDialog() {
  modal(`<h2>테스트 리드 넣어보기</h2>
    <div class="notice">메타 웹훅으로 들어온 것과 똑같이 처리합니다: 캠페인 생성 → 업체 분배 → 담당자 배정 → 텔레그램 알림 → 접수 알림톡.</div>
    <form class="form-grid" id="tf">
      <label class="f">이름<input type="text" name="full_name" value="테스트 고객"></label>
      <label class="f">연락처<input type="tel" name="phone_number" value="010-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}"></label>
      <label class="f">업종<input type="text" name="업종" value="음식점"></label>
      <label class="f">성별/나이<div class="row" style="flex-wrap:nowrap"><select name="gender" style="width:auto"><option>여</option><option>남</option></select><input type="number" name="age" value="35"></div></label>
      <label class="f">캠페인<select name="campaign_name">${S.campaigns.filter((c) => c.platform === 'meta').map((c) => `<option>${esc(c.name)}</option>`).join('')}<option>테스트 캠페인</option></select></label>
      <label class="f">광고<input type="text" name="ad_name" value="테스트 광고"></label>
    </form>
    <div class="modal-foot"><button class="btn" data-close>닫기</button><button class="btn primary" id="ok">넣기</button></div>`, {
    onMount: (el, close) => $('#ok', el).addEventListener('click', guard(async () => {
      const b = formData($('#tf', el));
      const r = await api('/simulate/meta-lead', { method: 'POST', body: {
        field_data: [{ name: 'full_name', values: [b.full_name] }, { name: 'phone_number', values: [b.phone_number] }, { name: '업종', values: [b['업종']] }, { name: 'gender', values: [b.gender] }, { name: 'age', values: [b.age] }],
        campaign_name: b.campaign_name, ad_name: b.ad_name,
      } });
      close();
      toast('리드가 들어왔습니다.');
      setTimeout(() => openLead(r.id), 400);
    })),
  });
}

async function myPasswordCard() {
  return `<div class="card" style="max-width:520px"><div class="card-head"><h2>내 비밀번호 변경</h2></div>
    <form class="form-grid" id="pw"><label class="f">현재 비밀번호<input type="password" name="current"></label><label class="f">새 비밀번호<input type="password" name="next" minlength="6"></label></form>
    <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="pw-save">변경</button></div></div>`;
}
function bindPassword(view) {
  $('#pw-save', view).addEventListener('click', guard(async () => {
    await api('/me/password', { method: 'POST', body: formData($('#pw', view)) });
    toast('비밀번호를 바꿨습니다.');
    $('#pw', view).reset();
  }));
}

async function pageMySettings(view) {
  view.innerHTML = `<div class="page-head"><h1>설정</h1></div>
    <div class="card" style="max-width:520px;margin-bottom:14px"><dl class="kv"><dt>이름</dt><dd>${esc(S.me.name)}</dd><dt>아이디</dt><dd>${esc(S.me.username)}</dd><dt>권한</dt><dd>${ROLE[S.me.role]}</dd><dt>업체</dt><dd>${esc(S.me.partner_name || '-')}</dd></dl></div>
    ${await myPasswordCard()}
    <div class="card" style="max-width:520px;margin-top:14px"><div class="card-head"><h2>앱으로 설치</h2></div><p class="small muted" style="margin:0">휴대폰 브라우저 메뉴에서 <b>홈 화면에 추가</b>를 누르면 앱처럼 쓸 수 있습니다. (카카오톡 안에서 열었다면 크롬·사파리로 열어주세요.)</p>
    <button class="btn" id="install" style="margin-top:10px;display:none">지금 설치</button></div>`;
  bindPassword(view);
  if (window.__installPrompt) {
    const b = $('#install', view);
    b.style.display = '';
    b.addEventListener('click', () => window.__installPrompt.prompt());
  }
}

/* ───────── 라우터 ───────── */
const PAGES = { dashboard: pageDashboard, leads: pageLeads, ads: pageAds, landing: pageLanding, staff: pageStaff, kakao: pageKakao, logs: pageLogs, settings: pageSettings };

async function route() {
  destroyCharts();
  const h = location.hash.slice(2);
  const [path] = h.split('?');
  const [name, arg] = path.split('/');
  if (name === 'signup') return pageSignup();
  if (!S.me) return pageLogin();
  if (name === 'login') { location.hash = '#/dashboard'; return; }
  const key = PAGES[name] && NAV.find((n) => n[0] === name)[3]() ? name : 'dashboard';
  mountShell(key);
  try {
    await PAGES[key]($('#view'));
    if (name === 'leads' && arg) openLead(Number(arg));
  } catch (e) {
    $('#view').innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
  }
}

async function boot() {
  try {
    const me = await api('/me');
    S.me = me.user;
    S.statuses = me.statuses;
    S.companyName = me.companyName;
    document.title = '원탑 CRM';
    await loadRefs();
  } catch {
    S.me = null;
  }
}

(async () => {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* 저장 불가 */ }
  S.range = defaultRange();
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  await boot();
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = S.me ? '#/dashboard' : '#/login';
  else route();
})();
