const crypto = require('crypto');
const { getSetting } = require('../db');

// 카카오 알림톡 어댑터. 알림톡은 카카오 공식 딜러사(솔라피, 알리고 등) API 로 발송한다.
// kakao.provider: mock | solapi | aligo

function normalizePhone(p) {
  return String(p || '').replace(/[^0-9]/g, '');
}

function solapiAuth() {
  const apiKey = getSetting('kakao.api_key');
  const apiSecret = getSetting('kakao.api_secret');
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 솔라피에 등록된 알림톡 템플릿 목록 (검수 상태 포함)
async function listSolapiTemplates() {
  if (!getSetting('kakao.api_key') || !getSetting('kakao.api_secret')) throw new Error('솔라피 API Key와 Secret을 먼저 저장하세요.');
  const out = [];
  let startKey = '';
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ limit: '100', ...(startKey ? { startKey } : {}) });
    const r = await fetch(`https://api.solapi.com/kakao/v2/templates?${q}`, { headers: { Authorization: solapiAuth() } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.errorMessage || body.message || `솔라피 응답 오류 (${r.status})`);
    out.push(...(body.templateList || body.list || []));
    if (!body.nextKey || body.nextKey === startKey) break;
    startKey = body.nextKey;
  }
  return out;
}

async function sendSolapi({ to, templateCode, text, buttons }) {
  const pfId = getSetting('kakao.pf_id');
  const from = normalizePhone(getSetting('kakao.sender_phone'));
  const message = {
    to, from, text,
    kakaoOptions: { pfId, templateId: templateCode, disableSms: getSetting('kakao.disable_sms') === '1' },
  };
  if (buttons && buttons.length) message.kakaoOptions.buttons = buttons;
  const r = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: solapiAuth(),
    },
    body: JSON.stringify({ messages: [message] }),
  });
  const body = await r.text();
  return { status: r.ok ? 'sent' : 'failed', provider: 'solapi', response: body.slice(0, 1000) };
}

async function sendAligo({ to, templateCode, text, buttons, subject }) {
  const form = new URLSearchParams({
    apikey: getSetting('kakao.api_key'),
    userid: getSetting('kakao.user_id'),
    senderkey: getSetting('kakao.pf_id'),
    tpl_code: templateCode,
    sender: normalizePhone(getSetting('kakao.sender_phone')),
    receiver_1: to,
    subject_1: subject || '알림',
    message_1: text,
  });
  if (buttons && buttons.length) form.set('button_1', JSON.stringify({ button: buttons }));
  if (getSetting('kakao.disable_sms') !== '1') {
    form.set('failover', 'Y');
    form.set('fmessage_1', text);
  }
  const r = await fetch('https://kakaoapi.aligo.in/akv10/alimtalk/send/', { method: 'POST', body: form });
  const body = await r.text();
  let ok = r.ok;
  try { ok = ok && JSON.parse(body).code === 0; } catch { /* keep http status */ }
  return { status: ok ? 'sent' : 'failed', provider: 'aligo', response: body.slice(0, 1000) };
}

async function sendAlimtalk({ to, templateCode, text, buttons, subject }) {
  const provider = getSetting('kakao.provider', 'mock');
  const phone = normalizePhone(to);
  if (!phone) return { status: 'failed', provider, response: '수신 번호 없음' };
  if (provider === 'mock' || !getSetting('kakao.api_key')) {
    return { status: 'mock', provider: 'mock', response: 'API 키 미설정 - 실제 발송 없이 기록만 남김' };
  }
  try {
    if (provider === 'solapi') return await sendSolapi({ to: phone, templateCode, text, buttons });
    if (provider === 'aligo') return await sendAligo({ to: phone, templateCode, text, buttons, subject });
    return { status: 'failed', provider, response: `알 수 없는 provider: ${provider}` };
  } catch (e) {
    return { status: 'failed', provider, response: String(e.message || e) };
  }
}

module.exports = { sendAlimtalk, normalizePhone, listSolapiTemplates };
