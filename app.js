// 剣道部 練習試合記録アプリ（オフライン対応）
(() => {
  'use strict';

  const LS = { pass: 'kr_pass', queue: 'kr_queue', cache: 'kr_cache', last: 'kr_last', name: 'kr_name' };
  const FORMATS = ['個人戦', '団体戦'];
  const POSITIONS = ['先鋒', '次鋒', '中堅', '副将', '大将'];
  const TECHS = [['メ', 'メン'], ['コ', 'コテ'], ['ド', 'ドウ'], ['ツ', 'ツキ'], ['反', '反則']];
  const RESULTS = ['二本勝ち', '一本勝ち', '延長勝ち', '判定勝ち', '引き分け',
                   '判定負け', '延長負け', '一本負け', '二本負け'];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- 端末内の保存 ----
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let pass = load(LS.pass, '');
  let queue = load(LS.queue, []);               // 未送信の記録
  let cache = load(LS.cache, { members: [], records: [] });
  let form = { format: '個人戦', position: '', points: [], result: '', resultManual: false };
  let syncing = false;

  // ---- 表示切り替え ----
  function showLock(msg) {
    $('lock').classList.remove('hidden');
    $('appView').classList.add('hidden');
    $('passMsg').textContent = msg || '';
  }
  function showApp() {
    $('lock').classList.add('hidden');
    $('appView').classList.remove('hidden');
  }

  $('passBtn').onclick = () => {
    const v = $('passInput').value.trim();
    if (!v) return;
    pass = v; save(LS.pass, pass);
    showApp(); renderAll(); sync();
  };

  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    ['input', 'list', 'stats'].forEach(t => $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
    window.scrollTo(0, 0);
  });

  let toastTimer;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400);
  }

  // ---- 入力フォーム ----
  function chips(el, items, current, onPick, cls) {
    el.innerHTML = items.map(v =>
      `<button type="button" class="chip ${cls ? cls(v) : ''} ${v === current ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`
    ).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.v));
  }

  function renderForm() {
    chips($('fFormat'), FORMATS, form.format, v => {
      form.format = v; if (v === '個人戦') form.position = ''; renderForm();
    });
    $('posWrap').classList.toggle('hidden', form.format !== '団体戦');
    chips($('fPos'), POSITIONS, form.position, v => {
      form.position = form.position === v ? '' : v; renderForm();
    });
    chips($('fResult'), RESULTS, form.result, v => {
      form.result = v; form.resultManual = true; renderForm();
    }, v => v.includes('勝') ? 'r-win' : v.includes('負') ? 'r-lose' : '');

    // 得点の順番表示
    const seq = form.points.map((p, i) => {
      const me = p.startsWith('自分');
      return `<span class="p ${me ? 'me' : 'op'}">${'①②③'[i]} ${me ? '自' : '相'}${esc(short(p))}</span>`;
    }).join('');
    $('seq').innerHTML = (seq || '<span class="none">一本も入っていなければ押さなくてOK</span>') +
      (form.points.length ? '<button type="button" class="undo" id="undoBtn">1つ戻す</button>' : '');
    if (form.points.length) $('undoBtn').onclick = () => { form.points.pop(); autoResult(); renderForm(); };
  }

  function buildPad() {
    const row = (who, cls) => `<div class="who" style="color:var(--${cls === 'me' ? 'win' : 'lose'})">${who}</div>` +
      TECHS.map(([s, full]) => `<button type="button" class="${cls}" data-p="${who}：${full}">${s}</button>`).join('');
    $('ptsPad').innerHTML = row('自分', 'me') + row('相手', 'op');
    $('ptsPad').querySelectorAll('button').forEach(b => b.onclick = () => {
      if (form.points.length >= 3) { toast('一本は3つまでです'); return; }
      form.points.push(b.dataset.p); autoResult(); renderForm();
    });
  }

  const short = p => { const t = TECHS.find(([, full]) => p.endsWith(full)); return t ? t[0] : p; };

  // 得点から結果を自動で仮選択（手で選んだ後は変えない）
  function autoResult() {
    if (form.resultManual) return;
    const me = form.points.filter(p => p.startsWith('自分')).length;
    const op = form.points.length - me;
    form.result = me >= 2 ? '二本勝ち' : op >= 2 ? '二本負け'
      : me === 1 && op === 0 ? '一本勝ち' : op === 1 && me === 0 ? '一本負け' : '引き分け';
  }

  function renderNames() {
    const members = cache.members || [];
    const last = load(LS.name, '');
    $('fName').innerHTML = '<option value="">選んでください</option>' +
      members.map(m => `<option ${m === last ? 'selected' : ''}>${esc(m)}</option>`).join('') +
      (members.length ? '' : '<option disabled>（部員一覧はオンライン時に読み込まれます）</option>');
    const cur = $('lName').value;
    $('lName').innerHTML = '<option value="">全員</option>' +
      members.map(m => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
    const schools = [...new Set(allRecords().map(r => r.school).filter(Boolean))];
    $('schoolList').innerHTML = schools.map(s => `<option value="${esc(s)}">`).join('');
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const newId = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2));

  $('saveBtn').onclick = () => {
    const rec = {
      id: newId(),
      date: $('fDate').value.replace(/-/g, '/'),
      school: $('fSchool').value.trim(),
      format: form.format,
      position: form.format === '団体戦' ? form.position : '',
      name: $('fName').value,
      opponent: $('fOpp').value.trim(),
      p1: form.points[0] || '', p2: form.points[1] || '', p3: form.points[2] || '',
      result: form.result,
      time: $('fTime').value.trim()
    };
    const miss = [];
    if (!rec.date) miss.push('日付');
    if (!rec.school) miss.push('相手校');
    if (!rec.name) miss.push('自分の名前');
    if (!rec.opponent) miss.push('相手の名前');
    if (!rec.result) miss.push('結果');
    if (miss.length) { toast(miss.join('・') + 'を入力してください'); return; }

    queue.push(rec); save(LS.queue, queue); save(LS.name, rec.name);
    // 次の試合用にリセット（日付・相手校・形式・名前は残す）
    form.points = []; form.result = ''; form.resultManual = false; form.position = '';
    $('fOpp').value = ''; $('fTime').value = '';
    renderAll();
    toast(navigator.onLine && GAS_URL ? '記録しました。送信中…' : '記録しました（電波が戻ったら自動で送信します）');
    sync();
  };

  // ---- 一覧 ----
  function allRecords() {
    const sentIds = new Set(cache.records.map(r => r.id));
    const pending = queue.filter(r => !sentIds.has(r.id)).map(r => ({ ...r, pending: true }));
    return [...pending, ...cache.records];
  }
  const kind = r => r.result.includes('勝') ? 'win' : r.result.includes('負') ? 'lose' : 'draw';

  function renderList() {
    const n = $('lName').value, s = $('lSchool').value.trim();
    const rows = allRecords()
      .filter(r => (!n || r.name === n) && (!s || (r.school || '').includes(s)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.pending ? 1 : 0) - (a.pending ? 1 : 0));
    if (!rows.length) { $('list').innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
    $('list').innerHTML = rows.map(r => {
      const pts = [r.p1, r.p2, r.p3].filter(Boolean)
        .map(p => `<span class="mini ${p.startsWith('自分') ? 'me' : 'op'}">${esc(short(p))}</span>`).join('');
      const fmt = r.format + (r.position ? '・' + r.position : '');
      return `<div class="rec ${kind(r)}">
        <div class="top"><span>${esc(r.date)}　${esc(r.school)}</span><span>${esc(fmt)}</span></div>
        <div class="vs">${esc(r.name)} <small>対</small> ${esc(r.opponent)}</div>
        <div class="bot">${pts || '<span class="hint" style="margin:0">一本なし</span>'}
          ${r.time ? `<span class="hint" style="margin:0 0 0 4px">${esc(r.time)}</span>` : ''}
          ${r.pending ? '<span class="badge">未送信</span>' : ''}
          <span class="res">${esc(r.result)}</span></div></div>`;
    }).join('');
  }
  $('lName').onchange = renderList;
  $('lSchool').oninput = renderList;

  // ---- 成績 ----
  function renderStats() {
    const recs = allRecords();
    const names = [...new Set([...(cache.members || []), ...recs.map(r => r.name)])].filter(Boolean);
    const count = (list, who) => {
      const c = {}; TECHS.forEach(([s]) => c[s] = 0);
      list.forEach(r => [r.p1, r.p2, r.p3].forEach(p => { if (p && p.startsWith(who)) c[short(p)]++; }));
      return TECHS.map(([s]) => `${s}${c[s]}`).join(' ');
    };
    $('statsBody').innerHTML = names.map(nm => {
      const mine = recs.filter(r => r.name === nm);
      const { w, l, d, rate } = wld(mine);
      return `<tr><td class="n"><button type="button" data-n="${esc(nm)}">${esc(nm)}</button></td><td>${mine.length}</td><td>${w}</td><td>${l}</td><td>${d}</td><td>${rate}</td></tr>` +
        (mine.length ? `<tr><td colspan="6" class="tech">取った技：${count(mine, '自分')}<br>取られた技：${count(mine, '相手')}</td></tr>` : '');
    }).join('') || '<tr><td colspan="6" class="empty">まだ記録がありません</td></tr>';
    $('statsBody').querySelectorAll('button[data-n]').forEach(b => b.onclick = () => {
      $('sName').value = b.dataset.n; renderDetail(); window.scrollTo(0, 0);
    });

    const cur = $('sName').value;
    $('sName').innerHTML = '<option value="">全員の一覧</option>' +
      names.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
    renderDetail();
  }

  function wld(list) {
    const w = list.filter(r => kind(r) === 'win').length;
    const l = list.filter(r => kind(r) === 'lose').length;
    return { w, l, d: list.length - w - l, rate: (w + l) ? Math.round(w / (w + l) * 100) + '%' : '-' };
  }

  // 個人の詳細：技ごとの割合
  function renderDetail() {
    const nm = $('sName').value;
    $('detail').classList.toggle('hidden', !nm);
    $('overview').classList.toggle('hidden', !!nm);
    if (!nm) return;
    const mine = allRecords().filter(r => r.name === nm);
    const { w, l, d, rate } = wld(mine);

    const block = (who, title, color) => {
      const c = {}; TECHS.forEach(([, full]) => c[full] = 0);
      mine.forEach(r => [r.p1, r.p2, r.p3].forEach(p => {
        if (p && p.startsWith(who)) { const t = TECHS.find(([, f]) => p.endsWith(f)); if (t) c[t[1]]++; }
      }));
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      const rows = TECHS.map(([, f]) => [f, c[f]]).sort((a, b) => b[1] - a[1]);
      const max = rows[0][1];
      const body = total ? rows.map(([f, n]) => {
        const pct = Math.round(n / total * 100);
        return `<div class="bar ${n && n === max ? 'top' : ''}"><span class="lb">${f}</span>
          <span class="tr"><span class="fl" style="width:${pct}%;background:${color}"></span></span>
          <span class="vl">${pct}% <small>${n}本</small></span></div>`;
      }).join('') + `<p class="note">いちばん多いのは<b style="color:${color}">${rows.filter(r => r[1] === max).map(r => r[0]).join('・')}</b>（${Math.round(max / total * 100)}%）</p>`
        : '<div class="empty" style="padding:12px 0">まだ記録がありません</div>';
      return `<div class="card"><div class="dh"><h3 style="color:${color}">${title}</h3><small>合計 ${total}本</small></div>${body}</div>`;
    };

    $('detail').innerHTML = `
      <div class="card"><div class="sum">
        <div><b>${mine.length}</b><span>試合</span></div><div><b style="color:var(--win)">${w}</b><span>勝</span></div>
        <div><b style="color:var(--lose)">${l}</b><span>負</span></div><div><b>${d}</b><span>分</span></div>
        <div><b>${rate}</b><span>勝率</span></div></div></div>
      ${block('自分', '取った技', 'var(--win)')}
      ${block('相手', '取られた技', 'var(--lose)')}
      <p class="hint">割合は、その部員が取った（取られた）一本の合計に対する割合です。</p>`;
  }
  $('sName').onchange = () => { renderDetail(); window.scrollTo(0, 0); };

  // ---- 状態表示 ----
  function renderStatus() {
    const online = navigator.onLine;
    $('netPill').textContent = online ? 'オンライン' : 'オフライン';
    $('netPill').classList.toggle('off', !online);
    $('pendPill').textContent = `未送信 ${queue.length}件`;
    $('pendPill').classList.toggle('hidden', !queue.length);
    const last = load(LS.last, '');
    $('syncText').textContent = syncing ? '同期中…' : last ? `最終更新 ${last}` : '';
    $('cfgWarn').classList.toggle('hidden', !!GAS_URL);
  }

  function renderAll() { renderStatus(); renderForm(); renderNames(); renderList(); renderStats(); }

  // ---- 送受信 ----
  async function sync(manual) {
    if (syncing || !GAS_URL || !pass) return;
    if (!navigator.onLine) { if (manual) toast('オフラインです。電波が戻ったら自動で送信します'); return; }
    syncing = true; renderStatus();
    try {
      if (queue.length) {
        const res = await fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: pass, records: queue })
        }).then(r => r.json());
        if (!res.ok) throw new Error(res.error);
        const done = new Set(res.saved);
        queue = queue.filter(r => !done.has(r.id)); save(LS.queue, queue);
      }
      const data = await fetch(GAS_URL + '?key=' + encodeURIComponent(pass)).then(r => r.json());
      if (!data.ok) throw new Error(data.error);
      cache = { members: data.members, records: data.records }; save(LS.cache, cache);
      const d = new Date();
      save(LS.last, `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
      if (manual) toast('最新の状態になりました');
    } catch (e) {
      if (e.message === 'auth') {
        pass = ''; save(LS.pass, '');
        syncing = false;
        showLock('パスコードが違います。もう一度入力してください（未送信の記録は消えていません）');
        return;
      }
      if (manual) toast('送信できませんでした。電波の良い場所で「更新」を押してください');
    } finally {
      syncing = false;
      renderAll();
    }
  }

  $('syncBtn').onclick = () => sync(true);
  window.addEventListener('online', () => { renderStatus(); sync(); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(() => { if (!document.hidden && queue.length) sync(); }, 60000);

  // ---- 起動 ----
  $('fDate').value = today();
  buildPad();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (pass) { showApp(); renderAll(); sync(); } else { showLock(); }
})();
