// UI wiring: workspace, matrix editors, command line, history, identity explainer.
(function () {
  const LA = window.LA;
  const N = LA.num;
  const M = LA.mat;
  const E = LA.expr;
  const el = LA.el;
  const $ = (id) => document.getElementById(id);

  // ---------- storage (session-scoped; every access guarded) ----------
  const store = {
    get(k, fallback, area = 'session') {
      try { const s = (area === 'local' ? localStorage : sessionStorage).getItem(k); return s ? JSON.parse(s) : fallback; }
      catch (e) { return fallback; }
    },
    set(k, v, area = 'session') {
      try { (area === 'local' ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
    },
  };

  // ---------- state ----------
  const ws = {};
  const settings = Object.assign({ defaultN: 3, ipWeight: '', steps: true }, store.get('la-settings', {}));
  const recall = store.get('la-recall', []);
  let recallIdx = -1;

  function serVal(v) {
    if (v instanceof LA.Matrix) return { m: v.a.map((r) => r.map(N.serialize)) };
    return { n: N.serialize(v) };
  }
  function deserVal(o) {
    if (o.m) return new LA.Matrix(o.m.map((r) => r.map(N.deserialize)));
    return N.deserialize(o.n);
  }
  function saveWs() {
    const out = {};
    for (const [k, v] of Object.entries(ws)) out[k] = serVal(v);
    store.set('la-ws', out);
  }
  (function loadWs() {
    const raw = store.get('la-ws', {});
    for (const [k, v] of Object.entries(raw)) { try { ws[k] = deserVal(v); } catch (e) { /* skip */ } }
  })();
  const saveSettings = () => store.set('la-settings', settings);

  // ---------- rendering helpers ----------
  function tex(target, s, display = true) {
    if (window.katex) {
      try { window.katex.render(s, target, { displayMode: display, throwOnError: false, strict: 'ignore' }); return target; }
      catch (e) { /* fall through */ }
    }
    target.textContent = s;
    target.classList.add('fallback-tex');
    return target;
  }
  const texEl = (s, display = true, tag = 'div') => tex(el(tag), s, display);

  function valueTex(v) {
    if (v instanceof LA.Matrix) return v.r === 1 && v.c === 1 ? N.toLatex(v.a[0][0]) : M.latex(v);
    if (N.isNum(v)) return N.toLatex(v);
    return '';
  }
  function badgeOf(v) {
    if (v instanceof LA.Matrix) return v.r === 1 && v.c === 1 ? 'scalar' : v.dims;
    if (N.isNum(v)) return 'scalar';
    return '';
  }
  function valueText(v, fmt = 'text') {
    const t = (x) => {
      let s = N.toText(x, N.getMode());
      if (fmt === 'numpy') s = s.replace(/sqrt/g, 'np.sqrt');
      return s;
    };
    if (N.isNum(v)) return t(v);
    if (!(v instanceof LA.Matrix)) return '';
    if (fmt === 'latex') return valueTex(v);
    if (fmt === 'numpy') return `np.array([${v.a.map((r) => '[' + r.map(t).join(', ') + ']').join(', ')}])`;
    return '[' + v.a.map((r) => r.map(t).join(' ')).join('; ') + ']';
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) {
      const ta = el('textarea', {}); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch (_) { toast('Copy failed'); }
      ta.remove();
    }
  }

  function suggestName(v) {
    const isVec = v instanceof LA.Matrix && v.c === 1 && v.r > 1;
    const isScal = N.isNum(v) || (v instanceof LA.Matrix && v.r === 1 && v.c === 1);
    const pool = isScal ? 'abcdkst' : isVec ? 'uvwxyzbpq' : 'ABCDEFGHJKLMNPQRSTUVW';
    for (const ch of pool) if (!(ch in ws)) return ch;
    for (let i = 1; ; i++) { const n = pool[0] + i; if (!(n in ws)) return n; }
  }

  // ---------- workspace ----------
  function setVar(name, v, quiet) {
    if (v instanceof LA.Matrix && v.r === 1 && v.c === 1) v = v.a[0][0];
    ws[name] = v;
    saveWs();
    renderWs();
    refreshValidation();
    if (!quiet) toast(`Saved ${name}`);
  }
  function renderWs() {
    const list = $('wsList');
    list.innerHTML = '';
    const names = Object.keys(ws).filter((k) => k !== 'ans').sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'case', caseFirst: 'upper' }));
    $('wsCount').textContent = names.length ? `${names.length} saved` : '';
    if (!names.length) {
      list.append(el('li', { class: 'ws-empty' }, 'Nothing saved yet. Build a matrix and press ', el('b', {}, 'Save'), ', or type ', el('code', {}, 'v = [1; 2; 3]'), ' below.'));
    }
    for (const name of names) {
      const v = ws[name];
      const nameBtn = el('button', { type: 'button', class: 'ws-name', title: 'Insert into the command line', onclick: () => insertCmd(name) },
        name, el('span', { class: 'ws-dims' }, v instanceof LA.Matrix ? v.dims : 'scalar'));
      const actions = el('div', { class: 'ws-actions' });
      if (v instanceof LA.Matrix) actions.append(el('button', { type: 'button', title: 'Edit in the matrix editor', 'aria-label': `Edit ${name}`, onclick: () => editInGrid(name, v) }, '✎'));
      actions.append(el('button', { type: 'button', title: 'Copy', 'aria-label': `Copy ${name}`, onclick: () => copy(valueText(v)) }, '⧉'));
      actions.append(el('button', { type: 'button', title: 'Delete', 'aria-label': `Delete ${name}`, onclick: () => { delete ws[name]; saveWs(); renderWs(); toast(`Deleted ${name}`); } }, '✕'));
      const prev = el('div', { class: 'ws-preview', title: 'Insert into the command line', onclick: () => insertCmd(name) });
      if (v instanceof LA.Matrix && (v.r > 8 || v.c > 6)) prev.textContent = `${v.dims} matrix`;
      else tex(prev, valueTex(v), false);
      list.append(el('li', { class: 'ws-item' }, nameBtn, actions, prev));
    }
    renderIpOptions();
  }

  // ---------- matrix editors & quick ops ----------
  const gridsRoot = $('grids');
  const gridOpts = (name, extra = {}) => ({
    name, rows: 3, cols: 3,
    getWs: () => ws, getSettings: () => settings,
    onSave: (n, Mx) => setVar(n, Mx),
    onUse: (lit) => lit && insertCmd(lit),
    onRename: () => renderQuickOps(),
    toast,
    ...extra,
  });
  const gA = new LA.MatrixGrid(gridsRoot, gridOpts('A'));
  let gB = null;
  const addSecondBtn = el('button', { type: 'button', class: 'add-second', onclick: () => showSecond(true) }, '+ second matrix', el('br'), el('small', {}, 'for A·B, A+B, solve…'));
  gridsRoot.append(addSecondBtn);
  function showSecond(on) {
    if (on && !gB) {
      const holder = el('div');
      gridsRoot.insertBefore(holder, addSecondBtn);
      gB = new LA.MatrixGrid(holder, gridOpts(gA.name === 'B' ? 'C' : 'B', { removable: true, onRemove: () => showSecond(false) }));
      gB.holder = holder;
      gB.focusCell(0, 0);
    } else if (!on && gB) {
      gB.holder.remove();
      gB = null;
    }
    addSecondBtn.hidden = !!gB;
    renderQuickOps();
  }
  function editInGrid(name, v) {
    gA.setMatrix(v, name);
    renderQuickOps();
    showTab('calc');
    gA.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    gA.focusCell(0, 0);
  }
  function refreshValidation() {
    for (const g of [gA, gB]) if (g) g.inputs.flat().forEach((i) => g.validate(i));
  }

  const UNARY = [
    ['Aᵀ', '{A}^T'], ['A⁻¹', 'inv({A})'], ['det', 'det({A})'], ['rref', 'rref({A})'], ['EA = R', 'elim({A})'], ['rank', 'rank({A})'], ['trace', 'tr({A})'],
    ['A²', '{A}^2'], ['AᵀA', 'gram({A})'], ['eigen', 'eig({A})'], ['char poly', 'charpoly({A})'], ['null space', 'null({A})'],
    ['col space', 'col({A})'], ['LU', 'lu({A})'], ['QR', 'qr({A})'], ['Gram–Schmidt', 'gs({A})'], ['‖A‖', 'norm({A})'],
  ];
  const BINARY = [
    ['A·B', '{A} * {B}'], ['B·A', '{B} * {A}'], ['A+B', '{A} + {B}'], ['A−B', '{A} - {B}'], ['⟨A, B⟩', '<{A}, {B}>'],
    ['solve Ax = B', 'solve({A}, {B})'], ['A⁻¹B', 'inv({A}) * {B}'], ['proj of B onto A', 'proj({B}, {A})'],
  ];
  function renderQuickOps() {
    const a = gA.name, b = gB ? gB.name : 'B';
    const sub = (s) => s.replace(/\{A\}/g, a).replace(/\{B\}/g, b);
    const lab = (s) => s.replace(/A/g, a).replace(/B/g, b);
    const u = $('unaryOps');
    u.innerHTML = '';
    u.append(el('span', { class: 'qo-label' }, `On ${a}:`));
    for (const [l, t] of UNARY) u.append(el('button', { type: 'button', class: 'qo', title: sub(t), onclick: () => quickOp(sub(t)) }, lab(l)));
    const bn = $('binaryOps');
    bn.hidden = !gB;
    bn.innerHTML = '';
    if (gB) {
      bn.append(el('span', { class: 'qo-label' }, `${a} & ${b}:`));
      for (const [l, t] of BINARY) bn.append(el('button', { type: 'button', class: 'qo', title: sub(t), onclick: () => quickOp(sub(t)) }, lab(l)));
    }
  }
  function quickOp(src) {
    const overlay = {};
    try {
      for (const g of [gA, gB]) if (g) {
        const bad = E.validName(g.name);
        if (bad) throw new LA.MathError(`${g.name}: ${bad}`);
        overlay[g.name] = g.getMatrix();
      }
      if (gB && gA.name === gB.name) throw new LA.MathError('The two editors have the same name — rename one of them.');
    } catch (e) {
      addCard({ input: src, error: e.message });
      return;
    }
    const note = Object.keys(overlay).filter((k) => !(k in ws) || !sameVal(ws[k], overlay[k]));
    execute(src, { overlay, extraNote: note.length ? `Used the editor's ${note.join(' and ')} (not saved to the workspace).` : null });
  }
  function sameVal(a, b) {
    if (a instanceof LA.Matrix && b instanceof LA.Matrix) return M.equals(a, b);
    return false;
  }

  // ---------- command line ----------
  const cmd = $('cmd');
  function insertCmd(text) {
    showTab('calc');
    const s = cmd.selectionStart ?? cmd.value.length, e = cmd.selectionEnd ?? cmd.value.length;
    const before = cmd.value.slice(0, s), after = cmd.value.slice(e);
    const pad = before && !/[\s(\[<,]$/.test(before) ? ' ' : '';
    cmd.value = before + pad + text + after;
    const pos = (before + pad + text).length;
    cmd.focus();
    cmd.setSelectionRange(pos, pos);
    updatePreview();
  }
  function insertTemplate(tpl) {
    // tpl uses | for the caret position
    const i = tpl.indexOf('|');
    const text = tpl.replace('|', '');
    const s = cmd.selectionStart ?? cmd.value.length, e = cmd.selectionEnd ?? cmd.value.length;
    const sel = cmd.value.slice(s, e);
    const filled = sel ? text.slice(0, i) + sel + text.slice(i) : text;
    cmd.value = cmd.value.slice(0, s) + filled + cmd.value.slice(e);
    const pos = s + i + sel.length;
    cmd.focus();
    cmd.setSelectionRange(pos, pos);
    updatePreview();
  }

  const CHIPS = [
    ['inv', 'inv(|)'], ['det', 'det(|)'], ['ᵀ', '|^T'], ['⁻¹', '|^-1'], ['⟨ , ⟩', '<|, >'], ['rref', 'rref(|)'], ['EA=R', 'elim(|)'], ['rank', 'rank(|)'],
    ['tr', 'tr(|)'], ['eig', 'eig(|)'], ['solve', 'solve(|, )'], ['null', 'null(|)'], ['col', 'col(|)'], ['gram', 'gram(|)'],
    ['norm', 'norm(|)'], ['proj', 'proj(|, )'], ['cross', 'cross(|, )'], ['lu', 'lu(|)'], ['qr', 'qr(|)'], ['I(n)', 'I(|)'],
  ];
  for (const [label, tpl] of CHIPS) $('chips').append(el('button', { type: 'button', class: 'chip', onclick: () => insertTemplate(tpl) }, label));

  const EXAMPLES = ['A = [2 1; 1 3]', 'v = [1; -1]', 'A^-1', '<v, A v>', 'B = 3I + A', 'eig(A)', 'rref([1 2 3; 4 5 6; 7 8 10])', 'solve([1 2 1; 2 4 0; 1 2 3], [1; 2; 1])', 'C = rand(3, 5)', 'C C^T'];
  for (const ex of EXAMPLES) $('examples').append(el('button', { type: 'button', class: 'chip', onclick: () => { cmd.value = ex; run(); } }, ex));

  let previewTimer;
  function updatePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const p = $('preview');
      const src = cmd.value.trim();
      p.className = 'preview';
      if (!src) { p.textContent = 'Enter to run · ↑/↓ recall · / focuses this box from anywhere'; return; }
      try {
        const r = E.run(src, ws, settings, { wantSteps: false });
        const v = r.value;
        let desc;
        if (v instanceof LA.Info) desc = v.title;
        else if (v instanceof LA.Matrix) desc = v.r === 1 && v.c === 1 ? `= ${N.toText(v.a[0][0])}` : `${v.dims} matrix`;
        else desc = `= ${N.toText(v)}`;
        p.textContent = r.assign ? `→ saves ${r.assign} (${v instanceof LA.Matrix ? v.dims : 'scalar'})` : `→ ${desc}`;
        p.classList.add('ok');
      } catch (e) {
        p.textContent = e.message;
        p.classList.add('err');
      }
    }, 120);
  }
  cmd.addEventListener('input', () => { recallIdx = -1; updatePreview(); });
  cmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'ArrowUp' && recall.length) {
      e.preventDefault();
      recallIdx = Math.min(recall.length - 1, recallIdx + 1);
      cmd.value = recall[recall.length - 1 - recallIdx];
      updatePreview();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      recallIdx = Math.max(-1, recallIdx - 1);
      cmd.value = recallIdx < 0 ? '' : recall[recall.length - 1 - recallIdx];
      updatePreview();
    } else if (e.key === 'Escape') { cmd.value = ''; updatePreview(); }
  });
  $('runBtn').addEventListener('click', run);

  function run() {
    const src = cmd.value.trim();
    if (!src) return;
    if (recall[recall.length - 1] !== src) { recall.push(src); if (recall.length > 100) recall.shift(); store.set('la-recall', recall); }
    recallIdx = -1;
    execute(src);
    cmd.value = '';
    updatePreview();
  }

  function execute(src, { overlay = null, extraNote = null } = {}) {
    const env = overlay ? Object.assign(Object.create(null), ws, overlay) : ws;
    let res;
    try {
      res = E.run(src, env, settings, { wantSteps: settings.steps });
    } catch (e) {
      addCard({ input: src, error: e.message, pos: e.pos });
      return;
    }
    if (extraNote) res.notes.unshift(extraNote);
    if (res.assign && res.value != null) setVar(res.assign, res.value, true);
    if (res.value != null && !(res.value instanceof LA.Info)) { ws.ans = res.value; }
    else if (res.value instanceof LA.Info && res.value.value) ws.ans = res.value.value;
    addCard({ input: src, res });
  }

  // ---------- history cards ----------
  const history = $('history');
  const cards = [];
  function addCard(rec) {
    rec.el = el('div', { class: 'card' + (rec.error ? ' error' : '') });
    renderCard(rec);
    history.prepend(rec.el);
    cards.unshift(rec);
    $('historyEmpty').hidden = true;
    if (cards.length > 60) cards.pop().el.remove();
  }
  function renderCard(rec) {
    const c = rec.el;
    c.innerHTML = '';
    const head = el('div', { class: 'card-head' });
    head.append(el('span', { class: 'card-input', title: 'Click to edit & re-run', onclick: () => { cmd.value = rec.input; cmd.focus(); updatePreview(); } }, rec.input));
    const actions = el('div', { class: 'card-actions' });
    const body = el('div', { class: 'card-body' });
    c.append(head, body);

    if (rec.error) {
      body.append(el('div', {}, rec.error));
      if (rec.pos != null) {
        body.append(el('pre', { class: 'mono small', style: 'margin:6px 0 0;color:var(--muted)' }, rec.input + '\n' + ' '.repeat(rec.pos) + '^'));
      }
      actions.append(el('button', { type: 'button', title: 'Remove', onclick: () => removeCard(rec) }, '✕'));
      head.append(actions);
      return;
    }
    const { res } = rec;
    const v = res.value;
    const b = badgeOf(v);
    if (b) head.append(el('span', { class: 'badge' }, b));
    if (res.assign) head.append(el('span', { class: 'badge saved' }, `saved as ${res.assign}`));

    if (v instanceof LA.Info) {
      body.append(el('div', { class: 'info-title' }, v.title));
      for (const blk of v.blocks) {
        const d = el('div', { class: 'info-block' });
        if (blk.label) d.append(el('span', { class: 'lbl' }, blk.label + ' ='));
        if (blk.tex) d.append(texEl(blk.label ? `${blk.label} = ${blk.tex}` : blk.tex, true));
        if (blk.text) d.append(el('div', { class: 'info-text' }, blk.text));
        if (blk.label && blk.tex) d.querySelector('.lbl').remove();
        body.append(d);
      }
      const parts = Object.entries(v.parts || {});
      if (parts.length) {
        const pr = el('div', { class: 'parts' });
        for (const [pn, pv] of parts) pr.append(saveButton(pv, `Save ${pn}`, pn.length === 1 ? pn : undefined));
        body.append(pr);
      }
      if (v.value && !parts.length && (v.value instanceof LA.Matrix || N.isNum(v.value))) actions.append(saveButton(v.value, 'Save as…'));
    } else {
      body.append(texEl(valueTex(v), true));
      if (!res.assign) actions.append(saveButton(v, 'Save as…'));
      if (v instanceof LA.Matrix && !(v.r === 1 && v.c === 1)) {
        actions.append(el('button', { type: 'button', title: 'Load into the matrix editor', onclick: () => editInGrid(res.assign || suggestName(v), v) }, 'Edit'));
      }
      actions.append(copyMenu(v));
    }
    actions.append(el('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove result', onclick: () => removeCard(rec) }, '✕'));
    head.append(actions);

    if (res.notes && res.notes.length) body.append(el('ul', { class: 'notes' }, ...res.notes.map((n) => el('li', {}, n))));
    if (res.steps && res.steps.some((g) => g.items.length)) {
      const total = res.steps.reduce((s, g) => s + g.items.length, 0);
      const det = el('details', { class: 'steps' }, el('summary', {}, `Show steps (${total})`));
      if (rec.stepsOpen) det.open = true;
      det.addEventListener('toggle', () => { rec.stepsOpen = det.open; });
      for (const g of res.steps) {
        const grp = el('div', { class: 'step-group' }, el('h4', {}, g.title));
        for (const it of g.items) {
          if (it.text) { grp.append(el('div', { class: 'step text' }, texEl(it.text, false))); continue; }
          const ops = it.ops.length > 1 ? `\\begin{gathered}${it.ops.join('\\\\')}\\end{gathered}` : it.ops[0];
          grp.append(el('div', { class: 'step' }, el('div', { class: 'ops' }, texEl(ops, false)), el('div', { class: 'mat' }, texEl(M.latex(it.mat, it.aug), false))));
        }
        det.append(grp);
      }
      c.append(det);
    }
  }
  function removeCard(rec) {
    rec.el.remove();
    cards.splice(cards.indexOf(rec), 1);
    if (!cards.length) $('historyEmpty').hidden = false;
  }
  function saveButton(v, label, preset) {
    const btn = el('button', { type: 'button', class: label.startsWith('Save ') && label !== 'Save as…' ? 'mini-btn' : '' }, label);
    btn.addEventListener('click', () => {
      const inp = el('input', { value: preset && !(preset in ws) ? preset : suggestName(v), 'aria-label': 'Variable name', spellcheck: 'false' });
      const form = el('span', { class: 'saveform' }, inp, el('button', { type: 'button', class: 'mini-btn', onclick: () => commit() }, 'Save'));
      const commit = () => {
        const name = inp.value.trim();
        const bad = E.validName(name);
        if (bad) { toast(bad); inp.focus(); return; }
        setVar(name, v);
        form.replaceWith(btn);
        btn.textContent = `✓ ${name}`;
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') form.replaceWith(btn);
      });
      btn.replaceWith(form);
      inp.focus();
      inp.select();
    });
    return btn;
  }
  function copyMenu(v) {
    const wrap = el('span', { style: 'position:relative' });
    const btn = el('button', { type: 'button', title: 'Copy in different formats' }, 'Copy ▾');
    let menu = null;
    const close = () => { if (menu) { menu.remove(); menu = null; document.removeEventListener('click', outside, true); } };
    const outside = (e) => { if (!wrap.contains(e.target)) close(); };
    btn.addEventListener('click', () => {
      if (menu) return close();
      menu = el('div', { class: 'menu' },
        ...[['Plain / re-usable', 'text'], ['LaTeX', 'latex'], ['NumPy', 'numpy'], ['MATLAB', 'matlab']].map(([l, f]) =>
          el('button', { type: 'button', onclick: () => { copy(valueText(v, f)); close(); } }, l)));
      wrap.append(menu);
      document.addEventListener('click', outside, true);
    });
    wrap.append(btn);
    return wrap;
  }
  function rerenderAll() {
    for (const rec of cards) renderCard(rec);
    renderWs();
    if (lastExplain) renderExplain(lastExplain);
  }

  // ---------- explain tab ----------
  const eqInput = $('eqInput');
  let lastExplain = null;
  function explain() {
    const src = eqInput.value.trim();
    if (!src) return;
    const n = parseInt($('eqN').value, 10);
    try {
      lastExplain = { src, r: LA.identities.explain(src, ws, settings, n) };
    } catch (e) {
      lastExplain = { src, error: e.message };
    }
    renderExplain(lastExplain);
  }
  $('eqBtn').addEventListener('click', explain);
  eqInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); explain(); } });

  const sup = (n) => String(n).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('');
  function renderExplain({ src, r, error }) {
    const out = $('eqOut');
    out.innerHTML = '';
    const panel = el('div', { class: 'panel' });
    out.append(panel);
    if (error) { panel.append(el('div', { class: 'verdict bad' }, el('span', { class: 'icon' }, '⚠'), error)); return; }

    const chips = el('div', { class: 'assume' });
    for (const v of r.vars) {
      const d = r.dims[v];
      const txt = d.scalar ? `${v} scalar` : d.c === 1 ? `${v} ∈ ℝ${sup(d.r)}` : `${v}: ${d.r}×${d.c}`;
      chips.append(el('span', { title: d.from === 'ws' ? 'From your workspace' : 'By naming convention' }, txt + (d.from === 'ws' ? ' (saved)' : '')));
    }

    let cls, icon, msg;
    const num = r.numeric;
    if (!r.isEq) { cls = 'warn'; icon = '↦'; msg = 'Expanded / simplified form'; }
    else if (num && num.status === 'fail') { cls = 'bad'; icon = '✗'; msg = 'Not an identity — here is a counterexample.'; }
    else if (r.proved && num && num.status === 'pass') { cls = 'good'; icon = '✓'; msg = `Identity holds. Derivation below (and confirmed on ${num.trials.length} numeric test${num.trials.length > 1 ? 's' : ''}).`; }
    else if (r.proved) { cls = 'good'; icon = '✓'; msg = 'Derived symbolically.' + (num && num.message ? ` (Numeric check skipped: ${num.message})` : ''); }
    else if (num && num.status === 'pass') { cls = 'warn'; icon = '≈'; msg = `Holds on ${num.trials.length} random test${num.trials.length > 1 ? 's' : ''}, but my rule set couldn't connect the two sides symbolically.`; }
    else { cls = 'warn'; icon = '?'; msg = num && num.message ? `Couldn't check numerically: ${num.message}` : "Couldn't decide."; }
    panel.append(el('div', { class: `verdict ${cls}` }, el('span', { class: 'icon' }, icon), el('span', {}, msg)));
    panel.append(chips);
    if (r.symError) panel.append(el('p', { class: 'small muted' }, `Symbolic mode: ${r.symError}`));

    const proofTable = (lines, labelFirst) => {
      const t = el('table', { class: 'proof' });
      let rSeen = false;
      lines.forEach((l, i) => {
        const why = el('td', { class: 'why' });
        if (i === 0) why.append(el('b', {}, labelFirst));
        else if (l.rule) {
          why.append(el('b', {}, l.rule.name + (l.side === 'R' && !rSeen ? '  ← working back from the right side' : '')));
          if (l.rule.tex) why.append(texEl(l.rule.tex, false, 'span'));
        }
        if (l.side === 'R') rSeen = true;
        t.append(el('tr', { class: l.side === 'R' ? 'side-R' : '' }, el('td', { class: 'expr' }, texEl(l.tex, true)), why));
      });
      return t;
    };

    if (r.lines && (r.proved || !r.isEq)) {
      panel.append(proofTable(r.lines, r.isEq ? 'Left-hand side' : 'Start'));
    } else if (r.left && r.right) {
      panel.append(el('div', { class: 'subhead' }, 'Left side simplifies to'));
      panel.append(proofTable(r.left.chain.map((c, i) => ({ tex: (i ? '= ' : '') + r.texOf(c.n), rule: c.rule })), 'Left-hand side'));
      panel.append(el('div', { class: 'subhead' }, 'Right side simplifies to'));
      panel.append(proofTable(r.right.chain.map((c, i) => ({ tex: (i ? '= ' : '') + r.texOf(c.n), rule: c.rule })), 'Right-hand side'));
    }
    if (r.hint) {
      const h = el('div', { class: 'verdict warn', style: 'margin-top:12px' }, el('span', { class: 'icon' }, '💡'));
      const span = el('span');
      // hints may contain inline TeX between the two sentences; render simple ^{\mathsf T} inline
      if (/\\/.test(r.hint)) {
        r.hint.split(/(\S*\\mathsf T\}\S*)/).forEach((part) => {
          if (/\\mathsf/.test(part)) span.append(texEl(part.replace(/[.,]$/, ''), false, 'span'), part.match(/[.,]$/) ? part.slice(-1) : '');
          else span.append(part);
        });
      } else span.textContent = r.hint;
      h.append(span);
      panel.append(h);
    }
    if (num && (num.status === 'fail' || num.status === 'pass')) {
      const trial = num.status === 'fail' ? num.trial : num.trials[0];
      const box = num.status === 'fail' ? el('div') : el('details', {}, el('summary', { class: 'small', style: 'cursor:pointer;color:var(--accent);margin-top:10px' }, 'Show the values used in the numeric test'));
      if (num.status === 'fail') box.append(el('div', { class: 'subhead' }, 'Counterexample'));
      const row = el('div', { class: 'counter' });
      for (const v of r.vars) {
        const val = trial.env[v];
        row.append(el('div', { class: 'item' }, texEl(`${LA.identities.tex({ t: 'var', name: v })} = ${valueTex(val)}`, false)));
      }
      box.append(row);
      const [ls, rs] = src.split(/=(?![^<]*>)/);
      const lr = el('div', { class: 'counter', style: 'margin-top:10px' },
        el('div', { class: 'item' }, el('span', { class: 'small muted' }, 'LHS'), texEl(valueTex(unwrap(trial.L, r.n)), false)),
        el('div', { class: 'item' }, el('span', { class: 'small muted' }, 'RHS'), texEl(valueTex(unwrap(trial.R, r.n)), false)));
      box.append(lr);
      panel.append(box);
    }
    if (!r.isEq && r.value !== undefined) {
      panel.append(el('div', { class: 'subhead' }, 'Value with your workspace'));
      panel.append(texEl(valueTex(unwrap(r.value, r.n)), true));
    }
  }
  function unwrap(v, n) {
    if (v instanceof LA.Eye) return M.scale(v.s, M.identity(n));
    if (v instanceof LA.Info) return v.value;
    return v;
  }

  const lib = $('library');
  for (const item of LA.identities.LIBRARY) {
    lib.append(el('li', {}, el('button', { type: 'button', onclick: () => { eqInput.value = item.eq; explain(); eqInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
      el('code', {}, item.eq), el('small', {}, item.note))));
  }

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
    $('tab-calc').hidden = name !== 'calc';
    $('tab-explain').hidden = name !== 'explain';
    store.set('la-tab', name);
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { showTab(t.dataset.tab); (t.dataset.tab === 'calc' ? cmd : eqInput).focus(); }));

  // ---------- display mode / theme ----------
  function setMode(m) {
    N.setMode(m);
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    store.set('la-mode', m);
    rerenderAll();
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  applyTheme(store.get('la-theme', '', 'local'));
  $('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nxt = cur === 'dark' ? 'light' : 'dark';
    applyTheme(nxt);
    store.set('la-theme', nxt, 'local');
  });

  // ---------- settings ----------
  const pop = $('settings');
  function renderIpOptions() {
    const sel = $('setIP');
    sel.innerHTML = '';
    sel.append(el('option', { value: '' }, 'Standard dot product  xᵀy'));
    for (const [k, v] of Object.entries(ws)) {
      if (k !== 'ans' && v instanceof LA.Matrix && v.isSquare && v.r > 1) sel.append(el('option', { value: k }, `Weighted  xᵀ${k}y  (${v.dims})`));
    }
    if (settings.ipWeight && !(settings.ipWeight in ws)) settings.ipWeight = '';
    sel.value = settings.ipWeight;
    const note = $('ipNote');
    note.textContent = '';
    if (settings.ipWeight) {
      const W = ws[settings.ipWeight];
      let ok = M.isSymmetric(W);
      if (ok) for (let k = 1; k <= W.r && ok; k++) ok = N.sign(M.det(new LA.Matrix(W.a.slice(0, k).map((r) => r.slice(0, k))))) > 0;
      note.textContent = ok
        ? `✓ ${settings.ipWeight} is symmetric positive definite, so ⟨x, y⟩ = xᵀ${settings.ipWeight}y is a valid inner product. It is used by ⟨ , ⟩, norm, proj, angle and dist.`
        : `⚠ ${settings.ipWeight} is not symmetric positive definite, so this is not a true inner product.`;
    }
  }
  $('setIP').addEventListener('change', (e) => { settings.ipWeight = e.target.value; saveSettings(); renderIpOptions(); toast(settings.ipWeight ? `Inner product now uses ${settings.ipWeight}` : 'Standard inner product'); });
  $('setN').value = settings.defaultN;
  $('setN').addEventListener('change', (e) => { settings.defaultN = Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 3)); e.target.value = settings.defaultN; saveSettings(); updatePreview(); });
  $('setSteps').checked = settings.steps;
  $('setSteps').addEventListener('change', (e) => { settings.steps = e.target.checked; saveSettings(); });
  const closePop = () => { pop.hidden = true; };
  $('settingsBtn').addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) renderIpOptions(); });
  $('settingsDone').addEventListener('click', closePop);
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== $('settingsBtn')) closePop(); });

  // ---------- help ----------
  const HELP = [
    ['Entering matrices', [
      ['[1 2; 3 4]', 'rows separated by ; (or new lines), entries by spaces or commas'],
      ['[1; 2; 3]', 'column vector   ·   [1 2 3] is a row vector'],
      ['[v w]  [A b]', 'build from blocks: columns side by side, augmented matrices'],
      ['1/3  -2.5  sqrt(2)', 'cells and entries can be any scalar expression'],
      ['I  I(4)  I3', 'identity; plain I takes its size from context (A + 3I)'],
      ['zeros(m,n) ones(n) rand(m,n) diag(1,2,3)', 'constructors'],
    ]],
    ['Variables', [
      ['A = [2 1; 1 3]', 'save to the workspace (also the editor’s Save button)'],
      ['B = A^2 - 3I', 'any expression can be saved'],
      ['ans', 'the previous result'],
      ['A(2,3)  v(1)', 'read an entry (1-based)'],
    ]],
    ['Operators', [
      ['A + B   A - B   2A', 'sums and scalar multiples'],
      ['A B   A*B   Av', 'products; juxtaposition works when names are saved (Av = A·v)'],
      ['A^T   A\'   A^-1   A^3', 'transpose, inverse, powers'],
      ['<u, v>   dot(u, v)', 'inner product (weighted one set in ⚙ is used by <,>)'],
      ['||v||   |A|', 'norm, determinant'],
    ]],
    ['Functions', Object.entries(E.FUNCS).filter(([k, f], i, arr) => arr.findIndex(([, g]) => g === f) === i).map(([k, f]) => [f.sig, f.doc || ''])],
    ['Explain an identity', [
      ['<v, A w> = <A^T v, w>', 'shows each rewrite rule used, then tests with random numbers'],
      ['(A + B)^2', 'without “=”: expand and simplify'],
    ]],
    ['Keyboard', [
      ['/', 'focus the command line'],
      ['↑ ↓', 'recall previous commands'],
      ['Tab, Enter, arrows', 'move between matrix cells; Space → next cell, ; → next row'],
      ['⌘/Ctrl + Enter', 'save the matrix in the editor'],
    ]],
  ];
  const hb = $('helpBody');
  for (const [title, rows] of HELP) {
    hb.append(el('h4', {}, title));
    hb.append(el('table', {}, ...rows.map(([a, b]) => el('tr', {}, el('td', {}, a), el('td', {}, b)))));
  }
  const openHelp = (on) => { $('help').hidden = !on; $('scrim').hidden = !on; };
  $('helpBtn').addEventListener('click', () => openHelp(true));
  $('helpClose').addEventListener('click', () => openHelp(false));
  $('scrim').addEventListener('click', () => openHelp(false));

  // ---------- export / import ----------
  $('exportBtn').addEventListener('click', () => {
    const data = {};
    for (const [k, v] of Object.entries(ws)) if (k !== 'ans') data[k] = serVal(v);
    const blob = new Blob([JSON.stringify({ linalgWorkbench: 1, vars: data }, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'linalg-workspace.json' });
    document.body.append(a); a.click(); a.remove();
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const vars = obj.vars || obj;
      let n = 0;
      for (const [k, v] of Object.entries(vars)) { if (!E.validName(k)) { ws[k] = deserVal(v); n++; } }
      saveWs(); renderWs();
      toast(`Imported ${n} variable${n === 1 ? '' : 's'}`);
    } catch (err) { toast('Could not read that file'); }
    e.target.value = '';
  });
  $('clearWsBtn').addEventListener('click', () => {
    const n = Object.keys(ws).filter((k) => k !== 'ans').length;
    if (!n || !confirm(`Delete all ${n} saved variables?`)) return;
    for (const k of Object.keys(ws)) delete ws[k];
    saveWs(); renderWs();
  });

  // ---------- global keys ----------
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
    if (e.key === 'Escape') { closePop(); openHelp(false); }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); showTab('calc'); cmd.focus(); }
    else if (e.key === '?') { e.preventDefault(); openHelp(true); }
  });

  // ---------- init ----------
  N.setMode(store.get('la-mode', 'frac'));
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === N.getMode()));
  renderWs();
  renderQuickOps();
  updatePreview();
  showTab(store.get('la-tab', 'calc'));
  if (/[?&]test\b/.test(location.search)) selfTest();

  // ---------- self-test (?test) ----------
  function selfTest() {
    const cases = [
      ['[1 2; 3 4]^-1', '[-2 1; 3/2 -1/2]'],
      ['det([1 2; 3 4])', '-2'],
      ['[1 2; 3 4] [5; 6]', '[17; 39]'],
      ['<[1;2;3], [4;5;6]>', '32'],
      ['rank([1 2; 2 4])', '1'],
      ['rref([2 4; 1 3])', '[1 0; 0 1]'],
      ['norm([3; 4])', '5'],
      ['[1 2; 3 4] + 2I', '[3 2; 3 6]'],
      ['1/3 + 1/6', '1/2'],
      ['tr(gram([1 2; 3 4]))', '30'],
    ];
    const prevMode = N.getMode();
    N.setMode('frac');
    let pass = 0;
    for (const [src, want] of cases) {
      try {
        const got = valueText(E.run(src, {}, settings).value);
        if (got === want) pass++; else console.error('✗', src, 'got', got, 'want', want);
      } catch (e) { console.error('✗', src, e.message); }
    }
    for (const it of LA.identities.LIBRARY.slice(0, 11)) {
      const r = LA.identities.explain(it.eq, {}, settings, 3);
      if (r.proved && r.numeric.status === 'pass') pass++; else console.error('✗ identity', it.eq);
    }
    N.setMode(prevMode);
    const total = cases.length + 11;
    console.log(`Self-test: ${pass}/${total} passed`);
    toast(`Self-test: ${pass}/${total} passed`);
  }
})();
