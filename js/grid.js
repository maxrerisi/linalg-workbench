// Spreadsheet-like matrix entry component.
(function () {
  const LA = window.LA;
  const N = LA.num;
  const MAX = 12;

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };
  LA.el = el;

  class MatrixGrid {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts;
      this.name = opts.name || 'A';
      this.vals = Array.from({ length: opts.rows || 3 }, () => Array(opts.cols || 3).fill(''));
      this.textMode = false;
      this.build();
    }
    get rows() { return this.vals.length; }
    get cols() { return this.vals[0].length; }

    build() {
      const nameIn = el('input', {
        class: 'grid-name', value: this.name, maxlength: 12, 'aria-label': 'Matrix name', spellcheck: 'false',
        oninput: () => { this.name = nameIn.value.trim() || 'A'; this.updateSaveLabel(); this.opts.onRename && this.opts.onRename(); },
        title: 'Name used when saving and in quick operations',
      });
      this.nameIn = nameIn;
      const dimInput = (which) => {
        const inp = el('input', {
          type: 'number', min: 1, max: MAX, value: which === 'r' ? this.rows : this.cols, 'aria-label': which === 'r' ? 'Rows' : 'Columns',
          onchange: () => {
            const v = Math.max(1, Math.min(MAX, parseInt(inp.value, 10) || 1));
            which === 'r' ? this.resize(v, this.cols) : this.resize(this.rows, v);
          },
        });
        return inp;
      };
      this.rIn = dimInput('r');
      this.cIn = dimInput('c');
      const step = (label, fn, title) => el('button', { type: 'button', class: 'stepper', title, onclick: fn, tabindex: -1 }, label);
      const dims = el('span', { class: 'dims' },
        step('−', () => this.resize(this.rows - 1, this.cols), 'Remove row'), this.rIn, step('+', () => this.resize(this.rows + 1, this.cols), 'Add row'),
        el('span', { class: 'x' }, '×'),
        step('−', () => this.resize(this.rows, this.cols - 1), 'Remove column'), this.cIn, step('+', () => this.resize(this.rows, this.cols + 1), 'Add column'),
      );
      const presets = el('select', { class: 'mini-select', 'aria-label': 'Fill with', title: 'Fill the grid', onchange: (e) => { this.preset(e.target.value); e.target.value = ''; } },
        el('option', { value: '' }, 'Fill…'),
        el('option', { value: 'I' }, 'Identity'),
        el('option', { value: '0' }, 'Zeros'),
        el('option', { value: 'rand' }, 'Random integers'),
        el('option', { value: 'sym' }, 'Random symmetric'),
        el('option', { value: 'T' }, 'Transpose in place'),
        el('option', { value: 'clear' }, 'Clear'),
      );
      this.textBtn = el('button', { type: 'button', class: 'mini-btn', title: 'Type or paste the whole matrix as text', onclick: () => this.toggleText() }, 'Text');
      const head = el('div', { class: 'grid-head' }, nameIn, dims, presets, this.textBtn);
      if (this.opts.removable) head.append(el('button', { type: 'button', class: 'mini-btn', title: 'Hide second matrix', onclick: () => this.opts.onRemove() }, '✕'));

      this.table = el('table', { class: 'mgrid' });
      this.bracket = el('div', { class: 'bracket' }, this.table);
      this.scroll = el('div', { class: 'grid-scroll' }, this.bracket);
      const addCol = el('button', { type: 'button', class: 'add-col', title: 'Add column', tabindex: -1, onclick: () => this.resize(this.rows, this.cols + 1) }, '+');
      this.addRowBtn = el('button', { type: 'button', class: 'add-row', title: 'Add row', tabindex: -1, onclick: () => this.resize(this.rows + 1, this.cols) }, '+');
      this.body = el('div', { class: 'grid-body' }, el('div', { class: 'mat-col' }, this.scroll, this.addRowBtn), addCol);
      this.text = el('textarea', {
        class: 'grid-text', hidden: true, spellcheck: 'false', 'aria-label': 'Matrix as text',
        placeholder: '1 2 3\n4 5 6\n\nor  [1 2 3; 4 5 6]  or  [[1,2,3],[4,5,6]]',
        onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.toggleText(); this.save(); } },
      });
      this.saveBtn = el('button', { type: 'button', class: 'primary', onclick: () => this.save() });
      this.useBtn = el('button', { type: 'button', class: 'mini-btn', title: 'Insert this matrix literal into the command line', onclick: () => this.opts.onUse(this.toLiteral()) }, 'Insert as literal');
      this.err = el('span', { class: 'grid-err' });
      const foot = el('div', { class: 'grid-foot' }, this.saveBtn, this.useBtn, this.err);
      this.card = el('div', { class: 'grid-card' }, head, this.body, this.text, foot);
      this.root.append(this.card);
      this.updateSaveLabel();
      this.renderTable();
    }

    updateSaveLabel() { this.saveBtn.textContent = `Save as ${this.name}`; }

    renderTable(focus) {
      this.table.innerHTML = '';
      this.inputs = [];
      for (let i = 0; i < this.rows; i++) {
        const tr = el('tr');
        const row = [];
        for (let j = 0; j < this.cols; j++) {
          const inp = el('input', {
            type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0',
            'aria-label': `Row ${i + 1}, column ${j + 1}`,
          });
          inp.value = this.vals[i][j];
          inp.dataset.i = i; inp.dataset.j = j;
          inp.addEventListener('focus', () => inp.select());
          inp.addEventListener('input', () => {
            // Separators that arrive without a keydown (mobile keyboards, dictation, autofill) are distributed too
            if (/[\s,;]/.test(inp.value.trim()) || /[,;]$/.test(inp.value)) { this.flowFill(inp.value, i, j); return; }
            this.vals[i][j] = inp.value; this.fit(inp); this.validate(inp);
          });
          inp.addEventListener('keydown', (e) => this.onKey(e, i, j));
          inp.addEventListener('paste', (e) => this.onPaste(e, i, j));
          this.fit(inp);
          this.validate(inp);
          row.push(inp);
          tr.append(el('td', {}, inp));
        }
        this.inputs.push(row);
        this.table.append(tr);
      }
      this.rIn.value = this.rows;
      this.cIn.value = this.cols;
      if (focus) this.focusCell(...focus);
    }
    fit(inp) { inp.style.width = `${Math.max(4.2, inp.value.length + 1.6)}ch`; }
    validate(inp) {
      const s = inp.value.trim();
      if (!s) { inp.classList.remove('bad'); inp.title = ''; return true; }
      try {
        LA.expr.evalScalar(s, this.opts.getWs(), this.opts.getSettings());
        inp.classList.remove('bad');
        inp.title = '';
        return true;
      } catch (e) {
        inp.classList.add('bad');
        inp.title = e.message;
        return false;
      }
    }
    focusCell(i, j) {
      i = Math.max(0, Math.min(this.rows - 1, i));
      j = Math.max(0, Math.min(this.cols - 1, j));
      const inp = this.inputs[i][j];
      inp.focus();
      inp.select();
    }
    next(i, j) { return j + 1 < this.cols ? [i, j + 1] : i + 1 < this.rows ? [i + 1, 0] : null; }
    prev(i, j) { return j > 0 ? [i, j - 1] : i > 0 ? [i - 1, this.cols - 1] : null; }

    onKey(e, i, j) {
      const inp = e.target;
      const len = inp.value.length, s0 = inp.selectionStart, s1 = inp.selectionEnd;
      const allSel = s0 === 0 && s1 === len;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.save(); return; }
      switch (e.key) {
        case 'Enter': {
          e.preventDefault();
          if (e.shiftKey) { if (i > 0) this.focusCell(i - 1, j); return; }
          if (i + 1 < this.rows) this.focusCell(i + 1, j);
          else if (j + 1 < this.cols) this.focusCell(0, j + 1);
          else this.saveBtn.focus();
          return;
        }
        case ' ': case ',': {
          e.preventDefault();
          const n = this.next(i, j);
          if (n) this.focusCell(...n);
          else if (this.cols < MAX && this.rows === 1) { this.resize(1, this.cols + 1); this.focusCell(0, this.cols - 1); }
          else this.saveBtn.focus();
          return;
        }
        case ';': {
          e.preventDefault();
          if (i + 1 < this.rows) this.focusCell(i + 1, 0);
          else if (this.rows < MAX) { this.resize(this.rows + 1, this.cols); this.focusCell(this.rows - 1, 0); }
          return;
        }
        case 'ArrowUp': e.preventDefault(); if (i > 0) this.focusCell(i - 1, j); return;
        case 'ArrowDown': e.preventDefault(); if (i + 1 < this.rows) this.focusCell(i + 1, j); return;
        case 'ArrowLeft':
          if ((s0 === 0 && s1 === 0) || (allSel && len)) { const p = this.prev(i, j); if (p) { e.preventDefault(); this.focusCell(...p); } }
          return;
        case 'ArrowRight':
          if ((s0 === len && s1 === len) || (allSel && len)) { const n = this.next(i, j); if (n) { e.preventDefault(); this.focusCell(...n); } }
          return;
        case 'Backspace':
          if (len === 0) { const p = this.prev(i, j); if (p) { e.preventDefault(); this.focusCell(...p); } }
          return;
      }
    }

    onPaste(e, i, j) {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const block = LA.expr.parseBlock(text);
      if (!block || (block.length === 1 && block[0].length === 1)) return; // single value: normal paste
      e.preventDefault();
      this.fillBlock(block, i, j);
    }
    fillBlock(block, i = 0, j = 0) {
      const bw = Math.max(...block.map((r) => r.length));
      if (i === 0 && j === 0) this.resize(Math.min(MAX, block.length), Math.min(MAX, bw), true);
      else this.resize(Math.min(MAX, Math.max(this.rows, i + block.length)), Math.min(MAX, Math.max(this.cols, j + bw)), true);
      block.forEach((row, a) => row.forEach((v, b) => {
        if (i + a < this.rows && j + b < this.cols) this.vals[i + a][j + b] = v;
      }));
      this.renderTable([i, j]);
      this.flash(`Pasted ${block.length}×${bw}`);
    }
    // Spread "1 2 3; 4 5 6" typed into one cell across the grid, starting at (i, j)
    flowFill(text, i, j) {
      const rowsTxt = text.split(/;|\n/);
      let r = i, c = j, last = [i, j];
      rowsTxt.forEach((rt, k) => {
        if (k > 0) { r++; c = 0; }
        const toks = rt.split(/[\s,]+/).filter((t) => t !== '');
        for (const t of toks) {
          if (c >= this.cols) { r++; c = 0; }
          if (r >= this.rows) { if (this.rows >= MAX) break; this.resize(this.rows + 1, this.cols, true); }
          this.vals[r][c] = t;
          last = [r, c];
          c++;
        }
      });
      const trailing = /[\s,;]$/.test(text);
      let next = trailing ? (text.trim().endsWith(';') ? [last[0] + 1, 0] : this.next(...last)) : last;
      if (next && next[0] >= this.rows && this.rows < MAX && trailing) this.resize(this.rows + 1, this.cols, true);
      this.renderTable(next && next[0] < this.rows ? next : last);
      if (!trailing) { const inp = this.inputs[last[0]][last[1]]; inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
    flash(msg) { this.opts.toast && this.opts.toast(msg); }

    resize(r, c, silent) {
      r = Math.max(1, Math.min(MAX, r));
      c = Math.max(1, Math.min(MAX, c));
      const vals = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => (this.vals[i] && this.vals[i][j] !== undefined ? this.vals[i][j] : '')));
      this.vals = vals;
      const active = document.activeElement;
      const pos = active && active.dataset && active.dataset.i !== undefined ? [+active.dataset.i, +active.dataset.j] : null;
      if (!silent) this.renderTable(pos && this.inputs.flat().includes(active) ? pos : null);
    }

    preset(kind) {
      const r = this.rows, c = this.cols;
      if (kind === 'I') this.vals = this.vals.map((row, i) => row.map((_, j) => (i === j ? '1' : '0')));
      else if (kind === '0') this.vals = this.vals.map((row) => row.map(() => '0'));
      else if (kind === 'clear') this.vals = this.vals.map((row) => row.map(() => ''));
      else if (kind === 'rand') this.vals = this.vals.map((row) => row.map(() => String(Math.floor(Math.random() * 11) - 5)));
      else if (kind === 'sym') {
        const n = Math.max(r, c);
        this.resize(n, n, true);
        const v = this.vals;
        for (let i = 0; i < n; i++) for (let j = i; j < n; j++) v[i][j] = v[j][i] = String(Math.floor(Math.random() * 11) - 5);
      } else if (kind === 'T') this.vals = this.vals[0].map((_, j) => this.vals.map((row) => row[j]));
      this.renderTable();
    }

    toggleText() {
      this.textMode = !this.textMode;
      this.textBtn.classList.toggle('on', this.textMode);
      if (this.textMode) {
        this.text.value = this.vals.map((r) => r.map((v) => v.trim() || '0').join(' ')).join('\n');
        this.body.hidden = true; this.text.hidden = false;
        this.text.focus();
      } else {
        const block = LA.expr.parseBlock(this.text.value);
        if (block && block.length) {
          const w = Math.max(...block.map((r) => r.length));
          this.vals = Array.from({ length: Math.min(MAX, block.length) }, (_, i) => Array.from({ length: Math.min(MAX, w) }, (_, j) => block[i][j] || ''));
        }
        this.body.hidden = false; this.text.hidden = true;
        this.renderTable([0, 0]);
      }
    }

    // Build a Matrix from the cells (throws with a helpful location on bad input)
    getMatrix() {
      if (this.textMode) this.toggleText();
      const ws = this.opts.getWs(), st = this.opts.getSettings();
      const rows = this.vals.map((row, i) => row.map((s, j) => {
        try { return LA.expr.evalScalar(s, ws, st); }
        catch (e) {
          this.focusCell(i, j);
          throw new LA.MathError(`${this.name}: row ${i + 1}, column ${j + 1} — ${e.message}`);
        }
      }));
      return new LA.Matrix(rows);
    }
    setMatrix(M, name) {
      if (name) { this.name = name; this.nameIn.value = name; this.updateSaveLabel(); }
      if (this.textMode) this.toggleText();
      this.vals = M.a.map((r) => r.map((x) => N.toText(x, 'frac')));
      this.renderTable();
    }
    toLiteral() {
      try {
        const M = this.getMatrix();
        return '[' + M.a.map((r) => r.map((x) => N.toText(x, 'frac')).join(' ')).join('; ') + ']';
      } catch (e) { this.showErr(e.message); return ''; }
    }
    showErr(msg) {
      this.err.textContent = msg || '';
      if (msg) setTimeout(() => { if (this.err.textContent === msg) this.err.textContent = ''; }, 5000);
    }
    save() {
      const bad = LA.expr.validName(this.name);
      if (bad) { this.showErr(bad); this.nameIn.focus(); return; }
      try {
        const M = this.getMatrix();
        this.showErr('');
        this.opts.onSave(this.name, M);
      } catch (e) { this.showErr(e.message); }
    }
  }

  LA.MatrixGrid = MatrixGrid;
})();
