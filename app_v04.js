(function () {
  const KEY = 'thuoclong.v1';
  const PREFS_KEY = 'thuoclong.prefs.v1';
  const view = document.getElementById('view');
  const editDialog = document.getElementById('edit-dialog');
  const editForm = document.getElementById('edit-form');
  const confirmDialog = document.getElementById('confirm-dialog');

  // Lộ trình học: đi lần lượt từ dễ tới khó, mỗi đoạn và cả bài có tiến độ riêng.
  const STEPS = [
    { id: 'doc', label: 'Làm quen', hint: 'Đọc chậm vài lượt cho quen mạch bài, có thể bấm Nghe.' },
    { id: 'che-it', label: 'Che ít', level: 30, hint: 'Đọc to cả bài, tự nhớ các từ bị che. Nhấn Space hoặc bấm vào khoảng trắng để mở lần lượt từng ô.' },
    { id: 'che-nhieu', label: 'Che nhiều', level: 70, hint: 'Phần lớn đã bị che. Nhấn Space hoặc bấm vào khoảng trắng để mở lần lượt từng ô.' },
    { id: 'chu-dau', label: 'Chữ đầu', hint: 'Chỉ còn chữ đầu của mỗi từ. Nhấn Space hoặc bấm vào khoảng trắng để mở lần lượt từng từ.' },
    { id: 'dien-tu', label: 'Điền từ', hint: 'Chọn từ đúng cho từng chỗ trống.' },
  ];
  const EXTRAS = [
    { id: 'tung-cum', label: 'Từng cụm' },
    { id: 'sap-xep', label: 'Xếp thứ tự' },
    { id: 'loi-thoai', label: 'Lời thoại' },
  ];
  const STATUS_LABEL = { new: 'Mới', due: 'Đến hạn', learning: 'Đang học', known: 'Đã thuộc' };
  const RATINGS = [
    { value: 0, label: 'Quên' },
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
  // Trạng thái của màn luyện đang mở; đổi bài, đoạn hoặc chế độ thì làm mới.
  let session = null;

  function load() {
    const empty = { items: [], days: [], log: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      const now = Date.now();
      const days = Array.isArray(parsed.days) ? parsed.days.filter((d) => typeof d === 'string') : [];
      const log = TL.positiveCounts(parsed.log);
      // Dữ liệu từ bản đầu chỉ có danh sách ngày, mỗi ngày tính là một lượt.
      days.forEach((day) => { if (!log[day]) log[day] = 1; });
      return {
        items: (parsed.items || []).map((item) => TL.sanitizeItem(item, now)).filter(Boolean),
        days,
        log,
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
    const defaults = { layout: 'grid', ignoreMarks: false, speakOthers: true };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
    } catch (error) {
      return defaults;
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

  function newSeed() {
    return Math.floor(Math.random() * 2147483646) + 1;
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
    if (srs.last === null) return 'Chưa ôn lần nào';
    const diff = srs.due - now;
    if (diff <= 0) return 'Cần ôn ngay';
    const hours = Math.ceil(diff / 3600000);
    if (hours < 24) {
      return hours <= 1 ? 'Ôn lại trong 1 giờ' : `Ôn lại sau ${hours} giờ`;
    }
    return `Ôn lại sau ${Math.ceil(diff / TL.DAY)} ngày`;
  }

  function stageOf(item, scope) {
    return Math.min(item.stages[scope] || 0, STEPS.length);
  }

  function nextStepId(item, scope) {
    const stage = stageOf(item, scope);
    return STEPS[Math.min(stage, STEPS.length - 1)].id;
  }

  function itemProgress(item) {
    return Math.max(TL.progress(item.srs), Math.round((stageOf(item, 'all') / STEPS.length) * 60));
  }

  function logActivity(now) {
    const today = TL.dayKey(now);
    if (!store.days.includes(today)) store.days.push(today);
    store.log[today] = (store.log[today] || 0) + 1;
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
      progress: (a, b) => itemProgress(b) - itemProgress(a),
    };
    return list.sort(sorters[filters.sort]);
  }

  function statusCounts(now) {
    const counts = { due: 0, new: 0, learning: 0, known: 0 };
    store.items.forEach((item) => { counts[TL.status(item.srs, now)] += 1; });
    return counts;
  }

  function renderHome() {
    session = null;
    setNav('home');
    const now = Date.now();
    const counts = statusCounts(now);
    const dueFirst = store.items
      .filter((item) => TL.status(item.srs, now) === 'due')
      .sort((a, b) => a.srs.due - b.srs.due)[0];
    const next = dueFirst || store.items.find((item) => TL.status(item.srs, now) === 'new');

    let heroTitle = 'Bắt đầu với một bài ngắn';
    let heroText = 'Một bài thơ, đoạn kinh hay lời thoại đều được. Mỗi ngày một ít là đủ.';
    if (store.items.length > 0) {
      if (counts.due > 0) {
        heroTitle = `Hôm nay có ${counts.due} bài cần ôn`;
        heroText = 'Ôn đúng hạn giúp bài ở lại lâu hơn.';
      } else if (counts.new > 0) {
        heroTitle = 'Hôm nay học thêm một bài nhé';
        heroText = `Không có bài đến hạn, còn ${counts.new} bài mới đang chờ.`;
      } else {
        heroTitle = 'Hôm nay đã ôn đủ';
        heroText = 'Chưa có bài nào đến hạn. Bạn có thể thêm bài mới.';
      }
    }

    fill(view,
      el('section', { class: 'hero' },
        el('div', { class: 'hero-copy' }, el('h1', {}, heroTitle), el('p', {}, heroText)),
        el('div', { class: 'hero-actions' },
          next && el('a', {
            class: 'btn primary lg',
            href: `#/bai/${next.id}/${dueFirst ? 'che-nhieu' : nextStepId(next, 'all')}/all`,
          }, dueFirst ? 'Ôn bài kế tiếp' : 'Học bài mới'),
          el('button', { class: `btn lg ${next ? '' : 'primary'}`, type: 'button', onclick: () => openEditor() }, 'Thêm bài'))),
      store.items.length > 0 ? renderControls() : null,
      el('div', { id: 'item-area' }),
      el('p', { class: 'notice' }, storageOk
        ? 'Dữ liệu chỉ nằm trong trình duyệt này, không gửi đi đâu. Xóa dữ liệu trình duyệt sẽ mất bài, nên thỉnh thoảng hãy bấm Sao lưu.'
        : 'Trình duyệt đang chặn lưu dữ liệu, bài có thể mất khi đóng trang. Hãy bấm Sao lưu trước khi rời đi.'),
    );
    renderItems();
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
      fill(area, el('div', { class: 'empty' },
        el('h2', {}, 'Chưa có bài nào'),
        el('p', {}, 'Thêm bài của bạn, hoặc thử ngay với bài mẫu.'),
        el('button', { class: 'btn', type: 'button', onclick: addSample }, 'Dùng bài mẫu')));
      return;
    }
    const list = visibleItems(now);
    if (list.length === 0) {
      fill(area, el('div', { class: 'empty' },
        el('h2', {}, 'Không có bài nào khớp'),
        el('p', {}, 'Thử đổi từ khóa hoặc bộ lọc.')));
      return;
    }
    fill(area, el('div', { class: `items ${prefs.layout === 'list' ? 'list' : 'grid'}` }, list.map((item) => renderCard(item, now))));
  }

  function renderCard(item, now) {
    const state = TL.status(item.srs, now);
    const stage = stageOf(item, 'all');
    const meta = [`${TL.words(item.text).length} từ`, item.folder, ...item.tags].filter(Boolean).join(' · ');
    const percent = itemProgress(item);
    return el('article', { class: 'item' },
      el('div', { class: 'item-top' },
        el('span', { class: `badge ${state}` }, STATUS_LABEL[state]),
        el('span', { class: 'item-meta' }, stage >= STEPS.length ? 'Xong lộ trình' : `Bước ${stage + 1}/${STEPS.length}`)),
      el('div', { class: 'item-main' },
        el('h3', {}, el('a', { href: `#/bai/${item.id}/${nextStepId(item, 'all')}/all` }, item.title)),
        el('p', { class: 'item-meta' }, meta)),
      el('p', { class: 'item-excerpt' }, item.text),
      el('div', { class: 'item-foot' },
        el('div', { class: 'meter', role: 'img', 'aria-label': `Tiến độ ${percent}%` }, el('i', { style: `width:${percent}%` })),
        el('span', { class: 'item-meta' }, dueText(item.srs, now))));
  }

  function addSample() {
    const now = Date.now();
    store.items.push(TL.sanitizeItem({ ...SAMPLE, id: makeId(), createdAt: now, updatedAt: now }, now));
    save();
    renderHome();
  }

  /* Tiến độ */

  function renderProgress() {
    session = null;
    setNav('progress');
    const now = Date.now();
    const counts = statusCounts(now);
    const stat = (value, label) => el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, label));
    const missed = TL.topMissed(store.items, 12);
    fill(view,
      el('section', { class: 'hero compact' }, el('div', { class: 'hero-copy' }, el('h1', {}, 'Tiến độ'), el('p', {}, 'Nhịp ôn của bạn và những từ cần để ý.'))),
      el('section', { class: 'stats' },
        stat(store.items.length, 'Tổng số bài'),
        stat(counts.known, 'Đã thuộc'),
        stat(counts.due, 'Đến hạn'),
        stat(TL.streak(store.days, now), 'Ngày ôn liên tiếp')),
      el('div', { class: 'panels' }, renderHeatmap(now), renderMissed(missed)),
    );
  }

  function renderHeatmap(now) {
    const weeks = TL.calendarWeeks(now, 16);
    const tip = el('div', { class: 'chart-tip', role: 'status', hidden: true });
    const describe = (cell) => {
      const count = store.log[cell.key] || 0;
      const [y, m, d] = cell.key.split('-');
      return `${d}/${m}/${y}: ${count ? `${count} lượt` : 'chưa ôn'}`;
    };
    const showTip = (event, cell) => {
      tip.textContent = describe(cell);
      tip.hidden = false;
      const box = event.target.getBoundingClientRect();
      const parent = tip.parentElement.getBoundingClientRect();
      const left = Math.min(Math.max(box.left - parent.left + box.width / 2 - 60, 0), parent.width - 130);
      tip.style.left = `${left}px`;
      tip.style.top = `${box.top - parent.top - 36}px`;
    };
    const hideTip = () => { tip.hidden = true; };
    const grid = el('div', { class: 'heat-grid', role: 'img', 'aria-label': 'Lịch số lượt ôn trong 16 tuần gần nhất. Danh sách chi tiết nằm ngay bên dưới.' },
      el('div', { class: 'heat-days', 'aria-hidden': 'true' }, ['T2', '', 'T4', '', 'T6', '', 'CN'].map((d) => el('span', {}, d))),
      weeks.map((week) => el('div', { class: 'heat-week' }, week.map((cell) => (cell.future
        ? el('span', { class: 'cell future' })
        : el('span', {
          class: `cell l${TL.activityLevel(store.log[cell.key] || 0)}${cell.today ? ' today' : ''}`,
          tabindex: '0',
          onmouseenter: (event) => showTip(event, cell),
          onmouseleave: hideTip,
          onfocus: (event) => showTip(event, cell),
          onblur: hideTip,
        }))))));
    const active = Object.entries(store.log).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);
    return el('section', { class: 'panel' },
      el('h2', {}, 'Lượt ôn mỗi ngày'),
      el('div', { class: 'chart-wrap' }, grid, tip),
      el('div', { class: 'heat-legend', 'aria-hidden': 'true' },
        'Ít', [1, 2, 3, 4].map((level) => el('span', { class: `cell l${level}` })), 'Nhiều'),
      el('details', { class: 'data-table' },
        el('summary', {}, 'Xem dạng danh sách'),
        active.length === 0
          ? el('p', { class: 'item-meta' }, 'Chưa có lượt ôn nào.')
          : el('ul', {}, active.map(([key, count]) => el('li', {}, el('span', {}, key.split('-').reverse().join('/')), el('b', {}, `${count} lượt`))))));
  }

  function renderMissed(missed) {
    return el('section', { class: 'panel' },
      el('h2', {}, 'Từ hay quên'),
      missed.length === 0
        ? el('p', { class: 'item-meta' }, 'Chưa có dữ liệu. Danh sách sẽ hiện sau khi bạn chơi Điền từ.')
        : el('ol', { class: 'missed' }, missed.map((entry) => el('li', {},
          el('div', {}, el('b', {}, entry.word), el('p', { class: 'item-meta' }, entry.titles.join(', '))),
          el('span', { class: 'count' }, `${entry.count} lần`)))));
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
    fill(document.getElementById('folder-list'), allFolders().map((f) => el('option', { value: f })));
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
      const item = findItem(editingId);
      // Đổi nội dung thì các đoạn đổi theo, nên lộ trình học lại từ đầu; lịch ôn giữ nguyên.
      if (item.text !== text) item.stages = {};
      Object.assign(item, fields);
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

  function renderPractice(id, mode, rawScope) {
    setNav('home');
    const item = findItem(id);
    if (!item) {
      fill(view, el('div', { class: 'empty' },
        el('h2', {}, 'Không tìm thấy bài này'),
        el('p', {}, 'Bài có thể đã bị xóa hoặc nằm ở trình duyệt khác.'),
        el('a', { class: 'btn primary', href: '#/' }, 'Về danh sách')));
      return;
    }
    const sections = TL.sections(item.text);
    const scopeIndex = Number(rawScope);
    const validScope = Number.isInteger(scopeIndex) && scopeIndex >= 0 && scopeIndex < sections.length;
    const scope = validScope && sections.length > 1 ? String(scopeIndex) : 'all';
    const known = [...STEPS, ...EXTRAS].some((m) => m.id === mode);
    const active = known ? mode : nextStepId(item, scope);
    const stepIndex = STEPS.findIndex((s) => s.id === active);
    session = {
      id, mode: active, scope, stepIndex, seed: newSeed(),
      text: scope === 'all' ? item.text : sections[Number(scope)],
      sections,
      level: stepIndex >= 0 && STEPS[stepIndex].level ? STEPS[stepIndex].level : 40,
      revealed: new Set(), opened: 0, game: null,
    };
    stopSpeaking();

    const script = TL.parseScript(item.text);
    const extras = EXTRAS.filter((m) => m.id !== 'loi-thoai' || script.isScript);
    const stage = stageOf(item, scope);
    const body = el('div', { id: 'practice-body' });
    const footer = el('div', { id: 'practice-foot' });

    fill(view,
      el('a', { class: 'back', href: '#/' }, '← Danh sách bài'),
      el('div', { class: 'practice-head' },
        el('div', { class: 'practice-title' },
          el('h1', {}, item.title),
          el('p', { class: 'item-meta' }, `${TL.words(session.text).length} từ · ${dueText(item.srs, Date.now())}`)),
        el('div', { class: 'practice-head-actions' },
          el('button', { class: 'btn ghost', type: 'button', onclick: () => openEditor(item) }, 'Sửa'),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => confirmDelete(item) }, 'Xóa'))),
      sections.length > 1 && el('label', { class: 'scope' },
        'Đang học',
        select('Chọn đoạn', scope, [
          ['all', `Cả bài (${sections.length} đoạn)`],
          ...sections.map((_, index) => [String(index), `Đoạn ${index + 1}${stageOf(item, String(index)) >= STEPS.length ? ' ✓' : ''}`]),
        ], (value) => { location.hash = `#/bai/${id}/${nextStepId(item, value)}/${value}`; })),
      el('nav', { class: 'path', 'aria-label': 'Lộ trình học' },
        el('ol', {}, STEPS.map((step, index) => {
          const done = index < stage;
          return el('li', { class: done ? 'done' : '' }, el('a', {
            href: `#/bai/${id}/${step.id}/${scope}`,
            'aria-current': step.id === active ? 'step' : null,
          }, el('span', { class: 'dot', 'aria-hidden': 'true' }, done ? '✓' : String(index + 1)), el('span', { class: 'path-label' }, step.label)));
        }))),
      el('nav', { class: 'extras', 'aria-label': 'Cách luyện khác' },
        el('span', {}, 'Luyện thêm'),
        extras.map((m) => el('a', { href: `#/bai/${id}/${m.id}/${scope}`, 'aria-current': m.id === active ? 'page' : null }, m.label))),
      stepIndex >= 0 && el('p', { class: 'step-hint' }, STEPS[stepIndex].hint),
      body,
      footer,
      scope === 'all' && renderRating(item),
    );
    renderMode(item);
  }

  function renderMode(item) {
    const body = document.getElementById('practice-body');
    const renderers = {
      doc: renderRead,
      'che-it': renderHide,
      'che-nhieu': renderHide,
      'chu-dau': renderInitials,
      'dien-tu': renderBlanks,
      'tung-cum': renderClusters,
      'sap-xep': renderOrder,
      'loi-thoai': renderScript,
    };
    renderers[session.mode](item, body);
    renderFooter(item);
  }

  function rerender(item) {
    renderMode(item);
  }

  // Nút qua bước, chỉ có ở các bước thuộc lộ trình.
  function renderFooter(item) {
    const foot = document.getElementById('practice-foot');
    if (session.stepIndex < 0) {
      fill(foot);
      return;
    }
    const isLast = session.stepIndex === STEPS.length - 1;
    fill(foot, el('div', { class: 'foot-row' },
      el('button', {
        class: 'btn primary lg', type: 'button',
        onclick: () => completeStep(item),
      }, isLast ? 'Hoàn thành lộ trình' : 'Xong, sang bước tiếp')));
  }

  function completeStep(item) {
    const { scope, stepIndex, id } = session;
    const now = Date.now();
    item.stages[scope] = Math.max(stageOf(item, scope), stepIndex + 1);
    item.updatedAt = now;
    logActivity(now);
    save();
    if (stepIndex < STEPS.length - 1) {
      location.hash = `#/bai/${id}/${STEPS[stepIndex + 1].id}/${scope}`;
      return;
    }
    if (scope === 'all') {
      toast('Bạn đã qua đủ các bước. Hãy ghi nhận mức nhớ ở cuối trang.');
      renderPractice(id, session.mode, scope);
      const rate = document.querySelector('.rate');
      if (rate) rate.scrollIntoView({ block: 'center' });
      return;
    }
    const nextSection = session.sections.findIndex((_, index) => stageOf(item, String(index)) < STEPS.length);
    if (nextSection >= 0) {
      toast(`Đã xong đoạn ${Number(scope) + 1}. Sang đoạn ${nextSection + 1}.`);
      location.hash = `#/bai/${id}/${nextStepId(item, String(nextSection))}/${nextSection}`;
    } else {
      toast('Đã xong mọi đoạn. Giờ ghép lại cả bài.');
      location.hash = `#/bai/${id}/${nextStepId(item, 'all')}/all`;
    }
  }

  function renderRead(item, body) {
    const canSpeak = 'speechSynthesis' in window;
    fill(body,
      canSpeak ? el('div', { class: 'tools' },
        el('button', { class: 'btn', type: 'button', onclick: () => speak(session.text) }, 'Nghe'),
        el('button', { class: 'btn', type: 'button', onclick: stopSpeaking }, 'Dừng')) : null,
      el('div', { class: 'sheet' }, session.text),
    );
  }

  function speak(text, onEnd) {
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    if (/[ăâđêôơưàảãáạ]/i.test(text)) utterance.lang = 'vi-VN';
    utterance.rate = 0.9;
    if (onEnd) utterance.onend = onEnd;
    speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  // Dựng lại văn bản, mỗi từ là một nút bấm để hé; hàm decorate quyết định cách hiện từng từ.
  function wordSheet(decorate, onToggle) {
    let index = -1;
    const nodes = TL.tokenize(session.text).map((token) => {
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

  // Các vị trí còn có thể mở của màn hiện tại, theo thứ tự đọc.
  function coveredIndexes() {
    if (session.mode === 'chu-dau') return TL.words(session.text).map((_, index) => index);
    return [...hiddenWords()].sort((a, b) => a - b);
  }

  function openCountText() {
    const all = coveredIndexes();
    return `Đã mở ${all.filter((index) => session.revealed.has(index)).length}/${all.length} ô`;
  }

  // Bấm đúng ô còn che thì mở ô đó, bấm từ đã hiện thì coi như mở ô kế tiếp.
  function revealWord(item, index) {
    if (coveredIndexes().includes(index) && !session.revealed.has(index)) {
      session.revealed.add(index);
      rerender(item);
    } else {
      revealNext(item);
    }
  }

  function revealNext(item) {
    if (session.mode === 'tung-cum') {
      if (session.opened < TL.clusters(session.text).length) {
        session.opened += 1;
        rerender(item);
        keepInView(document.querySelector('.latest'));
      }
      return;
    }
    const next = coveredIndexes().find((index) => !session.revealed.has(index));
    if (next !== undefined) {
      session.revealed.add(next);
      rerender(item);
      keepInView(document.querySelectorAll('#practice-body .word')[next]);
    }
  }

  // Bài dài: chỗ vừa mở nằm ngoài màn hình thì cuộn tới, còn trong màn hình thì giữ yên.
  function keepInView(node) {
    if (!node) return;
    const box = node.getBoundingClientRect();
    if (box.top < 72 || box.bottom > window.innerHeight - 48) window.scrollBy(0, box.top - window.innerHeight / 2);
  }

  function hiddenWords() {
    const count = TL.words(session.text).length;
    return new Set(TL.hideOrder(count, session.seed).slice(0, Math.round((count * session.level) / 100)));
  }

  function renderHide(item, body) {
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
              body.querySelector('.sheet').replaceWith(hideSheet(item));
              body.querySelector('#level-value').textContent = `${session.level}%`;
              body.querySelector('#open-count').textContent = openCountText();
            },
          }),
          el('span', { id: 'level-value' }, `${session.level}%`)),
        el('button', { class: 'btn', type: 'button', onclick: () => { session.seed += 1; session.revealed.clear(); rerender(item); } }, 'Che từ khác'),
        el('span', { id: 'open-count' }, openCountText())),
      hideSheet(item),
    );
  }

  function hideSheet(item) {
    const hidden = hiddenWords();
    return wordSheet((index, word) => {
      if (!hidden.has(index)) return { className: '', text: word, label: word };
      if (session.revealed.has(index)) return { className: 'shown', text: word, label: word };
      return { className: 'hidden', text: word, label: 'Từ đang che, bấm để hé' };
    }, (index) => revealWord(item, index));
  }

  function renderInitials(item, body) {
    fill(body,
      el('div', { class: 'tools' },
        el('button', { class: 'btn', type: 'button', onclick: () => { session.revealed.clear(); rerender(item); } }, 'Che lại hết'),
        el('span', {}, openCountText())),
      wordSheet((index, word) => (session.revealed.has(index)
        ? { className: 'shown', text: word, label: word }
        : { className: 'hint', text: TL.firstLetter(word), label: `Từ bắt đầu bằng ${TL.firstLetter(word)}, bấm để hé` }),
      (index) => revealWord(item, index)),
    );
  }

  function renderClusters(item, body) {
    const chunks = TL.clusters(session.text);
    const done = session.opened >= chunks.length;
    const nodes = chunks.slice(0, session.opened).map((chunk, index) => (
      index === session.opened - 1 ? el('span', { class: 'latest' }, chunk) : chunk));
    fill(body,
      el('div', { class: 'tools' }, el('span', {}, `Nhớ thầm cụm kế tiếp, rồi nhấn Space hoặc bấm vào khoảng trắng để mở. Đã mở ${session.opened}/${chunks.length} cụm.`)),
      el('div', { class: 'sheet tap' }, nodes.length > 0 ? nodes : el('span', { class: 'line-blank' }, 'Hãy nhớ thầm cụm đầu tiên.')),
      el('div', { class: 'row-actions' },
        el('button', {
          class: 'btn primary', type: 'button', disabled: done,
          onclick: () => { session.opened += 1; rerender(item); },
        }, done ? 'Đã hết bài' : 'Mở cụm kế tiếp'),
        el('button', {
          class: 'btn', type: 'button', disabled: session.opened === 0,
          onclick: () => { session.opened = 0; rerender(item); },
        }, 'Làm lại')),
    );
  }

  /* Trò chơi điền từ */

  function startBlanks() {
    const all = TL.words(session.text);
    const blanks = TL.pickBlanks(session.text, 0.3, session.seed);
    session.game = { all, blanks, pos: 0, wrongNow: new Set(), wrongBlanks: new Set(), choices: [] };
    prepareChoices();
  }

  function prepareChoices() {
    const g = session.game;
    if (g.pos < g.blanks.length) {
      // Bài quá ít từ khác nhau thì lấy thêm từ của cả bài làm từ nhiễu.
      g.choices = TL.wordChoices(g.all[g.blanks[g.pos]], g.all, session.seed + g.pos);
      g.wrongNow = new Set();
    }
  }

  function renderBlanks(item, body) {
    if (!session.game) startBlanks();
    const g = session.game;
    const blankSet = new Set(g.blanks);
    let index = -1;
    const nodes = TL.tokenize(session.text).map((token) => {
      if (token.type === 'sep') return token.text;
      index += 1;
      if (!blankSet.has(index)) return token.text;
      const position = g.blanks.indexOf(index);
      if (position < g.pos) {
        return el('span', { class: g.wrongBlanks.has(index) ? 'filled missed-word' : 'filled' }, token.text);
      }
      return el('span', {
        class: `blank${position === g.pos ? ' current' : ''}`,
        'aria-label': position === g.pos ? 'Chỗ trống đang điền' : 'Chỗ trống',
      }, ' '.repeat(Math.min(Array.from(token.text).length + 1, 9)));
    });
    const finished = g.pos >= g.blanks.length;
    const correct = g.blanks.length - g.wrongBlanks.size;
    const answer = finished ? '' : g.all[g.blanks[g.pos]];
    fill(body,
      el('div', { class: 'tools' }, el('span', {}, finished ? 'Đã điền xong.' : `Chỗ trống ${g.pos + 1}/${g.blanks.length}`)),
      el('div', { class: 'sheet' }, nodes),
      finished
        ? el('section', { 'aria-label': 'Kết quả' },
          el('p', { class: 'score-line' }, `${Math.round((correct / g.blanks.length) * 100)}%`),
          el('p', { class: 'score-sub' }, `Đúng ngay lần đầu ${correct}/${g.blanks.length} chỗ trống`),
          el('button', { class: 'btn', type: 'button', onclick: () => { session.seed = newSeed(); session.game = null; rerender(item); } }, 'Chơi lượt khác'))
        : el('div', { class: 'choices', role: 'group', 'aria-label': 'Chọn từ đúng' }, g.choices.map((choice) => el('button', {
          class: `btn choice${g.wrongNow.has(choice) ? ' wrong' : ''}`,
          type: 'button',
          disabled: g.wrongNow.has(choice),
          onclick: () => {
            if (choice === answer) {
              g.pos += 1;
              prepareChoices();
            } else {
              g.wrongNow.add(choice);
              if (!g.wrongBlanks.has(g.blanks[g.pos])) {
                g.wrongBlanks.add(g.blanks[g.pos]);
                item.missed = TL.addMissed(item.missed, [answer]);
                save();
              }
            }
            rerender(item);
          },
        }, choice))),
    );
  }

  /* Trò chơi xếp thứ tự */

  function renderOrder(item, body) {
    const parts = TL.pieces(session.text);
    if (parts.length < 2) {
      fill(body, el('div', { class: 'empty' },
        el('h2', {}, 'Đoạn này quá ngắn để xếp'),
        el('p', {}, 'Trò này cần ít nhất hai dòng, hai câu hoặc hai vế.')));
      return;
    }
    if (!session.game) {
      session.game = { order: TL.shuffledOrder(parts.length, session.seed), placed: [], mistakes: 0, shake: null };
    }
    const g = session.game;
    const finished = g.placed.length === parts.length;
    const remaining = g.order.filter((index) => !g.placed.includes(index));
    fill(body,
      el('div', { class: 'tools' }, el('span', {}, finished
        ? `Xong, sai ${g.mistakes} lần.`
        : `Bấm mảnh tiếp theo theo đúng thứ tự. Đã xếp ${g.placed.length}/${parts.length}.`)),
      el('ol', { class: 'placed' }, g.placed.map((index) => el('li', {}, parts[index]))),
      !finished && el('div', { class: 'pool', role: 'group', 'aria-label': 'Các mảnh chưa xếp' }, remaining.map((index) => el('button', {
        class: `piece${g.shake === index ? ' shake' : ''}`,
        type: 'button',
        onclick: () => {
          // So theo chữ để điệp khúc lặp lại mảnh nào cũng được tính là đúng.
          if (parts[index] === parts[g.placed.length]) {
            g.placed.push(index);
            g.shake = null;
          } else {
            g.mistakes += 1;
            g.shake = index;
          }
          rerender(item);
        },
      }, parts[index]))),
      finished && el('div', { class: 'row-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => { session.seed = newSeed(); session.game = null; rerender(item); } }, 'Xếp lại')),
    );
  }

  /* Luyện lời thoại */

  function renderScript(item, body) {
    const script = TL.parseScript(item.text);
    if (!script.isScript) {
      fill(body, el('div', { class: 'empty' },
        el('h2', {}, 'Bài này chưa có vai'),
        el('p', {}, 'Hãy viết mỗi lời thoại theo dạng “TÊN: lời thoại”, hoặc tên viết hoa ở một dòng và lời ở dòng sau.')));
      return;
    }
    if (!session.game) session.game = { role: script.roles[0], cursor: 0, open: false };
    const g = session.game;
    const { entries } = script;
    const current = entries[g.cursor];
    const isMine = current && current.role === g.role;
    const finished = g.cursor >= entries.length;

    const restart = () => {
      stopSpeaking();
      g.cursor = 0;
      g.open = false;
      playIfOther(item);
    };
    const advance = () => {
      if (isMine && !g.open) {
        g.open = true;
      } else {
        g.cursor += 1;
        g.open = false;
        playIfOther(item);
      }
      rerender(item);
      const last = document.querySelector('.script-line:last-child');
      if (last) last.scrollIntoView({ block: 'nearest' });
    };

    fill(body,
      el('div', { class: 'tools' },
        el('label', {}, 'Vai của bạn',
          select('Chọn vai', g.role, script.roles.map((name) => [name, name]), (value) => {
            g.role = value;
            restart();
            rerender(item);
          })),
        'speechSynthesis' in window && el('label', {},
          el('input', {
            type: 'checkbox', checked: prefs.speakOthers,
            onchange: (event) => {
              prefs.speakOthers = event.target.checked;
              savePrefs();
              if (!prefs.speakOthers) stopSpeaking();
            },
          }),
          'Đọc to vai khác'),
        el('span', {}, 'Nhấn Space để đi tiếp.')),
      el('div', { class: 'script' }, entries.slice(0, g.cursor + 1).map((entry, index) => {
        const mine = entry.role === g.role;
        const covered = mine && index === g.cursor && !g.open;
        return el('div', { class: `script-line${mine ? ' mine' : ''}` },
          el('span', { class: 'script-role' }, entry.role || ' '),
          el('p', {}, covered ? TL.tokenize(entry.text).map((t) => (t.type === 'word' ? TL.firstLetter(t.text) : t.text)).join('') : entry.text));
      })),
      el('div', { class: 'row-actions' },
        finished
          ? el('button', { class: 'btn primary', type: 'button', onclick: () => { restart(); rerender(item); } }, 'Tập lại từ đầu')
          : el('button', { class: 'btn primary', type: 'button', 'data-advance': true, onclick: advance }, isMine && !g.open ? 'Hiện lời của tôi' : 'Tiếp'),
        !finished && g.cursor > 0 && el('button', { class: 'btn', type: 'button', onclick: () => { restart(); rerender(item); } }, 'Làm lại')),
    );
  }

  function playIfOther(item) {
    if (!prefs.speakOthers || !('speechSynthesis' in window)) return;
    const g = session.game;
    const entry = TL.parseScript(item.text).entries[g.cursor];
    if (entry && entry.role !== g.role) speak(entry.text);
  }

  function intervalPreview(srs, rating) {
    if (rating === 0) return '10 phút';
    return `${TL.review(srs, rating, Date.now()).interval} ngày`;
  }

  function renderRating(item) {
    return el('section', { class: 'rate' },
      el('h2', {}, 'Ôn xong cả bài, bạn nhớ thế nào?'),
      el('p', { class: 'item-meta' }, 'Chọn một mức để app hẹn ngày ôn lại.'),
      el('div', { class: 'rate-grid' }, RATINGS.map((rating) => el('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const now = Date.now();
          item.srs = TL.review(item.srs, rating.value, now);
          item.updatedAt = now;
          logActivity(now);
          save();
          toast(`Đã ghi nhận. ${dueText(item.srs, now)}.`);
          location.hash = '#/';
        },
      }, rating.label, el('small', {}, intervalPreview(item.srs, rating.value))))));
  }

  /* Sao lưu */

  document.getElementById('btn-export').addEventListener('click', () => {
    const payload = JSON.stringify({ app: 'thuoc-long', version: 2, exportedAt: new Date().toISOString(), ...store }, null, 2);
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
      store.log = TL.mergeLog(store.log, parsed.log);
      store.days.forEach((day) => { if (!store.log[day]) store.log[day] = 1; });
      save();
      toast(`Thêm ${merged.added} bài, cập nhật ${merged.updated} bài, bỏ qua ${raw.length - merged.added - merged.updated} bài.`);
      route();
    } catch (error) {
      toast('File này không phải bản sao lưu hợp lệ. Dữ liệu hiện tại không đổi.');
    }
  });

  /* Điều hướng */

  function setNav(active) {
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.dataset.nav === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function route() {
    const match = location.hash.match(/^#\/bai\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (match) {
      renderPractice(decodeURIComponent(match[1]), match[2], match[3]);
    } else {
      stopSpeaking();
      if (location.hash === '#/tien-do') renderProgress();
      else renderHome();
    }
    window.scrollTo(0, 0);
  }

  const REVEAL_MODES = ['che-it', 'che-nhieu', 'chu-dau', 'tung-cum'];

  // Phím Space làm cùng việc với bấm khoảng trắng; giữ phím vẫn chỉ mở một ô.
  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' || !session || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!REVEAL_MODES.includes(session.mode) && session.mode !== 'loi-thoai') return;
    const { target } = event;
    if (target.closest('textarea, select, summary, dialog') || (target.matches('input') && !target.matches('[type="range"]'))) return;
    event.preventDefault();
    // Bỏ tiêu điểm để Space không kích hoạt nút vừa bấm, ví dụ "Che từ khác".
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (event.repeat) return;
    if (session.mode === 'loi-thoai') {
      const next = document.querySelector('[data-advance]');
      if (next) next.click();
      return;
    }
    const item = findItem(session.id);
    if (item) revealNext(item);
  });

  // Bấm vào khoảng trắng bất kỳ của màn luyện thì mở ô kế tiếp, không cần nhắm đúng ô che.
  document.addEventListener('click', (event) => {
    if (!session || !REVEAL_MODES.includes(session.mode)) return;
    if (event.target.closest('a, button, input, select, textarea, label, summary, dialog, .topbar, .rate')) return;
    if (String(window.getSelection())) return;
    const item = findItem(session.id);
    if (item) revealNext(item);
  });

  window.addEventListener('hashchange', route);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  route();
})();
