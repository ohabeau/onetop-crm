const path = require('path');
const express = require('express');
const { bootstrap } = require('./bootstrap');
const auth = require('./auth');
const leads = require('./services/leads');

bootstrap();

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// Meta 서명 검증을 위해 원본 본문 보관
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(auth.loadUser);

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/webhooks', require('./routes/webhooks'));
app.use(require('./routes/public'));
app.use('/api', require('./routes/api'));
app.use('/vendor/chart.umd.js', (_req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '서버 오류' });
});

// 지연 알림톡 처리
setInterval(() => leads.processScheduled(), 60 * 1000).unref();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`원탑(One TOP) CRM 실행 중: http://localhost:${port}`));
