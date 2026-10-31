// Logic thuần: tách từ, chấm bài, lịch ôn. Không đụng tới giao diện để test được bằng Node.
(function (root) {
  const DAY = 86400000;
  const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

  // Trả về chuỗi token xen kẽ: từ và phần ngăn cách (dấu câu, khoảng trắng, xuống dòng).
  function tokenize(text) {
    const value = String(text || '').normalize('NFC');
    const tokens = [];
    let last = 0;
    for (const match of value.matchAll(WORD)) {
      if (match.index > last) tokens.push({ type: 'sep', text: value.slice(last, match.index) });
      tokens.push({ type: 'word', text: match[0] });
      last = match.index + match[0].length;
    }
    if (last < value.length) tokens.push({ type: 'sep', text: value.slice(last) });
    return tokens;
  }

  function words(text) {
    return tokenize(text).filter((t) => t.type === 'word').map((t) => t.text);
  }

  function firstLetter(word) {
    return Array.from(word.normalize('NFC'))[0] || '';
  }

  function stripMarks(value) {
    return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  function normalizeWord(word, ignoreMarks) {
    const lower = word.normalize('NFC').toLocaleLowerCase('vi');
    return ignoreMarks ? stripMarks(lower) : lower;
  }

  // So từng từ bằng dãy con chung dài nhất. Trả về đúng/thiếu/thừa theo thứ tự bài gốc.
  function diffWords(original, attempt, options) {
    const ignoreMarks = Boolean(options && options.ignoreMarks);
    const a = words(original);
    const b = words(attempt);
    const na = a.map((w) => normalizeWord(w, ignoreMarks));
    const nb = b.map((w) => normalizeWord(w, ignoreMarks));

    let start = 0;
    while (start < na.length && start < nb.length && na[start] === nb[start]) start += 1;
    let endA = na.length;
    let endB = nb.length;
    while (endA > start && endB > start && na[endA - 1] === nb[endB - 1]) {
      endA -= 1;
      endB -= 1;
    }

    const rows = endA - start + 1;
    const cols = endB - start + 1;
    const table = Array.from({ length: rows }, () => new Uint16Array(cols));
    for (let i = rows - 2; i >= 0; i -= 1) {
      for (let j = cols - 2; j >= 0; j -= 1) {
        table[i][j] = na[start + i] === nb[start + j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    const parts = [];
    for (let i = 0; i < start; i += 1) parts.push({ kind: 'ok', text: a[i] });
    let i = 0;
    let j = 0;
    while (i < rows - 1 || j < cols - 1) {
      if (i < rows - 1 && j < cols - 1 && na[start + i] === nb[start + j]) {
        parts.push({ kind: 'ok', text: a[start + i] });
        i += 1;
        j += 1;
      } else if (j < cols - 1 && (i === rows - 1 || table[i][j + 1] > table[i + 1][j])) {
        parts.push({ kind: 'extra', text: b[start + j] });
        j += 1;
      } else {
        parts.push({ kind: 'missing', text: a[start + i] });
        i += 1;
      }
    }
    for (let k = endA; k < a.length; k += 1) parts.push({ kind: 'ok', text: a[k] });

    const correct = parts.filter((p) => p.kind === 'ok').length;
    const extra = parts.filter((p) => p.kind === 'extra').length;
    const missing = parts.filter((p) => p.kind === 'missing').length;
    const denominator = a.length + extra;
    return {
      parts,
      correct,
      extra,
      missing,
      total: a.length,
      score: denominator === 0 ? 0 : Math.round((correct / denominator) * 100),
    };
  }

  // Thứ tự che từ ổn định theo seed: tăng mức che chỉ che thêm, không xáo lại từ đã che.
  function hideOrder(count, seed) {
    const order = Array.from({ length: count }, (_, index) => index);
    let state = (seed >>> 0) || 1;
    for (let i = count - 1; i > 0; i -= 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  function newSrs(now) {
    return { reps: 0, interval: 0, ease: 2.5, due: now, lapses: 0, last: null };
  }

  // rating: 0 quên, 1 khó, 2 được, 3 dễ. Biến thể gọn của SM-2.
  function review(srs, rating, now) {
    const next = { ...srs, last: now };
    if (rating === 0) {
      next.reps = 0;
      next.interval = 0;
      next.lapses += 1;
      next.ease = Math.max(1.3, srs.ease - 0.2);
      next.due = now + 10 * 60000;
      return next;
    }
    if (rating === 1) {
      next.interval = Math.max(1, Math.round(srs.interval * 1.2));
      next.ease = Math.max(1.3, srs.ease - 0.15);
    } else if (rating === 2) {
      if (srs.reps === 0) next.interval = 1;
      else if (srs.reps === 1) next.interval = Math.max(3, srs.interval + 1);
      else next.interval = Math.max(srs.interval + 1, Math.round(srs.interval * srs.ease));
    } else {
      next.interval = Math.max(4, Math.round(Math.max(srs.interval, 1) * srs.ease * 1.3));
      next.ease = srs.ease + 0.15;
    }
    next.reps = srs.reps + 1;
    next.due = now + next.interval * DAY;
    return next;
  }

  function status(srs, now) {
    if (srs.last === null) return 'new';
    if (srs.due <= now) return 'due';
    return srs.interval >= 21 ? 'known' : 'learning';
  }

  function progress(srs) {
    return Math.min(100, Math.round((srs.interval / 21) * 100));
  }

  function dayKey(time) {
    const d = new Date(time);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Số ngày liên tiếp có ôn, tính tới hôm nay (hoặc hôm qua nếu hôm nay chưa ôn).
  function streak(days, now) {
    const set = new Set(days);
    let cursor = new Date(now);
    if (!set.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (set.has(dayKey(cursor.getTime()))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function isNum(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  // Làm sạch một bài lấy từ file sao lưu; trả null nếu không dùng được.
  function sanitizeItem(raw, now) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.text !== 'string' || !raw.text.trim()) return null;
    const base = newSrs(now);
    const s = raw.srs && typeof raw.srs === 'object' ? raw.srs : {};
    return {
      id: raw.id,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Không tên',
      text: raw.text,
      folder: typeof raw.folder === 'string' ? raw.folder.trim() : '',
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [],
      createdAt: isNum(raw.createdAt) ? raw.createdAt : now,
      updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : now,
      bestScore: isNum(raw.bestScore) ? raw.bestScore : null,
      stages: positiveCounts(raw.stages),
      missed: positiveCounts(raw.missed),
      srs: {
        reps: isNum(s.reps) ? s.reps : base.reps,
        interval: isNum(s.interval) ? s.interval : base.interval,
        ease: isNum(s.ease) ? s.ease : base.ease,
        due: isNum(s.due) ? s.due : base.due,
        lapses: isNum(s.lapses) ? s.lapses : base.lapses,
        last: isNum(s.last) ? s.last : null,
      },
    };
  }

  // Gộp bản sao lưu: trùng id thì giữ bản sửa sau cùng.
  function mergeItems(current, incoming) {
    const byId = new Map(current.map((item) => [item.id, item]));
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, item);
        added += 1;
      } else if (item.updatedAt > existing.updatedAt) {
        byId.set(item.id, item);
        updated += 1;
      }
    }
    return { items: Array.from(byId.values()), added, updated };
  }

  function positiveCounts(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    for (const [key, value] of Object.entries(raw)) {
      if (key !== '__proto__' && isNum(value) && value > 0) result[key] = Math.floor(value);
    }
    return result;
  }

  // Cắt một câu quá dài theo số từ, giữ nguyên chữ và dấu câu của bản gốc.
  function splitByWords(text, maxWords) {
    const parts = [];
    let buffer = '';
    let count = 0;
    for (const token of tokenize(text)) {
      if (token.type === 'word' && count === maxWords) {
        parts.push(buffer.trim());
        buffer = '';
        count = 0;
      }
      buffer += token.text;
      if (token.type === 'word') count += 1;
    }
    if (buffer.trim()) parts.push(buffer.trim());
    return parts;
  }

  function splitSentences(text) {
    const found = String(text).match(/[^.!?…;。]+[.!?…;。]*["”’)]*\s*/gu) || [];
    return found.map((part) => part.trim()).filter(Boolean);
  }

  // Chia bài thành các đoạn học được: tôn trọng dòng trống, gom dòng ngắn, cắt câu dài.
  function sections(text, maxWords) {
    const limit = maxWords || 30;
    const result = [];
    for (const paragraph of String(text || '').normalize('NFC').split(/\n\s*\n/)) {
      const units = [];
      for (const line of paragraph.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (words(line).length <= limit) {
          units.push({ text: line, joiner: '\n' });
          continue;
        }
        for (const sentence of splitSentences(line)) {
          const parts = words(sentence).length <= limit ? [sentence] : splitByWords(sentence, limit);
          parts.forEach((part) => units.push({ text: part, joiner: ' ' }));
        }
      }
      let buffer = '';
      let count = 0;
      for (const unit of units) {
        const size = words(unit.text).length;
        if (buffer && count + size > limit) {
          result.push(buffer);
          buffer = '';
          count = 0;
        }
        buffer = buffer ? buffer + unit.joiner + unit.text : unit.text;
        count += size;
      }
      if (buffer) result.push(buffer);
    }
    return result;
  }

  // Các mảnh để xếp lại: ưu tiên dòng, rồi tới câu, rồi tới vế ngăn bằng dấu phẩy.
  function pieces(text) {
    const value = String(text || '').normalize('NFC');
    const lines = value.split('\n').map((l) => l.trim()).filter((l) => words(l).length > 0);
    if (lines.length > 1) return lines;
    const sentences = splitSentences(value).filter((s) => words(s).length > 0);
    if (sentences.length > 1) return sentences;
    return value.split(/(?<=[,，、])\s*/u).map((p) => p.trim()).filter((p) => words(p).length > 0);
  }

  // Hoán vị chỉ số các mảnh; không trả lại đúng thứ tự gốc để trò chơi luôn có việc làm.
  function shuffledOrder(count, seed) {
    const order = hideOrder(count, seed);
    if (count > 1 && order.every((value, index) => value === index)) order.push(order.shift());
    return order;
  }

  // Chọn từ để làm chỗ trống, ưu tiên từ có từ hai ký tự trở lên.
  function pickBlanks(text, ratio, seed) {
    const list = words(text);
    const eligible = list.map((_, index) => index).filter((index) => Array.from(list[index]).length >= 2);
    const pool = eligible.length > 0 ? eligible : list.map((_, index) => index);
    if (pool.length === 0) return [];
    const wanted = Math.max(1, Math.round(pool.length * ratio));
    return hideOrder(pool.length, seed).slice(0, wanted).map((position) => pool[position]).sort((a, b) => a - b);
  }

  // Một đáp án đúng và tối đa ba từ nhiễu khác nhau, lấy từ chính bài đang học.
  function wordChoices(answer, pool, seed, size) {
    const wanted = (size || 4) - 1;
    const key = normalizeWord(answer);
    const seen = new Set([key]);
    const others = [];
    for (const index of hideOrder(pool.length, seed)) {
      const candidateKey = normalizeWord(pool[index]);
      if (seen.has(candidateKey)) continue;
      seen.add(candidateKey);
      others.push(pool[index]);
      if (others.length === wanted) break;
    }
    const all = [answer, ...others];
    return hideOrder(all.length, seed + 1).map((index) => all[index]);
  }

  function isRoleCaps(line) {
    return /\p{L}/u.test(line) && line === line.toLocaleUpperCase('vi') && words(line).length <= 4 && !/[.!?,;…]/.test(line);
  }

  // Đọc kịch bản dạng "TÊN: lời" hoặc tên viết hoa đứng riêng một dòng, lời ở dòng sau.
  function parseScript(text) {
    const entries = [];
    let role = '';
    for (const rawLine of String(text || '').normalize('NFC').split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const labelled = line.match(/^([^:：]{1,30})[:：]\s*(.*)$/u);
      if (labelled && words(labelled[1]).length <= 4 && words(labelled[1]).length > 0) {
        role = labelled[1].trim();
        if (labelled[2]) entries.push({ role, text: labelled[2] });
      } else if (isRoleCaps(line)) {
        role = line;
      } else if (role && entries.length > 0 && entries[entries.length - 1].role === role) {
        entries[entries.length - 1].text += `\n${line}`;
      } else {
        entries.push({ role, text: line });
      }
    }
    const counts = new Map();
    entries.forEach((entry) => {
      if (entry.role) counts.set(entry.role, (counts.get(entry.role) || 0) + 1);
    });
    const roles = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const labelledEntries = entries.filter((entry) => entry.role).length;
    return { entries, roles, isScript: roles.length >= 2 && labelledEntries >= 2 && labelledEntries / entries.length >= 0.6 };
  }

  // Cộng dồn từ hay quên theo dạng viết thường để gộp "Trăm" với "trăm".
  function addMissed(missed, list) {
    const result = { ...missed };
    for (const word of list) {
      const key = normalizeWord(word);
      if (key === '__proto__') continue;
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }

  function topMissed(items, limit) {
    const totals = new Map();
    for (const item of items) {
      for (const [word, count] of Object.entries(item.missed || {})) {
        const entry = totals.get(word) || { word, count: 0, titles: new Set() };
        entry.count += count;
        entry.titles.add(item.title);
        totals.set(word, entry);
      }
    }
    return [...totals.values()]
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'vi'))
      .slice(0, limit || 10)
      .map((entry) => ({ word: entry.word, count: entry.count, titles: [...entry.titles] }));
  }

  // Lưới các tuần gần nhất, tuần bắt đầu từ thứ Hai, cột cuối chứa hôm nay.
  function calendarWeeks(now, weekCount) {
    const today = new Date(now);
    today.setHours(12, 0, 0, 0);
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(today.getDate() - mondayOffset - 7 * (weekCount - 1));
    const todayKey = dayKey(today.getTime());
    const weeks = [];
    const cursor = new Date(start);
    for (let w = 0; w < weekCount; w += 1) {
      const week = [];
      for (let d = 0; d < 7; d += 1) {
        const key = dayKey(cursor.getTime());
        week.push({ key, future: cursor.getTime() > today.getTime(), today: key === todayKey });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  }

  // Bậc màu cho ô lịch: 0 là chưa ôn, 1–4 đậm dần theo số lượt trong ngày.
  function activityLevel(count) {
    if (!count) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 9) return 3;
    return 4;
  }

  // Gộp nhật ký khi nhập sao lưu: mỗi ngày giữ con số lớn hơn để không cộng trùng.
  function mergeLog(current, incoming) {
    const result = positiveCounts(current);
    for (const [key, value] of Object.entries(positiveCounts(incoming))) {
      result[key] = Math.max(result[key] || 0, value);
    }
    return result;
  }

  const api = {
    DAY, tokenize, words, firstLetter, stripMarks, diffWords, hideOrder,
    newSrs, review, status, progress, dayKey, streak, sanitizeItem, mergeItems,
    positiveCounts, sections, pieces, shuffledOrder, pickBlanks, wordChoices, parseScript,
    addMissed, topMissed, calendarWeeks, activityLevel, mergeLog,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
