const { getSetting } = require('../db');

// Telegram Bot API 어댑터. 봇 토큰이 없으면 mock 으로 동작한다.
async function sendMessage(chatId, text) {
  const token = getSetting('telegram.bot_token');
  if (!token || !chatId) {
    return { status: 'mock', provider: 'mock', response: '봇 토큰 또는 채팅 ID 미설정 - 전송 생략' };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const body = await r.text();
    return { status: r.ok ? 'sent' : 'failed', provider: 'telegram', response: body.slice(0, 1000) };
  } catch (e) {
    return { status: 'failed', provider: 'telegram', response: String(e.message || e) };
  }
}

module.exports = { sendMessage };
