// 剣道部 練習試合記録アプリ（オフライン対応）
(() => {
  'use strict';

  const LS = { pass: 'kr_pass', queue: 'kr_queue', cache: 'kr_cache', last: 'kr_last', name: 'kr_name',
               team: 'kr_team', draft: 'kr_teamdraft', fmt: 'kr_format' };
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
  let format = load(LS.fmt, '個人戦');
  let form = { points: [], result: '', resultManual: false };   // 個人戦
  const emptySlot = () => ({ name: '', opp: '', points: [], result: '', manual: false, time: '' });
  let team = load(LS.draft, null) || { cur: 0, slots: POSITIONS.map(emptySlot) };  // 団体戦
  let syncing = false;
  const saveDraft = () => save(LS.draft, team);

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
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
  }

  // ---- 共通部品 ----
  const short = p => { const t = TECHS.find(([, full]) => p.endsWith(full)); return t ? t[0] : p; };
  const isMe = p => p.startsWith('自分');
  const kind = r => (r.result || '').includes('勝') ? 'win' : (r.result || '').includes('負') ? 'lose' : 'draw';

  function chips(el, items, current, onPick, cls) {
    el.innerHTML = items.map(v =>
      `<button type="button" class="chip ${cls ? cls(v) : ''} ${v === current ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`
    ).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.v));
  }
  const resultCls = v => v.includes('勝') ? 'r-win' : v.includes('負') ? 'r-lose' : '';

  function buildPad(el, onPress) {
    const row = (who, cls) => `<div class="who" style="color:var(--${cls === 'me' ? 'win' : 'lose'})">${who}</div>` +
      TECHS.map(([s, full]) => `<button type="button" class="${cls}" data-p="${who}：${full}">${s}</button>`).join('');
    el.innerHTML = row('自分', 'me') + row('相手', 'op');
    el.querySelectorAll('button').forEach(b => b.onclick = () => onPress(b.dataset.p));
  }

  function renderSeq(el, points, onUndo) {
    const seq = points.map((p, i) =>
      `<span class="p ${isMe(p) ? 'me' : 'op'}">${'①②③'[i]} ${isMe(p) ? '自' : '相'}${esc(short(p))}</span>`).join('');
    el.innerHTML = (seq || '<span class="none">一本も入っていなければ押さなくてOK</span>') +
      (points.length ? '<button type="button" class="undo">1つ戻す</button>' : '');
    if (points.length) el.querySelector('.undo').onclick = onUndo;
  }

  // 得点から結果を自動で仮選択
  function autoResultOf(points) {
    const me = points.filter(isMe).length;
    const op = points.length - me;
    return me >= 2 ? '二本勝ち' : op >= 2 ? '二本負け'
      : me === 1 && op === 0 ? '一本勝ち' : op === 1 && me === 0 ? '一本負け' : '引き分け';
  }

  // ---- 試合形式・共通欄 ----
  function renderFormat() {
    chips($('fFormat'), FORMATS, format, v => { format = v; save(LS.fmt, v); renderFormat(); renderTeam(); });
    const isTeam = format === '団体戦';
    $('teamWrap').classList.toggle('hidden', !isTeam);
    $('indivWrap').classList.toggle('hidden', isTeam);
    $('teamNameWrap').classList.toggle('hidden', !isTeam);
    $('schoolLabel').innerHTML = (isTeam ? '相手チーム名' : '相手校') + '<span class="req">必須</span>';
  }

  // ---- 個人戦フォーム ----
  function renderForm() {
    chips($('fResult'), RESULTS, form.result, v => { form.result = v; form.resultManual = true; renderForm(); }, resultCls);
    renderSeq($('seq'), form.points, () => {
      form.points.pop(); if (!form.resultManual) form.result = form.points.length ? autoResultOf(form.points) : ''; renderForm();
    });
  }
  buildPad($('ptsPad'), p => {
    if (form.points.length >= 3) { toast('一本は3つまでです'); return; }
    form.points.push(p); if (!form.resultManual) form.result = autoResultOf(form.points); renderForm();
  });

  function memberOptions(sel, current, placeholder) {
    const members = cache.members || [];
    const list = current && !members.includes(current) ? [...members, current] : members;
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      list.map(m => `<option ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('') +
      (members.length ? '' : '<option disabled>（部員一覧はオンライン時に読み込まれます）</option>');
  }

  function renderNames() {
    memberOptions($('fName'), $('fName').value || load(LS.name, ''), '選んでください');
    const cur = $('lName').value;
    $('lName').innerHTML = '<option value="">全員</option>' +
      (cache.members || []).map(m => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
    const recs = allRecords();
    $('schoolList').innerHTML = [...new Set(recs.map(r => r.school).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('');
    $('eventList').innerHTML = [...new Set(recs.map(r => r.event).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('');
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function commonFields(miss) {
    const c = { date: $('fDate').value.replace(/-/g, '/'), school: $('fSchool').value.trim(), event: $('fEvent').value.trim() };
    if (!c.date) miss.push('日付');
    if (!c.school) miss.push(format === '団体戦' ? '相手チーム名' : '相手校');
    return c;
  }

  function enqueue(recs, msg) {
    queue.push(...recs); save(LS.queue, queue);
    renderAll();
    toast(navigator.onLine && GAS_URL ? msg + '送信中…' : msg + '（電波が戻ったら自動で送信します）');
    sync();
  }

  $('saveBtn').onclick = () => {
    const miss = [];
    const c = commonFields(miss);
    const rec = {
      id: newId(), ...c, format: '個人戦', position: '', team: '', matchId: '',
      name: $('fName').value, opponent: $('fOpp').value.trim(),
      p1: form.points[0] || '', p2: form.points[1] || '', p3: form.points[2] || '',
      result: form.result, time: $('fTime').value.trim()
    };
    if (!rec.name) miss.push('自分の名前');
    if (!rec.opponent) miss.push('相手の名前');
    if (!rec.result) miss.push('結果');
    if (miss.length) { toast(miss.join('・') + 'を入力してください'); return; }
    save(LS.name, rec.name);
    form = { points: [], result: '', resultManual: false };
    $('fOpp').value = ''; $('fTime').value = '';
    enqueue([rec], '記録しました。');
  };

  // ---- 団体戦スコアシート ----
  // slots: [{name, opp, points, result}] 形式で受け取り、スコアシートのHTMLを返す
  function sheetHTML(slots, o) {
    o = o || {};
    const W = slots.filter(s => s.name && kind(s) === 'win').length;
    const L = slots.filter(s => s.name && kind(s) === 'lose').length;
    const ipMe = slots.reduce((a, s) => a + (s.points || []).filter(isMe).length, 0);
    const ipOp = slots.reduce((a, s) => a + (s.points || []).filter(p => !isMe(p)).length, 0);
    const cls = i => [o.edit ? 'click' : '', o.sel === i ? 'sel' : '', o.hl === i ? 'hl' : ''].join(' ');
    const marks = (s, me) => {
      const pts = s.points || [];
      const html = pts.map((p, i) => isMe(p) === me
        ? (i === 0 ? `<span class="fst">${esc(short(p))}</span>` : esc(short(p))) : '').join('');
      if (html) return html;
      return me && s.name && s.result && kind(s) === 'draw' && !pts.length ? '<span class="dim">×</span>' : '';
    };
    const nameCell = (s, me) => {
      const k = s.name ? kind(s) : '';
      const c = !s.result ? '' : me ? (k === 'win' ? 'w' : '') : (k === 'lose' ? 'l' : '');
      const v = me ? s.name : s.opp;
      return { c, v: v ? esc(v) : (o.edit ? '<span class="dim">―</span>' : '') };
    };
    const head = slots.map((_, i) => `<th class="${cls(i)}" data-i="${i}">${POSITIONS[i]}</th>`).join('');
    const row = (fn, rc) => slots.map((s, i) => { const r = fn(s, i); return `<td class="${rc} ${r.c || ''} ${cls(i)}" data-i="${i}">${r.v}</td>`; }).join('');
    const html = `<table class="ss"><colgroup><col class="lab">${slots.map(() => '<col>').join('')}<col class="win"></colgroup>
      <thead><tr><th class="lh">チーム</th>${head}<th>勝数</th></tr></thead><tbody>
      <tr><td class="tm" rowspan="2">${vert(o.team || '自チーム')}</td>${row(s => nameCell(s, true), 'nm')}<td class="ws" rowspan="2">${W}<small>${ipMe}本</small></td></tr>
      <tr>${row(s => ({ v: marks(s, true) }), 'mk me')}</tr>
      <tr><td class="tm" rowspan="2">${vert(o.opp || '相手')}</td>${row(s => ({ v: marks(s, false) }), 'mk op')}<td class="ws" rowspan="2">${L}<small>${ipOp}本</small></td></tr>
      <tr>${row(s => nameCell(s, false), 'nm')}</tr></tbody></table>`;
    const tr = W > L ? 'win' : W < L ? 'lose' : ipMe > ipOp ? 'win' : ipMe < ipOp ? 'lose' : 'draw';
    const label = { win: '勝ち', lose: '負け', draw: '引き分け' }[tr];
    const any = slots.some(s => s.name && s.result);
    return { html, W, L, ipMe, ipOp, tr, label, any };
  }

  // チーム名を1文字ずつ縦に並べる（長い名前は6文字まで）
  const vert = t => { const a = [...String(t)]; return (a.length > 6 ? a.slice(0, 5).concat('…') : a).map(esc).join('<br>'); };

  function slotsFromRecords(recs) {
    return POSITIONS.map(pos => {
      const r = recs.find(x => x.position === pos);
      return r ? { name: r.name, opp: r.opponent, points: [r.p1, r.p2, r.p3].filter(Boolean), result: r.result, time: r.time }
               : { name: '', opp: '', points: [], result: '' };
    });
  }

  function renderTeam() {
    if (format !== '団体戦') return;
    const sh = sheetHTML(team.slots, { edit: true, sel: team.cur, team: $('fTeam').value.trim(), opp: $('fSchool').value.trim() });
    $('sheet').innerHTML = sh.html + (sh.any
      ? `<div class="teamres"><span>勝者数 <b>${sh.W}−${sh.L}</b></span><span>本数 <b>${sh.ipMe}−${sh.ipOp}</b></span><span class="r ${sh.tr}">${sh.label}</span></div>` : '');
    $('sheet').querySelectorAll('[data-i]').forEach(c => c.onclick = () => { team.cur = +c.dataset.i; saveDraft(); renderTeam(); });

    const s = team.slots[team.cur];
    $('slotTitle').textContent = POSITIONS[team.cur] + 'の試合';
    $('slotStep').textContent = `${team.cur + 1} / 5`;
    memberOptions($('tName'), s.name, '選んでください（欠員なら空欄）');
    if (document.activeElement !== $('tOpp')) $('tOpp').value = s.opp;
    if (document.activeElement !== $('tTime')) $('tTime').value = s.time;
    renderSeq($('tSeq'), s.points, () => {
      s.points.pop(); if (!s.manual) s.result = s.points.length ? autoResultOf(s.points) : ''; saveDraft(); renderTeam();
    });
    chips($('tResult'), RESULTS, s.result, v => { s.result = v; s.manual = true; saveDraft(); renderTeam(); }, resultCls);
    $('prevBtn').disabled = team.cur === 0;
    $('nextBtn').disabled = team.cur === POSITIONS.length - 1;
  }

  buildPad($('tPad'), p => {
    const s = team.slots[team.cur];
    if (s.points.length >= 3) { toast('一本は3つまでです'); return; }
    s.points.push(p); if (!s.manual) s.result = autoResultOf(s.points); saveDraft(); renderTeam();
  });
  $('tName').onchange = () => { team.slots[team.cur].name = $('tName').value; saveDraft(); renderTeam(); };
  $('tOpp').oninput = () => { team.slots[team.cur].opp = $('tOpp').value; saveDraft(); renderTeam(); };
  $('tTime').oninput = () => { team.slots[team.cur].time = $('tTime').value; saveDraft(); };
  $('fTeam').oninput = () => { save(LS.team, $('fTeam').value); renderTeam(); };
  $('fSchool').addEventListener('input', renderTeam);
  const move = d => { team.cur = Math.max(0, Math.min(4, team.cur + d)); saveDraft(); renderTeam();
    $('slotCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('prevBtn').onclick = () => move(-1);
  $('nextBtn').onclick = () => move(1);
  $('teamClearBtn').onclick = () => {
    if (!confirm('入力中の団体戦の内容をすべて消しますか？')) return;
    team = { cur: 0, slots: POSITIONS.map(emptySlot) }; saveDraft(); renderTeam();
  };

  $('teamSaveBtn').onclick = () => {
    const miss = [];
    const c = commonFields(miss);
    const teamName = $('fTeam').value.trim();
    if (!teamName) miss.push('自チーム名');
    const used = team.slots.map((s, i) => ({ s, i })).filter(x => x.s.name);
    if (!used.length) miss.push('自チームの選手');
    used.forEach(({ s, i }) => {
      if (!s.opp.trim()) miss.push(POSITIONS[i] + 'の相手選手');
      if (!s.result) miss.push(POSITIONS[i] + 'の結果');
    });
    const stray = team.slots.findIndex(s => !s.name && (s.opp || s.points.length));
    if (stray >= 0) miss.push(POSITIONS[stray] + 'の自チームの選手');
    if (miss.length) { toast(miss.join('・') + 'を入力してください'); return; }
    const names = used.map(x => x.s.name);
    if (new Set(names).size !== names.length) { toast('同じ選手が2つのポジションに入っています'); return; }

    const matchId = newId();
    const recs = used.map(({ s, i }) => ({
      id: newId(), ...c, format: '団体戦', position: POSITIONS[i], team: teamName, matchId,
      name: s.name, opponent: s.opp.trim(),
      p1: s.points[0] || '', p2: s.points[1] || '', p3: s.points[2] || '',
      result: s.result, time: (s.time || '').trim()
    }));
    team = { cur: 0, slots: POSITIONS.map(emptySlot) }; saveDraft();
    enqueue(recs, `団体戦（${recs.length}試合）を記録しました。`);
    window.scrollTo(0, 0);
  };

  // ---- 一覧 ----
  function allRecords() {
    const sentIds = new Set(cache.records.map(r => r.id));
    const pending = queue.filter(r => !sentIds.has(r.id)).map(r => ({ ...r, pending: true }));
    return [...pending, ...cache.records];
  }

  function renderList() {
    const n = $('lName').value, s = $('lSchool').value.trim();
    const recs = allRecords();
    // 団体戦はひとまとめにする
    const items = [], groups = {};
    recs.forEach(r => {
      if (r.matchId) {
        if (!groups[r.matchId]) { groups[r.matchId] = { team: true, recs: [], date: r.date }; items.push(groups[r.matchId]); }
        groups[r.matchId].recs.push(r);
      } else items.push({ team: false, rec: r, date: r.date });
    });
    const shown = items.filter(it => {
      const list = it.team ? it.recs : [it.rec];
      return (!n || list.some(r => r.name === n)) && (!s || (list[0].school || '').includes(s));
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!shown.length) { $('list').innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }

    $('list').innerHTML = shown.map(it => {
      if (it.team) {
        const f = it.recs[0];
        const slots = slotsFromRecords(it.recs);
        const hl = n ? slots.findIndex(x => x.name === n) : -1;
        const sh = sheetHTML(slots, { team: f.team || '自チーム', opp: f.school, hl });
        const pend = it.recs.some(r => r.pending);
        return `<div class="rec team ${sh.tr}">
          <div class="top"><span>${esc(f.date)}　${esc(f.event || '')}</span><span>団体戦${pend ? ' <span class="badge">未送信</span>' : ''}</span></div>
          <div class="vs" style="margin-bottom:6px">${esc(f.team)} <small>対</small> ${esc(f.school)}
            <span class="res" style="float:right;color:var(--${sh.tr === 'win' ? 'win' : sh.tr === 'lose' ? 'lose' : 'draw'})">${sh.W}−${sh.L} ${sh.label}</span></div>
          ${sh.html}</div>`;
      }
      const r = it.rec;
      const pts = [r.p1, r.p2, r.p3].filter(Boolean)
        .map(p => `<span class="mini ${isMe(p) ? 'me' : 'op'}">${esc(short(p))}</span>`).join('');
      const fmt = r.format + (r.position ? '・' + r.position : '');
      return `<div class="rec ${kind(r)}">
        <div class="top"><span>${esc(r.date)}　${esc(r.school)}${r.event ? '（' + esc(r.event) + '）' : ''}</span><span>${esc(fmt)}</span></div>
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
  function wld(list) {
    const w = list.filter(r => kind(r) === 'win').length;
    const l = list.filter(r => kind(r) === 'lose').length;
    return { w, l, d: list.length - w - l, rate: (w + l) ? Math.round(w / (w + l) * 100) + '%' : '-' };
  }

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

  // 個人の詳細：技ごとの割合（個人戦・団体戦の両方を含む）
  function renderDetail() {
    const nm = $('sName').value;
    $('detail').classList.toggle('hidden', !nm);
    $('overview').classList.toggle('hidden', !!nm);
    if (!nm) return;
    const mine = allRecords().filter(r => r.name === nm);
    const { w, l, d, rate } = wld(mine);
    const nTeam = mine.filter(r => r.format === '団体戦').length;

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
        <div><b>${rate}</b><span>勝率</span></div></div>
        <p class="hint" style="text-align:center;margin:8px 0 0">個人戦 ${mine.length - nTeam}試合・団体戦 ${nTeam}試合</p></div>
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

  function renderAll() {
    renderStatus(); renderFormat(); renderForm(); renderNames(); renderTeam(); renderList(); renderStats();
  }

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
  // 試合名・日付・相手校は、アプリを閉じても残す（当日中のみ日付を復元）
  const common = load('kr_common', {});
  $('fDate').value = common.day === today() && common.date ? common.date : today();
  if (common.day === today()) { $('fEvent').value = common.event || ''; $('fSchool').value = common.school || ''; }
  ['fDate', 'fEvent', 'fSchool'].forEach(id => $(id).addEventListener('input', () =>
    save('kr_common', { day: today(), date: $('fDate').value, event: $('fEvent').value, school: $('fSchool').value })));
  $('fTeam').value = load(LS.team, '四日市');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (pass) { showApp(); renderAll(); sync(); } else { showLock(); }
})();
