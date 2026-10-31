(function () {
  const KEY = 'thuoclong.v1';
  const PREFS_KEY = 'thuoclong.prefs.v1';
  const view = document.getElementById('view');
  const editDialog = document.getElementById('edit-dialog');
  const editForm = document.getElementById('edit-form');
  const confirmDialog = document.getElementById('confirm-dialog');

  const MODES = [
    { id: 'doc', label: 'Đọc' },
    { id: 'che', label: 'Che dần' },
    { id: 'chu-dau', label: 'Chữ đầu' },
    { id: 'tung-dong', label: 'Từng dòng' },
    { id: 'go-lai', label: 'Gõ lại' },
  ];
  const STATUS_LABEL = { new: 'Mới', due: 'Đến hạn', learning: 'Đang học', known: 'Đã thuộc' };
  const RATINGS = [
    { value: 0, label: 'Quên', },
    { value: 1, label: 'Khó' },
    { value: 2, label: 'Được' },
    { value: 3, label: 'Dễ' },
  ];
  const SAMPLE = {
    title: 'Truyện Kiều, bốn câu mở đầu',
    folder: 'Thơ',
    tags: ['Nguyễn Du'],
    text: 'Trăm năm trong cõi người ta,\nChữ tài chữ mệnh khéo là ghét nhau.\nTrải qua một cuộc bể dâu,\nNhững điều trông thấy mà đau đớn lòng.',
  };

  let storageOk = true;
  const store = load();
  const prefs = loadPrefs();
  const filters = { q: '', status: 'all', tag: '', folder: '', sort: 'priority' };
  let editingId = null;
  let toastTimer = null;
  // Trạng thái của màn luyện đang mở; đổi bài hoặc chế độ thì làm mới.
  let session = null;

  function load() {
    const empty = { items: [], days: [] };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      const now = Date.now();
      return {
        items: (parsed.items || []).map((item) => TL.sanitizeItem(item, now)).filter(Boolean),
        days: Array.isArray(parsed.days) ? parsed.days.filter((d) => typeof d === 'string') : [],
      };
    } catch (error) {
      storageOk = false;
      return empty;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
      storageOk = true;
    } catch (error) {
      storageOk = false;
      toast('Không lưu được vào trình duyệt. Hãy bấm Sao lưu để giữ dữ liệu.');
    }
  }

  function loadPrefs() {
    try {
      return { layout: 'grid', ignoreMarks: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
    } catch (error) {
      return { layout: 'grid', ignoreMarks: false };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (error) {
      // Tùy chọn hiển thị mất cũng không ảnh hưởng dữ liệu bài học.
    }
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else if (key === 'value') node.value = value;
      else if (key === 'checked' || key === 'disabled') node[key] = Boolean(value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child);
    }
    return node;
  }

  function fill(node, ...children) {
    node.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  }

  function toast(message) {
    const box = document.getElementById('toast');
    box.textContent = message;
    box.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('on'), 3200);
  }

  function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function findItem(id) {
    return store.items.find((item) => item.id === id);
  }

  function allTags() {
    return [...new Set(store.items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b, 'vi'));
  }

  function allFolders() {
    return [...new Set(store.items.map((item) => item.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  }

  function dueText(srs, now) {
    if (srs.last === null) return 'Chưa học';
    const diff = srs.due - now;
    if (diff <= 0) return 'Ôn ngay';
    if (diff < TL.DAY) {
      const hours = Math.ceil(diff / 3600000);
      return hours <= 1 ? 'Ôn lại trong 1 giờ' : `Ôn lại sau ${hours} giờ`;
    }
    return `Ôn lại sau ${Math.ceil(diff / TL.DAY)} ngày`;
  }

  /* Trang chính */

  function visibleItems(now) {
    const q = filters.q.trim().toLocaleLowerCase('vi');
    const list = store.items.filter((item) => {
      if (filters.status !== 'all' && TL.status(item.srs, now) !== filters.status) return false;
      if (filters.tag && !item.tags.includes(filters.tag)) return false;
      if (filters.folder && item.folder !== filters.folder) return false;
      if (!q) return true;
      return [item.title, item.text, item.folder, ...item.tags].join('\n').toLocaleLowerCase('vi').includes(q);
    });
    const rank = { due: 0, new: 1, learning: 2, known: 3 };
    const sorters = {
      priority: (a, b) => rank[TL.status(a.srs, now)] - rank[TL.status(b.srs, now)] || a.srs.due - b.srs.due,
      newest: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, 'vi'),
      progress: (a, b) => TL.progress(b.srs) - TL.progress(a.srs),
    };
    return list.sort(sorters[filters.sort]);
  }

  function renderHome() {
    session = null;
    const now = Date.now();
    const counts = { due: 0, new: 0, learning: 0, known: 0 };
    store.items.forEach((item) => { counts[TL.status(item.srs, now)] += 1; });
    const dueFirst = store.items
      .filter((item) => TL.status(item.srs, now) === 'due')
      .sort((a, b) => a.srs.due - b.srs.due)[0]
      || store.items.find((item) => TL.status(item.srs, now) === 'new');

    const heroText = store.items.length === 0
      ? 'Sổ học thuộc của riêng bạn.'
      : counts.due > 0 ? `Hôm nay có ${counts.due} bài cần ôn.` : 'Hôm nay chưa có bài nào đến hạn ôn.';

    fill(view,
      el('section', { class: 'hero' },
        el('div', {}, el('h1', {}, 'Bài cần thuộc'), el('p', {}, heroText)),
        el('div', { class: 'hero-actions' },
          dueFirst && el('a', { class: 'btn', href: `#/bai/${dueFirst.id}/che` }, counts.due > 0 ? 'Ôn bài kế tiếp' : 'Học bài mới'),
          el('button', { class: 'btn primary', type: 'button', onclick: () => openEditor() }, 'Thêm bài'))),
      store.items.length > 0 && renderStats(counts, now),
      store.items.length > 0 ? renderControls() : null,
      el('div', { id: 'item-area' }),
      el('p', { class: 'notice' }, storageOk
        ? 'Dữ liệu chỉ nằm trong trình duyệt này, không gửi đi đâu. Xóa dữ liệu trình duyệt sẽ mất bài, nên thỉnh thoảng hãy bấm Sao lưu.'
        : 'Trình duyệt đang chặn lưu dữ liệu, bài có thể mất khi đóng trang. Hãy bấm Sao lưu trước khi rời đi.'),
    );
    renderItems();
  }

  function renderStats(counts, now) {
    const stat = (value, label) => el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, label));
    return el('section', { class: 'stats' },
      stat(store.items.length, 'Tổng số bài'),
      stat(counts.due, 'Đến hạn'),
      stat(counts.known, 'Đã thuộc'),
      stat(TL.streak(store.days, now), 'Ngày ôn liên tiếp'));
  }

  function select(label, value, options, onChange) {
    return el('select', { 'aria-label': label, onchange: (event) => onChange(event.target.value) },
      options.map(([optionValue, text]) => {
        const option = el('option', { value: optionValue }, text);
        option.selected = optionValue === value;
        return option;
      }));
  }

  function renderControls() {
    const set = (key) => (value) => { filters[key] = value; renderItems(); };
    if (filters.tag && !allTags().includes(filters.tag)) filters.tag = '';
    if (filters.folder && !allFolders().includes(filters.folder)) filters.folder = '';
    const setLayout = (layout) => () => {
      prefs.layout = layout;
      savePrefs();
      renderHome();
    };
    return el('section', { class: 'controls' },
      el('input', {
        class: 'search', type: 'search', placeholder: 'Tìm theo tên, nội dung, thẻ', 'aria-label': 'Tìm bài',
        value: filters.q, oninput: (event) => set('q')(event.target.value),
      }),
      select('Lọc theo trạng thái', filters.status, [
        ['all', 'Mọi trạng thái'], ['due', 'Đến hạn'], ['new', 'Mới'], ['learning', 'Đang học'], ['known', 'Đã thuộc'],
      ], set('status')),
      select('Lọc theo thẻ', filters.tag, [['', 'Mọi thẻ'], ...allTags().map((t) => [t, t])], set('tag')),
      select('Lọc theo thư mục', filters.folder, [['', 'Mọi thư mục'], ...allFolders().map((f) => [f, f])], set('folder')),
      select('Sắp xếp', filters.sort, [
        ['priority', 'Ưu tiên ôn'], ['newest', 'Mới thêm'], ['title', 'Tên A–Z'], ['progress', 'Tiến độ'],
      ], set('sort')),
      el('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Kiểu hiển thị' },
        el('button', { class: 'btn', type: 'button', 'aria-pressed': String(prefs.layout === 'grid'), onclick: setLayout('grid') }, 'Thẻ'),
        el('button', { class: 'btn', type: 'button', 'aria-pressed': String(prefs.layout === 'list'), onclick: setLayout('list') }, 'Danh sách')));
  }

  function renderItems() {
    const area = document.getElementById('item-area');
    if (!area) return;
    const now = Date.now();
    if (store.items.length === 0) {
      area.replaceChildren(el('div', { class: 'empty' },
        el('h2', {}, 'Chưa có bài nào'),
        el('p', {}, 'Thêm một đoạn kinh, bài thơ hay lời thoại để bắt đầu.'),
        el('div', { class: 'hero-actions' },
          el('button', { class: 'btn primary', type: 'button', onclick: () => openEditor() }, 'Thêm bài đầu tiên'),
          el('button', { class: 'btn', type: 'button', onclick: addSample }, 'Dùng bài mẫu'))));
      return;
    }
    const list = visibleItems(now);
    if (list.length === 0) {
      area.replaceChildren(el('div', { class: 'empty' },
        el('h2', {}, 'Không có bài nào khớp'),
        el('p', {}, 'Thử đổi từ khóa hoặc bộ lọc.')));
      return;
    }
    area.replaceChildren(el('div', { class: `items ${prefs.layout === 'list' ? 'list' : 'grid'}` }, list.map((item) => renderCard(item, now))));
  }

  function renderCard(item, now) {
    const state = TL.status(item.srs, now);
    const meta = [`${TL.words(item.text).length} từ`, item.folder, ...item.tags].filter(Boolean).join(' · ');
    const percent = TL.progress(item.srs);
    return el('article', { class: 'item' },
      el('div', { class: 'item-main' },
        el('h3', {}, el('a', { href: `#/bai/${item.id}/doc` }, item.title)),
        el('p', { class: 'item-meta' }, meta)),
      el('p', { class: 'item-excerpt' }, item.text),
      el('div', { class: 'meter', role: 'img', 'aria-label': `Tiến độ ${percent}%` }, el('i', { style: `width:${percent}%` })),
      el('div', { class: 'item-foot' },
        el('span', { class: `badge ${state}` }, STATUS_LABEL[state]),
        el('span', { class: 'item-meta' }, dueText(item.srs, now))));
  }

  function addSample() {
    const now = Date.now();
    store.items.push(TL.sanitizeItem({ ...SAMPLE, id: makeId(), createdAt: now, updatedAt: now }, now));
    save();
    renderHome();
  }

  /* Thêm và sửa bài */

  function openEditor(item) {
    editingId = item ? item.id : null;
    document.getElementById('edit-title').textContent = item ? 'Sửa bài' : 'Thêm bài';
    document.getElementById('edit-note').hidden = !item;
    editForm.elements.title.value = item ? item.title : '';
    editForm.elements.text.value = item ? item.text : '';
    editForm.elements.folder.value = item ? item.folder : '';
    editForm.elements.tags.value = item ? item.tags.join(', ') : '';
    document.getElementById('folder-list').replaceChildren(...allFolders().map((f) => el('option', { value: f })));
    editDialog.showModal();
    editForm.elements.title.focus();
  }

  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = editForm.elements.title.value.trim();
    const text = editForm.elements.text.value.replace(/\r\n/g, '\n').trim();
    if (!title || !text) {
      toast('Bài cần có tên và nội dung.');
      return;
    }
    if (TL.words(text).length === 0) {
      toast('Nội dung cần có ít nhất một từ.');
      return;
    }
    const now = Date.now();
    const fields = {
      title,
      text,
      folder: editForm.elements.folder.value.trim(),
      tags: [...new Set(editForm.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean))],
      updatedAt: now,
    };
    if (editingId) {
      Object.assign(findItem(editingId), fields);
    } else {
      store.items.push({ ...TL.sanitizeItem({ id: makeId(), text, createdAt: now }, now), ...fields });
    }
    save();
    editDialog.close();
    route();
  });

  document.getElementById('edit-cancel').addEventListener('click', () => editDialog.close());

  function confirmDelete(item) {
    document.getElementById('confirm-body').textContent = `“${item.title}” và tiến độ ôn của bài sẽ mất hẳn.`;
    confirmDialog.returnValue = 'cancel';
    confirmDialog.showModal();
    confirmDialog.addEventListener('close', () => {
      if (confirmDialog.returnValue !== 'ok') return;
      store.items = store.items.filter((other) => other.id !== item.id);
      save();
      toast('Đã xóa bài.');
      location.hash = '#/';
    }, { once: true });
  }

  /* Trang luyện */

  function renderPractice(id, mode) {
    const item = findItem(id);
    if (!item) {
      fill(view, el('div', { class: 'empty' },
        el('h2', {}, 'Không tìm thấy bài này'),
        el('p', {}, 'Bài có thể đã bị xóa hoặc nằm ở trình duyệt khác.'),
        el('a', { class: 'btn primary', href: '#/' }, 'Về danh sách')));
      return;
    }
    const active = MODES.some((m) => m.id === mode) ? mode : 'doc';
    session = {
      id, mode: active, level: 40, revealed: new Set(), lines: 0, attempt: '', result: null,
      seed: Math.floor(Math.random() * 2147483646) + 1,
    };
    stopSpeaking();

    const body = el('div', { id: 'practice-body' });
    fill(view,
      el('a', { class: 'back', href: '#/' }, '← Danh sách bài'),
      el('div', { class: 'practice-head' },
        el('div', {},
          el('h1', {}, item.title),
          el('p', { class: 'item-meta' }, `${TL.words(item.text).length} từ · ${dueText(item.srs, Date.now())}`)),
        el('div', { class: 'practice-head-actions' },
          el('button', { class: 'btn ghost', type: 'button', onclick: () => openEditor(item) }, 'Sửa'),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => confirmDelete(item) }, 'Xóa'))),
      el('nav', { class: 'modes', 'aria-label': 'Cách luyện' }, MODES.map((m) => el('a', {
        href: `#/bai/${id}/${m.id}`,
        'aria-current': m.id === active ? 'page' : null,
      }, m.label))),
      body,
      renderRating(item),
    );
    renderMode(item, body);
  }

  function renderMode(item, body) {
    const renderers = { doc: renderRead, che: renderHide, 'chu-dau': renderInitials, 'tung-dong': renderLines, 'go-lai': renderTyping };
    renderers[session.mode](item, body);
  }

  function rerender(item) {
    renderMode(item, document.getElementById('practice-body'));
  }

  function renderRead(item, body) {
    const canSpeak = 'speechSynthesis' in window;
    fill(body,
      canSpeak ? el('div', { class: 'tools' },
        el('button', { class: 'btn', type: 'button', onclick: () => speak(item.text) }, 'Nghe'),
        el('button', { class: 'btn', type: 'button', onclick: stopSpeaking }, 'Dừng')) : null,
      el('div', { class: 'sheet' }, item.text),
    );
  }

  function speak(text) {
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    if (/[ăâđêôơưàảãáạ]/i.test(text)) utterance.lang = 'vi-VN';
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  // Dựng lại văn bản, mỗi từ là một nút bấm để hé; render quyết định cách hiện từng từ.
  function wordSheet(item, decorate, onToggle) {
    let index = -1;
    const nodes = TL.tokenize(item.text).map((token) => {
      if (token.type === 'sep') return token.text;
      index += 1;
      const current = index;
      const look = decorate(current, token.text);
      return el('button', {
        class: `word ${look.className}`,
        type: 'button',
        'aria-label': look.label,
        onclick: () => onToggle(current),
      }, look.text);
    });
    return el('div', { class: 'sheet' }, nodes);
  }

  function toggleReveal(item, index) {
    if (session.revealed.has(index)) session.revealed.delete(index);
    else session.revealed.add(index);
    rerender(item);
  }

  function renderHide(item, body) {
    const count = TL.words(item.text).length;
    const order = TL.hideOrder(count, session.seed);
    const hiddenCount = Math.round((count * session.level) / 100);
    const hidden = new Set(order.slice(0, hiddenCount));
    fill(body,
      el('div', { class: 'tools' },
        el('label', {},
          'Mức che',
          el('input', {
            type: 'range', min: 0, max: 100, step: 10, value: session.level,
            oninput: (event) => {
              session.level = Number(event.target.value);
              session.revealed.clear();
              // Giữ nguyên thanh trượt đang kéo, chỉ thay phần văn bản.
              const sheet = body.querySelector('.sheet');
              sheet.replaceWith(hideSheet(item));
              body.querySelector('#level-value').textContent = `${session.level}%`;
            },
          }),
          el('span', { id: 'level-value' }, `${session.level}%`)),
        el('span', {}, 'Bấm vào ô che để hé từ.'),
        el('button', { class: 'btn', type: 'button', onclick: () => { session.seed += 1; session.revealed.clear(); rerender(item); } }, 'Che từ khác')),
      hideSheet(item, hidden),
    );
  }

  function hideSheet(item, known) {
    const count = TL.words(item.text).length;
    const hidden = known || new Set(TL.hideOrder(count, session.seed).slice(0, Math.round((count * session.level) / 100)));
    return wordSheet(item, (index, word) => {
      if (!hidden.has(index)) return { className: '', text: word, label: word };
      if (session.revealed.has(index)) return { className: 'shown', text: word, label: word };
      return { className: 'hidden', text: word, label: 'Từ đang che, bấm để hé' };
    }, (index) => { if (hidden.has(index)) toggleReveal(item, index); });
  }

  function renderInitials(item, body) {
    fill(body,
      el('div', { class: 'tools' },
        el('span', {}, 'Chỉ còn chữ đầu của mỗi từ. Bấm vào một từ để hé.'),
        el('button', { class: 'btn', type: 'button', onclick: () => { session.revealed.clear(); rerender(item); } }, 'Che lại hết')),
      wordSheet(item, (index, word) => (session.revealed.has(index)
        ? { className: 'shown', text: word, label: word }
        : { className: 'hint', text: TL.firstLetter(word), label: `Từ bắt đầu bằng ${TL.firstLetter(word)}, bấm để hé` }),
      (index) => toggleReveal(item, index)),
    );
  }

  function renderLines(item, body) {
    const lines = item.text.split('\n').filter((line) => line.trim());
    const shown = lines.slice(0, session.lines);
    const done = session.lines >= lines.length;
    fill(body,
      el('div', { class: 'tools' }, el('span', {}, `Đọc thầm dòng kế tiếp rồi mới mở. Đã mở ${session.lines}/${lines.length} dòng.`)),
      el('div', { class: 'sheet' }, shown.length > 0 ? shown.join('\n') : el('span', { class: 'line-blank' }, 'Hãy đọc thầm dòng đầu tiên.')),
      el('div', { class: 'row-actions' },
        el('button', {
          class: 'btn primary', type: 'button', disabled: done,
          onclick: () => { session.lines += 1; rerender(item); },
        }, done ? 'Đã hết bài' : 'Mở dòng kế tiếp'),
        el('button', {
          class: 'btn', type: 'button', disabled: session.lines === 0,
          onclick: () => { session.lines = 0; rerender(item); },
        }, 'Làm lại')),
    );
  }

  function renderTyping(item, body) {
    const attempt = el('textarea', {
      class: 'attempt', 'aria-label': 'Gõ lại bài từ trí nhớ', placeholder: 'Gõ lại toàn bộ bài theo trí nhớ…',
      oninput: (event) => { session.attempt = event.target.value; },
    });
    attempt.value = session.attempt;

    const grade = () => {
      session.result = TL.diffWords(item.text, session.attempt, { ignoreMarks: prefs.ignoreMarks });
      if (session.result.score > (item.bestScore ?? -1)) {
        item.bestScore = session.result.score;
        save();
      }
      rerender(item);
    };

    fill(body,
      el('div', { class: 'tools' },
        el('label', {},
          el('input', {
            type: 'checkbox', checked: prefs.ignoreMarks,
            onchange: (event) => {
              prefs.ignoreMarks = event.target.checked;
              savePrefs();
              if (session.result) session.result = TL.diffWords(item.text, session.attempt, { ignoreMarks: prefs.ignoreMarks });
              rerender(item);
            },
          }),
          'Bỏ qua dấu tiếng Việt'),
        item.bestScore !== null && el('span', {}, `Điểm cao nhất: ${item.bestScore}%`)),
      attempt,
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: grade }, 'Chấm bài'),
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => { session.attempt = ''; session.result = null; rerender(item); },
        }, 'Xóa và gõ lại')),
      session.result && renderResult(session.result),
    );
  }

  function renderResult(result) {
    const nodes = [];
    result.parts.forEach((part, index) => {
      if (index > 0) nodes.push(' ');
      nodes.push(el('span', { class: part.kind }, part.text));
    });
    return el('section', { 'aria-label': 'Kết quả chấm bài' },
      el('p', { class: 'score-line' }, `${result.score}%`),
      el('p', { class: 'score-sub' }, `Đúng ${result.correct}/${result.total} từ · thiếu ${result.missing} · thừa ${result.extra}`),
      el('div', { class: 'sheet diff' }, nodes),
      el('p', { class: 'diff-legend' }, 'Màu vàng là từ còn thiếu, chữ gạch đỏ là từ gõ thừa hoặc sai.'));
  }

  function intervalPreview(srs, rating) {
    if (rating === 0) return '10 phút';
    return `${TL.review(srs, rating, Date.now()).interval} ngày`;
  }

  function renderRating(item) {
    return el('section', { class: 'rate' },
      el('h2', {}, 'Luyện xong, bạn nhớ bài này thế nào?'),
      el('div', { class: 'rate-grid' }, RATINGS.map((rating) => el('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const now = Date.now();
          item.srs = TL.review(item.srs, rating.value, now);
          item.updatedAt = now;
          const today = TL.dayKey(now);
          if (!store.days.includes(today)) store.days.push(today);
          save();
          toast(`Đã ghi nhận. ${dueText(item.srs, now)}.`);
          location.hash = '#/';
        },
      }, rating.label, el('small', {}, intervalPreview(item.srs, rating.value))))));
  }

  /* Sao lưu */

  document.getElementById('btn-export').addEventListener('click', () => {
    const payload = JSON.stringify({ app: 'thuoc-long', version: 1, exportedAt: new Date().toISOString(), ...store }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = el('a', { href: url, download: `thuoc-long-${TL.dayKey(Date.now())}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Đã xuất ${store.items.length} bài.`);
  });

  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());

  document.getElementById('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const raw = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(raw)) throw new Error('format');
      const now = Date.now();
      const incoming = raw.map((item) => TL.sanitizeItem(item, now)).filter(Boolean);
      const merged = TL.mergeItems(store.items, incoming);
      store.items = merged.items;
      if (Array.isArray(parsed.days)) {
        store.days = [...new Set([...store.days, ...parsed.days.filter((d) => typeof d === 'string')])];
      }
      save();
      toast(`Thêm ${merged.added} bài, cập nhật ${merged.updated} bài, bỏ qua ${raw.length - merged.added - merged.updated} bài.`);
      route();
    } catch (error) {
      toast('File này không phải bản sao lưu hợp lệ. Dữ liệu hiện tại không đổi.');
    }
  });

  /* Điều hướng */

  function route() {
    const match = location.hash.match(/^#\/bai\/([^/]+)(?:\/([^/]+))?$/);
    if (match) renderPractice(decodeURIComponent(match[1]), match[2]);
    else {
      stopSpeaking();
      renderHome();
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  route();
})();
