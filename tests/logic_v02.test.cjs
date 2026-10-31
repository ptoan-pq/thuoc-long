const test = require('node:test');
const assert = require('node:assert');
const TL = require('../logic_v02.js');

const NOW = new Date(2026, 9, 31, 12).getTime();

test('tách từ giữ nguyên dấu tiếng Việt và ghép lại đúng bản gốc', () => {
  const text = 'Trăm năm trong cõi người ta,\nChữ tài chữ mệnh!';
  assert.deepStrictEqual(TL.words(text), ['Trăm', 'năm', 'trong', 'cõi', 'người', 'ta', 'Chữ', 'tài', 'chữ', 'mệnh']);
  assert.strictEqual(TL.tokenize(text).map((t) => t.text).join(''), text);
});

test('chữ đầu lấy đúng ký tự có dấu, kể cả chuỗi dạng NFD', () => {
  assert.strictEqual(TL.firstLetter('Đức'), 'Đ');
  assert.strictEqual(TL.firstLetter('ắt'.normalize('NFD')), 'ắ');
});

test('chấm bài: khớp hoàn toàn, bỏ qua hoa thường và dấu câu', () => {
  const r = TL.diffWords('Trăm năm, trong cõi.', 'trăm năm trong cõi');
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.missing, 0);
});

test('chấm bài: phát hiện từ thiếu và từ thừa', () => {
  const r = TL.diffWords('một hai ba bốn', 'một ba bốn năm');
  assert.strictEqual(r.correct, 3);
  assert.strictEqual(r.missing, 1);
  assert.strictEqual(r.extra, 1);
  assert.strictEqual(r.score, 60);
  assert.deepStrictEqual(r.parts.map((p) => p.kind), ['ok', 'missing', 'ok', 'ok', 'extra']);
});

test('chấm bài: tùy chọn bỏ qua dấu', () => {
  assert.strictEqual(TL.diffWords('Đức Phật', 'duc phat').score, 0);
  assert.strictEqual(TL.diffWords('Đức Phật', 'duc phat', { ignoreMarks: true }).score, 100);
});

test('chấm bài: bài làm rỗng được 0 điểm và không lỗi', () => {
  const r = TL.diffWords('một hai', '');
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.missing, 2);
});

test('thứ tự che ổn định và là hoán vị đầy đủ', () => {
  const order = TL.hideOrder(50, 7);
  assert.deepStrictEqual(order, TL.hideOrder(50, 7));
  assert.deepStrictEqual([...order].sort((x, y) => x - y), Array.from({ length: 50 }, (_, i) => i));
});

test('lịch ôn: khoảng cách tăng dần khi nhớ tốt', () => {
  let s = TL.newSrs(NOW);
  s = TL.review(s, 2, NOW);
  assert.strictEqual(s.interval, 1);
  s = TL.review(s, 2, NOW);
  assert.strictEqual(s.interval, 3);
  s = TL.review(s, 2, NOW);
  assert.strictEqual(s.interval, 8);
  assert.strictEqual(s.due, NOW + 8 * TL.DAY);
});

test('lịch ôn: quên thì về đầu và ôn lại sau 10 phút', () => {
  let s = TL.review(TL.review(TL.newSrs(NOW), 2, NOW), 2, NOW);
  s = TL.review(s, 0, NOW);
  assert.strictEqual(s.reps, 0);
  assert.strictEqual(s.interval, 0);
  assert.strictEqual(s.lapses, 1);
  assert.strictEqual(s.due, NOW + 600000);
});

test('lịch ôn: hệ số dễ không xuống dưới 1.3', () => {
  let s = TL.newSrs(NOW);
  for (let i = 0; i < 20; i += 1) s = TL.review(s, 0, NOW);
  assert.strictEqual(s.ease, 1.3);
});

test('trạng thái bài', () => {
  const fresh = TL.newSrs(NOW);
  assert.strictEqual(TL.status(fresh, NOW), 'new');
  const learned = TL.review(fresh, 2, NOW);
  assert.strictEqual(TL.status(learned, NOW), 'learning');
  assert.strictEqual(TL.status(learned, NOW + 2 * TL.DAY), 'due');
  assert.strictEqual(TL.status({ ...learned, interval: 30, due: NOW + TL.DAY }, NOW), 'known');
});

test('chuỗi ngày tính cả khi hôm nay chưa ôn và đứt khi có ngày trống', () => {
  const day = (n) => TL.dayKey(new Date(2026, 9, 31 - n, 12).getTime());
  assert.strictEqual(TL.streak([day(0), day(1), day(2)], NOW), 3);
  assert.strictEqual(TL.streak([day(1), day(2)], NOW), 2);
  assert.strictEqual(TL.streak([day(0), day(2)], NOW), 1);
  assert.strictEqual(TL.streak([], NOW), 0);
});

test('làm sạch file sao lưu: loại bài hỏng, vá trường thiếu', () => {
  assert.strictEqual(TL.sanitizeItem({ id: 'a', text: '   ' }, NOW), null);
  assert.strictEqual(TL.sanitizeItem(null, NOW), null);
  const item = TL.sanitizeItem({ id: 'a', text: 'x', tags: ['kinh', 3, ' '], srs: { interval: 'sai' } }, NOW);
  assert.deepStrictEqual(item.tags, ['kinh']);
  assert.strictEqual(item.srs.interval, 0);
  assert.strictEqual(item.title, 'Không tên');
});

test('gộp sao lưu giữ bản sửa sau cùng', () => {
  const merged = TL.mergeItems(
    [{ id: 'a', updatedAt: 5, title: 'cũ' }, { id: 'b', updatedAt: 9, title: 'giữ' }],
    [{ id: 'a', updatedAt: 6, title: 'mới' }, { id: 'b', updatedAt: 1, title: 'cũ' }, { id: 'c', updatedAt: 1, title: 'thêm' }],
  );
  assert.strictEqual(merged.added, 1);
  assert.strictEqual(merged.updated, 1);
  assert.strictEqual(merged.items.find((i) => i.id === 'a').title, 'mới');
  assert.strictEqual(merged.items.find((i) => i.id === 'b').title, 'giữ');
});

const POEM = 'Trăm năm trong cõi người ta,\nChữ tài chữ mệnh khéo là ghét nhau.\nTrải qua một cuộc bể dâu,\nNhững điều trông thấy mà đau đớn lòng.';

test('chia đoạn: gom dòng ngắn, không mất từ nào', () => {
  const parts = TL.sections(POEM, 14);
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].split('\n').length, 2);
  assert.deepStrictEqual(parts.flatMap((p) => TL.words(p)), TL.words(POEM));
});

test('chia đoạn: dòng trống luôn ngắt đoạn', () => {
  assert.deepStrictEqual(TL.sections('một hai\n\nba bốn', 30), ['một hai', 'ba bốn']);
});

test('chia đoạn: một đoạn văn dài không dấu câu vẫn được cắt và đủ từ', () => {
  const long = Array.from({ length: 95 }, (_, i) => `từ${i}`).join(' ');
  const parts = TL.sections(long, 30);
  assert.ok(parts.length >= 4);
  assert.ok(parts.every((p) => TL.words(p).length <= 30));
  assert.deepStrictEqual(parts.flatMap((p) => TL.words(p)), TL.words(long));
});

test('mảnh để xếp: theo dòng, rồi câu, rồi vế', () => {
  assert.strictEqual(TL.pieces(POEM).length, 4);
  assert.deepStrictEqual(TL.pieces('Câu một. Câu hai!'), ['Câu một.', 'Câu hai!']);
  assert.deepStrictEqual(TL.pieces('vế một, vế hai'), ['vế một,', 'vế hai']);
  assert.deepStrictEqual(TL.pieces('một mảnh'), ['một mảnh']);
});

test('xáo mảnh không bao giờ giữ nguyên thứ tự gốc', () => {
  for (let seed = 1; seed < 300; seed += 1) {
    const order = TL.shuffledOrder(2, seed);
    assert.notDeepStrictEqual(order, [0, 1]);
    assert.deepStrictEqual([...order].sort(), [0, 1]);
  }
});

test('chọn chỗ trống: tăng dần, ưu tiên từ dài, luôn có ít nhất một', () => {
  const blanks = TL.pickBlanks('a bb cc dd ee', 0.5, 3);
  assert.deepStrictEqual(blanks, [...blanks].sort((x, y) => x - y));
  assert.ok(blanks.every((index) => index !== 0));
  assert.strictEqual(TL.pickBlanks('a', 0.1, 1).length, 1);
  assert.deepStrictEqual(TL.pickBlanks('', 0.5, 1), []);
});

test('phương án trả lời: có đáp án, không trùng, đủ khi bài ít từ', () => {
  const pool = TL.words(POEM);
  const choices = TL.wordChoices('mệnh', pool, 9);
  assert.strictEqual(choices.length, 4);
  assert.ok(choices.includes('mệnh'));
  assert.strictEqual(new Set(choices.map((c) => c.toLowerCase())).size, 4);
  assert.deepStrictEqual(TL.wordChoices('một', ['một', 'Một'], 2), ['một']);
});

test('kịch bản dạng TÊN: lời', () => {
  const s = TL.parseScript('AN: Chào bạn.\nBÌNH: Chào An.\nAN: Khỏe không?\nvẫn nói tiếp');
  assert.ok(s.isScript);
  assert.deepStrictEqual(s.roles, ['AN', 'BÌNH']);
  assert.strictEqual(s.entries.length, 3);
  assert.strictEqual(s.entries[2].text, 'Khỏe không?\nvẫn nói tiếp');
});

test('kịch bản dạng tên viết hoa riêng dòng', () => {
  const s = TL.parseScript('AN\nChào bạn.\nBÌNH\nChào An.');
  assert.ok(s.isScript);
  assert.deepStrictEqual(s.entries.map((e) => e.role), ['AN', 'BÌNH']);
});

test('bài thơ thường không bị nhận nhầm là kịch bản', () => {
  assert.strictEqual(TL.parseScript(POEM).isScript, false);
});

test('từ hay quên gộp hoa thường và xếp theo số lần', () => {
  const a = { title: 'A', missed: TL.addMissed({}, ['Trăm', 'trăm', 'năm']) };
  const b = { title: 'B', missed: TL.addMissed({}, ['năm', 'năm']) };
  const top = TL.topMissed([a, b], 5);
  assert.strictEqual(top[0].word, 'năm');
  assert.strictEqual(top[0].count, 3);
  assert.deepStrictEqual(top[0].titles, ['A', 'B']);
  assert.strictEqual(top[1].count, 2);
});

test('lưới lịch: đủ tuần, bắt đầu thứ Hai, đúng ô hôm nay và ngày tương lai', () => {
  const now = new Date(2026, 9, 31, 12).getTime(); // Thứ Bảy
  const weeks = TL.calendarWeeks(now, 12);
  assert.strictEqual(weeks.length, 12);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.strictEqual(new Date(`${weeks[0][0].key}T12:00`).getDay(), 1);
  const last = weeks[11];
  assert.strictEqual(last[5].key, '2026-10-31');
  assert.ok(last[5].today);
  assert.ok(!last[5].future);
  assert.ok(last[6].future);
});

test('bậc hoạt động và gộp nhật ký', () => {
  assert.deepStrictEqual([0, 1, 3, 6, 10].map(TL.activityLevel), [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(TL.mergeLog({ a: 2, b: 5 }, { a: 4, b: 1, c: -1 }), { a: 4, b: 5 });
});

test('bản sao lưu v01 không có stages vẫn nạp được, trường lạ bị loại', () => {
  const old = TL.sanitizeItem({ id: 'x', text: 'một hai' }, 1);
  assert.deepStrictEqual(old.stages, {});
  assert.deepStrictEqual(old.missed, {});
  const bad = TL.sanitizeItem({ id: 'x', text: 'y', stages: { all: 3, b: 'sai', c: -2 }, missed: [1] }, 1);
  assert.deepStrictEqual(bad.stages, { all: 3 });
  assert.deepStrictEqual(bad.missed, {});
});
