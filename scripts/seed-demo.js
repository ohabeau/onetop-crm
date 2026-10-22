// 데모 데이터 생성: node scripts/seed-demo.js  (알림은 발송하지 않음)
require('../src/bootstrap').bootstrap();
const { db, tx } = require('../src/db');
const auth = require('../src/auth');
const leads = require('../src/services/leads');

if (db.prepare("SELECT 1 FROM partners WHERE name = '한빛상사(데모)'").get()) {
  console.log('이미 데모 데이터가 있습니다.');
  process.exit(0);
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

const LAST = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
const FIRST = ['민준', '서연', '도윤', '지우', '하준', '서윤', '은우', '지민', '현우', '수아', '준서', '하은', '영숙', '정호', '미경'];
const TYPES = ['제조업', '도소매', '음식점', 'IT/서비스', '건설업', '미용/뷰티'];
const REGIONS = ['서울', '경기', '대전', '부산', '대구', '인천', '광주'];

tx(() => {
  const p1 = Number(db.prepare("INSERT INTO partners(name, plan, seats) VALUES('한빛상사(데모)', '한비즈 고객사', 5)").run().lastInsertRowid);
  const p2 = Number(db.prepare("INSERT INTO partners(name, plan, seats) VALUES('청솔컨설팅(데모)', '일반', 3)").run().lastInsertRowid);
  const mkUser = (u, n, role, pid) => Number(db.prepare('INSERT INTO users(username, password_hash, name, role, partner_id, title) VALUES(?, ?, ?, ?, ?, ?)')
    .run(u, auth.hashPassword('demo1234'), n, role, pid, role === 'manager' ? '대표' : '직원').lastInsertRowid);
  mkUser('hanbit', '한빛 대표', 'manager', p1);
  const a1 = [mkUser('hanbit1', '김상담', 'agent', p1), mkUser('hanbit2', '이상담', 'agent', p1)];
  mkUser('cheongsol', '청솔 대표', 'manager', p2);
  const a2 = [mkUser('cheongsol1', '박상담', 'agent', p2)];

  const C = [
    { name: '[메타] 무료진단 신청 9월', platform: 'meta', p: p1, sets: ['30대 여성 · 수도권', '40대 자영업자'], ads: ['후기 영상 B', '카드뉴스 A'], daily: 90000, cpl: 11000 },
    { name: '[메타] 이벤트 리타겟', platform: 'meta', p: p1, sets: ['사이트 방문자 30일'], ads: ['혜택 이미지'], daily: 40000, cpl: 9000 },
    { name: '[구글] 검색 - 정책자금', platform: 'google', p: p1, sets: ['키워드 그룹 1'], ads: ['반응형 검색'], daily: 50000, cpl: 15000 },
    { name: '[네이버] 파워링크', platform: 'naver', p: p2, sets: ['브랜드 키워드'], ads: ['파워링크 A'], daily: 35000, cpl: 13500 },
    { name: '[카카오] 비즈보드', platform: 'kakao', p: p2, sets: ['관심사 타겟'], ads: ['비즈보드 배너'], daily: 30000, cpl: 12500 },
  ];
  const now = new Date();
  for (const c of C) {
    c.id = Number(db.prepare('INSERT INTO campaigns(name, platform, partner_id, external_id) VALUES(?, ?, ?, ?)')
      .run(c.name, c.platform, c.p, c.platform === 'meta' ? String(23850000000 + Math.floor(rnd() * 1e6)) : null).lastInsertRowid);
  }

  const lp1 = Number(db.prepare(`INSERT INTO landing_pages(partner_id, campaign_id, slug, title, headline, description, color, fields_json)
    VALUES(?, ?, 'free-check', '무료 진단 신청', '우리 회사도 받을 수 있을까?\n1분 무료 진단', '업종과 매출만 알려주시면\n전문가가 직접 가능 여부를 알려드립니다.', '#1d4ed8', ?)`)
    .run(p1, C[0].id, JSON.stringify([
      { key: 'name', label: '성함', type: 'text', required: true },
      { key: 'phone', label: '연락처', type: 'tel', required: true },
      { key: 'business_type', label: '업종', type: 'select', options: TYPES.join(',') },
      { key: 'gender', label: '성별', type: 'radio', options: '남,여' },
      { key: 'age_group', label: '연령대', type: 'select', options: '20대,30대,40대,50대,60대+' },
    ])).lastInsertRowid);
  const lp2 = Number(db.prepare(`INSERT INTO landing_pages(partner_id, slug, title, headline, color, fields_json)
    VALUES(?, 'event', '이벤트 신청', '이번 달 한정 상담 이벤트', '#ea580c', ?)`).run(p1, JSON.stringify([
      { key: 'name', label: '성함', type: 'text', required: true }, { key: 'phone', label: '연락처', type: 'tel', required: true }])).lastInsertRowid);
  const lp3 = Number(db.prepare(`INSERT INTO landing_pages(partner_id, slug, title, headline, color, fields_json)
    VALUES(?, 'consult', '상담 신청', '전문가 1:1 상담', '#059669', ?)`).run(p2, JSON.stringify([
      { key: 'name', label: '성함', type: 'text', required: true }, { key: 'phone', label: '연락처', type: 'tel', required: true }])).lastInsertRowid);

  const insStat = db.prepare('INSERT INTO ad_stats(campaign_id, adset_name, ad_name, date, spend, impressions, clicks) VALUES(?, ?, ?, ?, ?, ?, ?)');
  const insHit = db.prepare('INSERT INTO landing_hits(landing_id, date, views) VALUES(?, ?, ?)');
  const insLead = db.prepare(`INSERT INTO leads(name, phone, business_type, region, annual_revenue, desired_amount, gender, age_group, extra_json, source, landing_id,
      campaign_id, ad_name, adset_name, form_name, partner_id, assignee_id, status, sale_amount, first_contact_at, callback_at, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  for (let d = 29; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400e3);
    const date = kst(day).slice(0, 10);
    insHit.run(lp1, date, 60 + Math.floor(rnd() * 60));
    insHit.run(lp2, date, 20 + Math.floor(rnd() * 25));
    insHit.run(lp3, date, 10 + Math.floor(rnd() * 15));
    for (const c of C) {
      const combos = c.sets.flatMap((s) => c.ads.map((a) => [s, a]));
      for (const [i, [set, ad]] of combos.entries()) {
        const factor = 1 + (i === 0 ? -0.2 : 0.25 * i);
        const spend = Math.round((c.daily / combos.length) * (0.7 + rnd() * 0.6));
        const impressions = Math.round(spend / (6 + rnd() * 4));
        insStat.run(c.id, set, ad, date, spend, impressions, Math.round(impressions * (0.008 + rnd() * 0.012)));
        const expected = spend / (c.cpl * factor);
        const n = Math.floor(expected + rnd());
        for (let k = 0; k < n; k++) {
          const t = new Date(day.getTime());
          t.setUTCHours(0, 0, 0, 0);
          const hour = pick([9, 10, 11, 12, 13, 14, 15, 19, 20, 21, 22, 22, 23]) - 9;
          const created = new Date(t.getTime() + hour * 3600e3 + Math.floor(rnd() * 3600e3));
          if (created > now) continue;
          const age = d <= 1 ? rnd() : 1;
          const r = rnd();
          let status = '신규';
          if (age > 0.3) status = r < 0.12 ? '구매완료' : r < 0.15 ? '재구매' : r < 0.3 ? '상담중' : r < 0.42 ? '부재1차' : r < 0.5 ? '부재2차' : r < 0.6 ? '예약완료' : r < 0.7 ? '보류' : r < 0.8 ? '허수' : r < 0.9 ? '상담중' : '신규';
          const buyer = status === '구매완료' || status === '재구매';
          const gender = buyer ? (rnd() < 0.7 ? '여' : '남') : status === '허수' ? (rnd() < 0.65 ? '남' : '여') : pick(['남', '여']);
          const ageGroup = buyer ? pick(['30대', '30대', '40대', '40대', '50대']) : status === '허수' ? pick(['20대', '20대', '50대', '60대+']) : pick(['20대', '30대', '40대', '50대', '60대+']);
          const agents = c.p === p1 ? a1 : a2;
          const contact = status !== '신규' ? kst(new Date(created.getTime() + (2 + rnd() * 90) * 60e3)) : null;
          const landing = c.platform === 'meta' && rnd() < 0.5 ? null : c.p === p1 ? (c.platform === 'meta' ? lp2 : lp1) : lp3;
          insLead.run(pick(LAST) + pick(FIRST), `010-${String(1000 + Math.floor(rnd() * 9000))}-${String(1000 + Math.floor(rnd() * 9000))}`,
            pick(TYPES), pick(REGIONS), pick(['1억 미만', '1~5억', '5~10억', '10억 이상']), pick(['5천만원', '1억', '2억', '3억 이상']),
            gender, ageGroup, c.platform, landing, c.id, ad, set, landing ? null : '인스턴트 양식', c.p, pick(agents), status,
            buyer ? pick([150000, 200000, 250000, 300000, 400000]) : 0, contact,
            status === '예약완료' ? kst(new Date(now.getTime() + (rnd() * 3 - 1) * 86400e3)).slice(0, 16) : null, kst(created), kst(created));
        }
      }
    }
  }
  // 활동 이력 일부
  const some = db.prepare("SELECT id, status, assignee_id FROM leads WHERE status != '신규' ORDER BY RANDOM() LIMIT 80").all();
  for (const l of some) {
    leads.logActivity(l.id, l.assignee_id, 'status', `상태 변경: 신규 → ${l.status}`);
    if (rnd() < 0.5) leads.logActivity(l.id, l.assignee_id, 'memo', pick(['오후에 다시 통화 원함', '서류 안내 완료', '가격 문의, 견적 발송', '배우자와 상의 후 연락 준다고 함']));
  }
});

console.log('데모 데이터 생성 완료. 업체 관리자: hanbit / demo1234, 상담원: hanbit1 / demo1234');
