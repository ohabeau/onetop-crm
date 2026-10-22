const express = require('express');
const { db, getSetting } = require('../db');
const meta = require('../adapters/meta');
const leads = require('../services/leads');

const router = express.Router();

function logWebhook(source, payload, result) {
  db.prepare('INSERT INTO webhook_logs(source, payload, result) VALUES(?, ?, ?)')
    .run(source, typeof payload === 'string' ? payload.slice(0, 20000) : JSON.stringify(payload).slice(0, 20000), result);
}

// Meta 웹훅 구독 검증 (앱 대시보드 > Webhooks > Page > leadgen)
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === getSetting('meta.verify_token')) {
    logWebhook('meta', req.query, 'verify ok');
    return res.status(200).send(challenge);
  }
  logWebhook('meta', req.query, 'verify failed');
  res.sendStatus(403);
});

// Meta leadgen 이벤트 수신
router.post('/meta', async (req, res) => {
  if (!meta.verifySignature(req.rawBody || '', req.headers['x-hub-signature-256'])) {
    logWebhook('meta', req.rawBody || '', 'invalid signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // Meta 는 빠른 200 응답을 요구한다
  const body = req.body || {};
  const results = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const v = change.value || {};
      try {
        let detail = null;
        try { detail = await meta.fetchLead(v.leadgen_id); } catch (e) { results.push(`graph error: ${e.message}`); }
        // 토큰이 없거나 조회 실패 시: 테스트 페이로드에 field_data 가 함께 오는 경우 그대로 사용
        const fieldData = (detail && detail.field_data) || v.field_data || [];
        const mapped = leads.mapFields(fieldData);
        const formName = (detail && detail.form_name) || v.form_name || await meta.fetchFormName(v.form_id);
        const { lead, created } = await leads.createLead({
          ...mapped,
          source: 'meta',
          meta_lead_id: v.leadgen_id,
          campaign: {
            external_id: (detail && detail.campaign_id) || v.campaign_id,
            name: (detail && detail.campaign_name) || v.campaign_name,
          },
          ad_name: (detail && detail.ad_name) || v.ad_name || v.ad_id,
          adset_name: (detail && detail.adset_name) || v.adset_name || v.adgroup_id,
          form_name: formName || v.form_id,
        });
        results.push(`${created ? 'created' : 'exists'} #${lead.id}`);
      } catch (e) {
        results.push(`error: ${e.message}`);
      }
    }
  }
  logWebhook('meta', body, results.join('; ') || 'no leadgen changes');
});

// 랜딩페이지/외부 폼 수신: POST /webhooks/lead?key=API_KEY  (JSON 또는 form-urlencoded)
router.post('/lead', async (req, res) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (!key || key !== getSetting('lead.api_key')) {
    logWebhook('landing', req.body, 'invalid key');
    return res.status(401).json({ error: 'invalid api key' });
  }
  const b = { ...req.body };
  const known = ['campaign', 'campaign_id', 'utm_campaign', 'ad_name', 'utm_content', 'adset_name', 'utm_term', 'form_name', 'partner_id'];
  const fields = {};
  for (const [k, v] of Object.entries(b)) if (!known.includes(k)) fields[k] = v;
  const mapped = leads.mapFields(fields);
  try {
    const { lead } = await leads.createLead({
      ...mapped,
      source: 'landing',
      campaign: { name: b.campaign || b.utm_campaign || '랜딩페이지', external_id: b.campaign_id || null },
      ad_name: b.ad_name || b.utm_content,
      adset_name: b.adset_name || b.utm_term,
      form_name: b.form_name,
      partner_id: b.partner_id ? Number(b.partner_id) : null,
    });
    logWebhook('landing', b, `created #${lead.id}`);
    res.json({ ok: true, id: lead.id });
  } catch (e) {
    logWebhook('landing', b, `error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
