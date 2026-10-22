const crypto = require('crypto');
const { getSetting } = require('../db');

const GRAPH = 'https://graph.facebook.com/v21.0';

// X-Hub-Signature-256 검증 (앱 시크릿이 설정된 경우에만)
function verifySignature(rawBody, header) {
  const secret = getSetting('meta.app_secret');
  if (!secret) return true;
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function graphGet(pathAndQuery, token) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const r = await fetch(`${GRAPH}/${pathAndQuery}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await r.json();
  if (!r.ok || body.error) throw new Error(body.error ? body.error.message : `HTTP ${r.status}`);
  return body;
}

// leadgen_id 로 실제 리드 응답(field_data)과 광고 정보를 가져온다.
async function fetchLead(leadgenId) {
  const token = getSetting('meta.page_access_token');
  if (!token) return null;
  return graphGet(`${leadgenId}?fields=created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform`, token);
}

async function fetchFormName(formId) {
  const token = getSetting('meta.page_access_token');
  if (!token || !formId) return null;
  try { return (await graphGet(`${formId}?fields=name`, token)).name; } catch { return null; }
}

// 광고 계정의 캠페인별 일자 성과 (지출, 노출, 클릭)
async function fetchInsights(since, until) {
  const token = getSetting('meta.ads_access_token');
  let account = getSetting('meta.ad_account_id');
  if (!token || !account) return null;
  if (!account.startsWith('act_')) account = `act_${account}`;
  const out = [];
  let next = `${account}/insights?level=ad&time_increment=1&fields=campaign_id,campaign_name,adset_name,ad_name,spend,impressions,clicks&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=500`;
  while (next) {
    const body = next.startsWith('http')
      ? await (await fetch(next)).json()
      : await graphGet(next, token);
    if (body.error) throw new Error(body.error.message);
    out.push(...(body.data || []));
    next = body.paging && body.paging.next ? body.paging.next : null;
  }
  return out;
}

// 페이지를 이 앱의 leadgen 웹훅에 구독시킨다. 페이지 토큰이 없으면 광고 API 토큰(시스템 사용자)으로 받아온다.
async function connectPage(pageId) {
  let pageToken = getSetting('meta.page_access_token');
  if (!pageToken) {
    const userToken = getSetting('meta.ads_access_token');
    if (!userToken) throw new Error('페이지 액세스 토큰 또는 광고 API 토큰이 필요합니다.');
    pageToken = (await graphGet(`${pageId}?fields=access_token,name`, userToken)).access_token;
    if (!pageToken) throw new Error('이 토큰으로는 페이지 토큰을 받을 수 없습니다. 페이지 권한을 확인하세요.');
  }
  const r = await fetch(`${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(pageToken)}`, { method: 'POST' });
  const body = await r.json();
  if (!r.ok || body.error) throw new Error(body.error ? body.error.message : `HTTP ${r.status}`);
  const page = await graphGet(`${pageId}?fields=name`, pageToken);
  return { pageToken, pageName: page.name };
}

module.exports = { verifySignature, fetchLead, fetchFormName, fetchInsights, connectPage };
