const test = require('node:test');
const assert = require('node:assert');
const TL = require('../logic.js');

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
