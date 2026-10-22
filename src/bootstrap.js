const crypto = require('crypto');
const { db, getSetting, setSetting } = require('./db');
const auth = require('./auth');

// 첫 실행 시 운영자 계정, 기본 알림톡 템플릿, 키 생성
function bootstrap() {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin1234';
    db.prepare("INSERT INTO users(username, password_hash, name, role) VALUES(?, ?, '운영자', 'admin')").run(username, auth.hashPassword(password));
    console.log(`[bootstrap] 운영자 계정 생성: ${username} / ${process.env.ADMIN_PASSWORD ? '(환경변수 비밀번호)' : password}`);
  }
  if (!getSetting('lead.api_key')) setSetting('lead.api_key', crypto.randomBytes(18).toString('base64url'));
  if (!getSetting('meta.verify_token')) setSetting('meta.verify_token', crypto.randomBytes(12).toString('base64url'));
  if (!db.prepare('SELECT 1 FROM kakao_templates LIMIT 1').get()) {
    const T = [
      ['WELCOME_01', 'DB 접수 완료', '안녕하세요 #{이름}님, #{업체명}입니다.\n상담 신청이 정상 접수되었습니다.\n\n담당자가 순서대로 빠르게 연락드리겠습니다.\n문의: #{회사대표번호}', 'lead_created', null, 0],
      ['ABSENT_01', '1차 부재 안내', '#{이름}님, #{업체명}입니다.\n신청하신 상담 건으로 연락드렸으나 통화가 어려우셨습니다.\n편하신 시간에 #{회사대표번호} 로 연락 주시면 바로 안내드리겠습니다.', 'status_change', '부재1차', 0],
      ['ABSENT_02', '2차 부재 안내', '#{이름}님, 다시 한 번 연락드렸으나 부재중이셨습니다.\n상담을 원하시면 #{회사대표번호} 로 회신 부탁드립니다.\n회신이 없으시면 신청이 자동 종료될 수 있습니다.', 'status_change', '부재2차', 0],
      ['RESERVE_01', '예약 완료 안내', '#{이름}님, 상담 예약이 완료되었습니다.\n\n■ 일시: #{콜백일시}\n■ 담당: #{담당자}\n\n변경이 필요하시면 #{회사대표번호} 로 연락 주세요.', 'status_change', '예약완료', 0],
      ['PURCHASE_01', '구매 완료 감사', '#{이름}님, #{업체명}을 선택해 주셔서 감사합니다.\n결제(계약)가 정상 완료되었습니다.\n\n■ 금액: #{구매금액}원\n\n궁금하신 점은 언제든 #{회사대표번호} 로 문의해 주세요.', 'status_change', '구매완료', 0],
      ['REBUY_01', '재구매 안내', '#{이름}님, 지난번 이용해 주셔서 감사합니다.\n재구매 고객님께만 드리는 혜택을 준비했습니다.\n#{회사대표번호} 로 문의 주세요.', 'status_change', '구매완료', 43200],
    ];
    const ins = db.prepare('INSERT INTO kakao_templates(code, name, content, trigger_type, trigger_value, delay_minutes) VALUES(?, ?, ?, ?, ?, ?)');
    T.forEach((t) => ins.run(...t));
  }
}

module.exports = { bootstrap };
