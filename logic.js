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

  const api = {
    DAY, tokenize, words, firstLetter, stripMarks, diffWords, hideOrder,
    newSrs, review, status, progress, dayKey, streak, sanitizeItem, mergeItems,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
