// Tokenizer, parser and evaluator for the expression language.
(function () {
  const LA = window.LA;
  const N = LA.num;
  const M = LA.mat;
  const { Matrix } = LA;
  const { R, MathError } = { R: N.R, MathError: LA.MathError };

  class ParseError extends Error {
    constructor(msg, pos) { super(msg); this.pos = pos; }
  }
  LA.ParseError = ParseError;

  const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'sigma', 'tau', 'phi', 'omega', 'rho', 'kappa'];

  // ---------- Tokenizer ----------
  function tokenize(src) {
    // normalize unicode conveniences
    src = src
      .replace(/[−–]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/')
      .replace(/⁻¹/g, '^-1').replace(/²/g, '^2').replace(/³/g, '^3').replace(/ᵀ/g, "'")
      .replace(/⟨/g, '<').replace(/⟩/g, '>');
    const toks = [];
    let i = 0, sp = false;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\n' || ch === '\r') { toks.push({ t: 'op', v: ';', pos: i, sp: true, nl: true }); i++; sp = true; continue; }
      if (/\s/.test(ch)) { sp = true; i++; continue; }
      const rest = src.slice(i);
      let m;
      if ((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest))) {
        toks.push({ t: 'num', v: m[0], pos: i, sp });
        i += m[0].length;
      } else if ((m = /^[A-Za-z_Ͱ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*/.exec(rest))) {
        toks.push({ t: 'id', v: m[0], pos: i, sp });
        i += m[0].length;
      } else if ('+-*/^\'()[],;<>=|'.includes(ch)) {
        const tok = { t: 'op', v: ch, pos: i, sp };
        if (ch === '+' || ch === '-') tok.spAfter = i + 1 >= src.length || /\s/.test(src[i + 1]);
        toks.push(tok);
        i++;
      } else {
        throw new ParseError(`Unexpected character "${ch}"`, i);
      }
      sp = false;
    }
    return toks;
  }

  // ---------- Function registry (populated below) ----------
  const FUNCS = {};
  const isFunc = (name) => Object.prototype.hasOwnProperty.call(FUNCS, name);

  // Split an unknown identifier like "AB" or "Av1" into known pieces.
  function splitIdent(name, ok) {
    const memo = new Map();
    function go(s) {
      if (s === '') return [];
      if (memo.has(s)) return memo.get(s);
      let res = null;
      for (let len = s.length; len >= 1 && !res; len--) {
        const head = s.slice(0, len);
        if (ok(head)) {
          const tail = go(s.slice(len));
          if (tail) res = [head, ...tail];
        }
      }
      memo.set(s, res);
      return res;
    }
    return go(name);
  }

  // ---------- Parser ----------
  // opts.known(name) → true if the name is defined; opts.loose → treat every single letter as a variable.
  function parse(src, opts = {}) {
    const toks = tokenize(src);
    let i = 0;
    const ctx = [];
    const known = opts.known || (() => false);
    const peek = (k = 0) => toks[i + k];
    const next = () => toks[i++];
    const isOp = (t, v) => t && t.t === 'op' && t.v === v;
    const endPos = src.length;
    const fail = (msg, t) => { throw new ParseError(msg, t ? t.pos : endPos); };
    const expect = (v) => { const t = next(); if (!isOp(t, v)) fail(t ? `Expected "${v}" but found "${t.v}"` : `Expected "${v}"`, t); return t; };
    const inMat = () => ctx.length && ctx[ctx.length - 1] === '[';
    const startsPrimary = (t) => t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && '([<|'.includes(t.v)));
    const elementBreak = (t) => {
      if (!inMat() || !t || !t.sp) return false;
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) return !t.spAfter;
      return startsPrimary(t);
    };
    const okPiece = (s) =>
      known(s) || s === 'I' || /^I\d+$/.test(s) || (opts.loose && (/^[A-Za-z]\d*$/.test(s) || GREEK.includes(s)));

    function parseExpr() { return parseAdd(); }
    function parseAdd() {
      let l = parseMul();
      for (;;) {
        const t = peek();
        if (t && t.t === 'op' && (t.v === '+' || t.v === '-') && !elementBreak(t)) {
          next();
          l = { type: 'bin', op: t.v, l, r: parseMul() };
        } else return l;
      }
    }
    function parseMul() {
      let l = parseUnary();
      for (;;) {
        const t = peek();
        if (isOp(t, '*') || isOp(t, '/')) { next(); l = { type: 'bin', op: t.v, l, r: parseUnary() }; }
        else if (startsPrimary(t) && !elementBreak(t) && !(isOp(t, '|') && (inMat() || /^\|/.test(ctx[ctx.length - 1] || '')))) {
          l = { type: 'bin', op: '*', l, r: parsePow(), implicit: true };
        } else return l;
      }
    }
    function parseUnary() {
      const t = peek();
      if (isOp(t, '-')) { next(); return { type: 'neg', a: parseUnary() }; }
      if (isOp(t, '+')) { next(); return parseUnary(); }
      return parsePow();
    }
    function parsePow() {
      let base = parsePostfix();
      while (isOp(peek(), '^')) {
        next();
        const t = peek();
        if (t && t.t === 'id' && (t.v === 'T' || t.v === 'H') && !isOp(peek(1), '(')) { next(); base = { type: 'T', a: base }; continue; }
        if (t && t.t === 'id' && /^T[A-Za-z]/.test(t.v) && !known(t.v)) {
          // "A^Tv" → A^T v
          next();
          toks.splice(i, 0, { t: 'id', v: t.v.slice(1), pos: t.pos + 1, sp: false });
          base = { type: 'T', a: base };
          continue;
        }
        base = { type: 'pow', a: base, e: parseExpUnary() };
      }
      return base;
    }
    function parseExpUnary() {
      if (isOp(peek(), '-')) { next(); return { type: 'neg', a: parseExpUnary() }; }
      if (isOp(peek(), '+')) { next(); return parseExpUnary(); }
      return parsePow();
    }
    function parsePostfix() {
      let e = parsePrimary();
      while (isOp(peek(), "'")) { next(); e = { type: 'T', a: e }; }
      return e;
    }
    function parseArgs() {
      expect('(');
      ctx.push('(');
      const args = [];
      if (!isOp(peek(), ')')) {
        args.push(parseExpr());
        while (isOp(peek(), ',')) { next(); args.push(parseExpr()); }
      }
      expect(')');
      ctx.pop();
      return args;
    }
    function parsePrimary() {
      const t = peek();
      if (!t) fail('Unexpected end of input — something is missing here');
      if (t.t === 'num') { next(); return { type: 'num', v: t.v, pos: t.pos }; }
      if (t.t === 'id') {
        next();
        const name = t.v;
        if (name === 'I' && !isOp(peek(), '(')) return { type: 'var', name, pos: t.pos };
        if (isFunc(name) && !known(name)) {
          if (isOp(peek(), '(')) return { type: 'call', name, args: parseArgs(), pos: t.pos };
          if (startsPrimary(peek()) && FUNCS[name].min === 1) return { type: 'call', name, args: [parsePow()], pos: t.pos };
          fail(`${name} is a function — call it like ${name}(A)`, t);
        }
        if (!known(name) && !okPiece(name) && name !== 'ans' && name !== 'pi') {
          const parts = splitIdent(name, okPiece);
          if (parts && parts.length > 1) {
            let off = t.pos + parts[0].length;
            const extra = parts.slice(1).map((p) => { const tok = { t: 'id', v: p, pos: off, sp: false }; off += p.length; return tok; });
            toks.splice(i, 0, ...extra);
            return { type: 'var', name: parts[0], pos: t.pos };
          }
        }
        // A(2,3) indexing (only directly adjacent parenthesis, no space)
        if (isOp(peek(), '(') && !peek().sp && known(name)) {
          return { type: 'index', name, args: parseArgs(), pos: t.pos };
        }
        return { type: 'var', name, pos: t.pos };
      }
      if (isOp(t, '(')) {
        next(); ctx.push('(');
        const e = parseExpr();
        expect(')'); ctx.pop();
        return { type: 'group', a: e };
      }
      if (isOp(t, '[')) {
        next(); ctx.push('[');
        const rows = [[]];
        const bars = [null]; // per row: number of elements before the augmentation bar "|"
        while (isOp(peek(), ';')) next();
        while (!isOp(peek(), ']')) {
          if (!peek()) fail('Missing closing "]"');
          rows[rows.length - 1].push(parseExpr());
          const u = peek();
          if (isOp(u, '|')) {
            const r = rows.length - 1;
            if (bars[r] !== null) fail('Only one "|" per row in an augmented matrix', u);
            next();
            bars[r] = rows[r].length;
            if (isOp(peek(), ']') || isOp(peek(), ';')) fail('Something must come after "|" (e.g. [A | b])', peek());
          }
          else if (isOp(u, ',')) next();
          else if (isOp(u, ';')) { while (isOp(peek(), ';')) next(); if (!isOp(peek(), ']')) { rows.push([]); bars.push(null); } }
          else if (isOp(u, ']')) break;
          else if (!(u && u.sp && startsPrimary(u)) && !(u && elementBreak(u))) fail(u ? `Unexpected "${u.v}" in matrix` : 'Missing closing "]"', u);
        }
        expect(']'); ctx.pop();
        if (rows.length === 1 && rows[0].length === 0) fail('Empty matrix []', t);
        return { type: 'matrix', rows, bars };
      }
      if (isOp(t, '<')) {
        next(); ctx.push('<');
        const a = parseExpr();
        expect(',');
        const b = parseExpr();
        expect('>'); ctx.pop();
        return { type: 'ip', a, b };
      }
      if (isOp(t, '|')) {
        next();
        if (isOp(peek(), '|')) {
          next(); ctx.push('||');
          const a = parseExpr();
          expect('|'); expect('|'); ctx.pop();
          return { type: 'call', name: 'norm', args: [a] };
        }
        ctx.push('|');
        const a = parseExpr();
        expect('|'); ctx.pop();
        return { type: 'call', name: 'abs', args: [a] };
      }
      fail(`Unexpected "${t.v}"`, t);
    }

    let stmt;
    if (opts.equation) {
      const lhs = parseExpr();
      expect('=');
      const rhs = parseExpr();
      stmt = { type: 'equation', lhs, rhs };
    } else if (peek() && peek().t === 'id' && isOp(peek(1), '=')) {
      const name = next().v;
      next();
      stmt = { type: 'assign', name, expr: parseExpr() };
    } else {
      stmt = parseExpr();
    }
    if (i < toks.length) {
      const t = peek();
      fail(t.v === '=' ? 'Only a single name can go on the left of "=" (e.g. B = A^2)' : `Unexpected "${t.v}"`, t);
    }
    return stmt;
  }

  // ---------- Values ----------
  class Eye { constructor(s) { this.s = s; } } // scalar multiple of an identity of unknown size
  class Info {
    constructor(title, blocks = [], parts = {}, value = null) { this.title = title; this.blocks = blocks; this.parts = parts; this.value = value; }
  }
  LA.Eye = Eye;
  LA.Info = Info;

  const isMat = (v) => v instanceof Matrix;
  const describe = (v) => (isMat(v) ? `a ${v.dims} matrix` : v instanceof Eye ? 'I' : v instanceof Info ? 'a result card' : 'a scalar');

  function materialize(v, ctx, n) {
    if (v instanceof Eye) {
      const size = n || ctx.settings.defaultN;
      if (!n) ctx.notes.push(`I had no size to infer from, so it is ${size}×${size} (change the default size in ⚙ settings or write I(n)).`);
      return M.scale(v.s, M.identity(size));
    }
    return v;
  }
  function asMatrix(v, ctx) {
    if (isMat(v)) return v;
    if (v instanceof Eye) return materialize(v, ctx);
    if (N.isNum(v)) return new Matrix([[v]]);
    if (v instanceof Info && v.value) return asMatrix(v.value, ctx);
    throw new MathError('Expected a matrix here');
  }
  function asScalar(v, what = 'a number') {
    if (N.isNum(v)) return v;
    if (isMat(v) && v.r === 1 && v.c === 1) return v.a[0][0];
    if (v instanceof Info && v.value) return asScalar(v.value, what);
    throw new MathError(`Expected ${what}, got ${describe(v)}`);
  }
  function asInt(v, what = 'an integer') {
    const s = asScalar(v, what);
    if (!N.isInt(s)) throw new MathError(`Expected ${what}, got ${N.toText(s)}`);
    return Number(N.isR(s) ? s.n : s);
  }
  function asVec(v, ctx, what = 'a vector') {
    const m = asMatrix(v, ctx);
    if (m.c === 1) return m.col(0);
    if (m.r === 1) return m.a[0].slice();
    throw new MathError(`Expected ${what}, got a ${m.dims} matrix`);
  }
  const colVec = (arr) => new Matrix(arr.map((x) => [x]));

  // ---------- Arithmetic on values ----------
  function vAdd(a, b, ctx) {
    if (a instanceof Info && a.value) a = a.value;
    if (b instanceof Info && b.value) b = b.value;
    if (N.isNum(a) && N.isNum(b)) return N.add(a, b);
    if (a instanceof Eye && b instanceof Eye) return new Eye(N.add(a.s, b.s));
    if (a instanceof Eye && isMat(b)) { if (!b.isSquare) throw new MathError(`Can't add I to a non-square ${b.dims} matrix.`); return M.add(M.scale(a.s, M.identity(b.r)), b); }
    if (isMat(a) && b instanceof Eye) return vAdd(b, a, ctx);
    if (isMat(a) && isMat(b)) return M.add(a, b);
    if (N.isNum(a) && isMat(b) && b.r === 1 && b.c === 1) return N.add(a, b.a[0][0]);
    if (isMat(a) && N.isNum(b) && a.r === 1 && a.c === 1) return N.add(a.a[0][0], b);
    if ((N.isNum(a) && (isMat(b) || b instanceof Eye)) || (N.isNum(b) && (isMat(a) || a instanceof Eye))) {
      const s = N.isNum(a) ? a : b;
      throw new MathError(`Can't add a scalar to a matrix. Did you mean ${N.toText(s)}I (a multiple of the identity)?`);
    }
    throw new MathError(`Can't add ${describe(a)} and ${describe(b)}`);
  }
  function vNeg(a) { return vMul(N.neg(R.ONE), a); }
  function vMul(a, b, ctx) {
    if (a instanceof Info && a.value) a = a.value;
    if (b instanceof Info && b.value) b = b.value;
    if (a instanceof Info || b instanceof Info) throw new MathError("That result card can't be used in arithmetic");
    if (N.isNum(a) && N.isNum(b)) return N.mul(a, b);
    if (N.isNum(a)) return b instanceof Eye ? new Eye(N.mul(a, b.s)) : M.scale(a, b);
    if (N.isNum(b)) return a instanceof Eye ? new Eye(N.mul(b, a.s)) : M.scale(b, a);
    if (a instanceof Eye && b instanceof Eye) return new Eye(N.mul(a.s, b.s));
    if (a instanceof Eye) return M.scale(a.s, b);
    if (b instanceof Eye) return M.scale(b.s, a);
    if (a.c !== b.r) {
      if (a.r === 1 && a.c === 1) return M.scale(a.a[0][0], b);
      if (b.r === 1 && b.c === 1) return M.scale(b.a[0][0], a);
    }
    const out = M.mul(a, b);
    if (ctx && ctx.wantSteps && b.c === 1 && a.c > 1 && a.c <= 6 && a.r > 1) {
      // Column picture: Av = v1 a1 + v2 a2 + ... (a linear combination of the columns of A)
      const terms = b.col(0).map((x, j) => {
        const c = N.toLatex(x);
        return `${N.sign(x) < 0 ? `\\left(${c}\\right)` : c}${M.latex(colVec(a.col(j)))}`;
      });
      ctx.steps.push({ title: 'Matrix-vector product as a linear combination of the columns', items: [{ text: `${terms.join(' + ')} = ${M.latex(out)}` }] });
    }
    return out;
  }
  function vInv(a, ctx, steps) {
    if (N.isNum(a)) return N.inv(a);
    if (a instanceof Eye) return new Eye(N.inv(a.s));
    const m = asMatrix(a, ctx);
    if (m.r === 1 && m.c === 1) return new Matrix([[N.inv(m.a[0][0])]]);
    return M.inverse(m, steps);
  }
  function vPow(a, e, ctx) {
    if (a instanceof Info && a.value) a = a.value;
    const ex = asScalar(e, 'a number exponent');
    if (N.isNum(a)) return N.pow(a, ex);
    if (!N.isInt(ex)) throw new MathError('Matrix powers must be integers (e.g. A^2, A^-1).');
    const k = Number(N.isR(ex) ? ex.n : ex);
    if (a instanceof Eye) return new Eye(N.powInt(a.s, k));
    if (k === -1) return vInv(a, ctx);
    return M.pow(a, k);
  }
  function vT(a, ctx) {
    if (a instanceof Info && a.value) a = a.value;
    if (N.isNum(a) || a instanceof Eye) return a;
    return M.transpose(a);
  }

  function innerProduct(a, b, ctx, weighted = true) {
    if (N.isNum(a) && N.isNum(b)) return N.mul(a, b);
    const A = asMatrix(a, ctx), B = asMatrix(b, ctx);
    if (A.isVector && B.isVector) {
      const u = asVec(A, ctx), v = asVec(B, ctx);
      if (u.length !== v.length) throw new MathError(`Inner product needs vectors of the same length (got ${u.length} and ${v.length}).`);
      const wName = weighted && ctx.settings.ipWeight;
      if (wName) {
        const W = ctx.get(wName);
        if (!isMat(W) || W.r !== u.length || W.c !== u.length)
          throw new MathError(`The weighted inner product uses ${wName}, which must be ${u.length}×${u.length}.`);
        return M.mul(M.transpose(colVec(u)), M.mul(W, colVec(v))).a[0][0];
      }
      return M.dotCols(u, v);
    }
    if (A.r === B.r && A.c === B.c) {
      let s = R.ZERO;
      A.a.forEach((row, i) => row.forEach((x, j) => { s = N.add(s, N.mul(x, B.a[i][j])); }));
      ctx.notes.push('Matrices: using the Frobenius inner product ⟨A, B⟩ = tr(AᵀB).');
      return s;
    }
    throw new MathError(`Can't take the inner product of a ${A.dims} and a ${B.dims}.`);
  }

  // ---------- Evaluator ----------
  function evaluate(node, ctx) {
    switch (node.type) {
      case 'num': return N.parseLiteral(node.v);
      case 'group': return evaluate(node.a, ctx);
      case 'var': return lookup(node.name, ctx, node);
      case 'neg': return vNeg(evaluate(node.a, ctx));
      case 'T': return vT(evaluate(node.a, ctx), ctx);
      case 'pow': return vPow(evaluate(node.a, ctx), evaluate(node.e, ctx), ctx);
      case 'ip': return innerProduct(evaluate(node.a, ctx), evaluate(node.b, ctx), ctx);
      case 'bin': {
        const a = evaluate(node.l, ctx), b = evaluate(node.r, ctx);
        if (node.op === '+') return vAdd(a, b, ctx);
        if (node.op === '-') return vAdd(a, vNeg(b), ctx);
        if (node.op === '*') return vMul(a, b, ctx);
        if (node.op === '/') {
          const bb = b instanceof Info && b.value ? b.value : b;
          if (N.isNum(bb) || (isMat(bb) && bb.r === 1 && bb.c === 1)) return vMul(a, N.inv(asScalar(bb)), ctx);
          throw new MathError("Matrix division isn't defined. Use A*B^-1, B^-1*A, or solve(A, b).");
        }
        break;
      }
      case 'matrix': {
        const rows = node.rows.map((row) =>
          row.map((e) => {
            let v = evaluate(e, ctx);
            if (v instanceof Info && v.value) v = v.value;
            if (N.isNum(v)) return new Matrix([[v]]);
            if (isMat(v)) return v;
            throw new MathError("Can't place I inside a matrix literal without a size — use I(n).");
          })
        );
        const out = M.vcat(rows.map((r) => M.hcat(r)));
        if (node.bars && node.bars.some((b) => b !== null)) {
          // column index of the bar in each row (blocks can span several columns)
          const cols = node.bars.map((b, i) => (b === null ? null : rows[i].slice(0, b).reduce((s, m) => s + m.c, 0)));
          const first = cols.find((c) => c !== null);
          if (cols.some((c) => c === null)) throw new MathError('Put a "|" in every row of an augmented matrix (or use [A | b] with blocks).');
          if (cols.some((c) => c !== first)) throw new MathError('The "|" bars must line up in every row.');
          out.aug = out.c - first;
        }
        return out;
      }
      case 'index': {
        const base = lookup(node.name, ctx, node);
        const args = node.args.map((a) => evaluate(a, ctx));
        if (isMat(base)) {
          const ints = args.every((a) => N.isNum(a) && N.isInt(a));
          if (ints && args.length === 2) {
            const [i, j] = args.map((a) => asInt(a));
            if (i < 1 || j < 1 || i > base.r || j > base.c) throw new MathError(`Index (${i}, ${j}) is outside a ${base.dims} matrix (indices start at 1).`);
            return base.a[i - 1][j - 1];
          }
          if (ints && args.length === 1 && base.isVector) {
            const v = asVec(base, ctx), k = asInt(args[0]);
            if (k < 1 || k > v.length) throw new MathError(`Index ${k} is outside a vector of length ${v.length}.`);
            return v[k - 1];
          }
        }
        if (args.length === 1) return vMul(base, args[0], ctx);
        throw new MathError(`Can't index ${node.name} like that — use ${node.name}(i, j).`);
      }
      case 'call': {
        const f = FUNCS[node.name];
        const args = node.args.map((a) => evaluate(a, ctx));
        if (args.length < f.min || args.length > f.max) {
          throw new MathError(`${node.name} takes ${f.min === f.max ? f.min : `${f.min}–${f.max}`} argument${f.max > 1 ? 's' : ''}: ${f.sig}`);
        }
        return f.fn(args, ctx, node);
      }
    }
    throw new MathError('Unsupported expression');
  }

  function lookup(name, ctx, node) {
    const v = ctx.get(name);
    if (v !== undefined) return v;
    if (name === 'I') return new Eye(R.ONE);
    let m;
    if ((m = /^I(\d+)$/.exec(name))) return M.identity(+m[1]);
    if (name === 'pi') return Math.PI;
    if (name === 'ans') throw new MathError('No previous answer yet.');
    throw new MathError(`Unknown name "${name}". Define it first, e.g. ${name} = [1 2; 3 4], or build it in the matrix editor and press Save.`);
  }

  // ---------- Functions ----------
  const stepsFor = (ctx, title) => {
    if (!ctx.wantSteps) return null;
    const g = { title, items: [] };
    ctx.steps.push(g);
    return g.items;
  };
  const labelOf = (node, i = 0) => (node && node.args && node.args[i] ? LA.exprText(node.args[i]) : 'A');
  const colsMatrix = (vs) => M.fromCols(vs);

  function def(names, sig, min, max, fn, doc) {
    for (const n of names.split(' ')) FUNCS[n] = { sig, min, max, fn, doc };
  }

  def('inv', 'inv(A)', 1, 1, ([a], ctx, node) => vInv(a, ctx, stepsFor(ctx, `Inverse of ${labelOf(node)} by row-reducing [A | I]`)), 'inverse');
  def('det', 'det(A)', 1, 1, ([a], ctx, node) => {
    const A = asMatrix(a, ctx);
    return M.det(A, stepsFor(ctx, `Determinant of ${labelOf(node)}`));
  }, 'determinant');
  def('tr trace', 'tr(A)', 1, 1, ([a], ctx) => M.trace(asMatrix(a, ctx)), 'trace');
  def('rank', 'rank(A)', 1, 1, ([a], ctx) => N.fromInt(M.rank(asMatrix(a, ctx))), 'rank');
  def('nullity', 'nullity(A)', 1, 1, ([a], ctx) => { const A = asMatrix(a, ctx); return N.fromInt(A.c - M.rank(A)); }, 'nullity = dim Null(A) = #columns − rank');
  def('rref', 'rref(A)', 1, 1, ([a], ctx, node) => M.rref(asMatrix(a, ctx), stepsFor(ctx, `Row reduction of ${labelOf(node)}`)), 'reduced row echelon form');
  def('ref', 'ref(A)', 1, 1, ([a], ctx, node) => M.ref(asMatrix(a, ctx), stepsFor(ctx, `Row echelon form of ${labelOf(node)}`)), 'row echelon form');
  def('elim ea', 'elim(A)', 1, 1, ([a], ctx) => {
    const A = asMatrix(a, ctx);
    const { Es, E, R: Rm } = M.elimFactor(A);
    const blocks = [{ tex: `EA = R,\\quad E = E_{${Es.length || 0}}\\cdots E_{1}` }];
    if (!Es.length) blocks.push({ text: 'A is already in reduced row echelon form, so E = I.' });
    Es.forEach(({ op, E: Ek }, k) => blocks.push({ tex: `E_{${k + 1}} = ${M.latex(Ek)}\\quad(${M.opLatex(op)})` }));
    blocks.push({ label: 'E', tex: M.latex(E) }, { label: 'R', tex: M.latex(Rm) });
    if (A.isSquare && Rm.a.every((r, i) => r.every((x, j) => (i === j ? N.isOne(x) : N.isZero(x))))) {
      blocks.push({ text: 'R = I, so E = A⁻¹ — and A = E₁⁻¹E₂⁻¹⋯Eₖ⁻¹ is a product of elementary matrices.' });
    }
    return new Info('Elimination as matrix multiplication: EA = R', blocks, { E, R: Rm }, E);
  }, 'elementary matrices with EA = rref(A)');
  def('about adjectives props', 'about(A)', 1, 1, ([a], ctx) => aboutInfo(asMatrix(a, ctx)), 'matrix "adjectives": symmetric, triangular, REF/RREF, rank, nonsingular…');
  def('augment', 'augment(A, B)', 2, 2, ([a, b], ctx) => {
    const A = asMatrix(a, ctx), B = asMatrix(b, ctx);
    if (A.r !== B.r) throw new MathError(`Can't augment: ${A.dims} and ${B.dims} have different numbers of rows.`);
    const AB = M.hcat([A, B]);
    AB.aug = B.c;
    return AB;
  }, '[A | B]');
  def('innull', 'innull(A, v)', 2, 2, ([a, b], ctx) => {
    const A = asMatrix(a, ctx), v = colVec(asVec(b, ctx));
    const Av = M.mul(A, v);
    const yes = Av.a.every((r) => N.isZero(r[0]));
    return new Info('Is v in Null(A)?', [
      { tex: `A v = ${M.latex(A)}${M.latex(v)} = ${M.latex(Av)}` },
      { text: yes ? '✓ Yes — Av = 0, so v ∈ Null(A).' : '✗ No — Av ≠ 0, so v ∉ Null(A).' },
    ]);
  }, 'check whether Av = 0');
  def('incol', 'incol(A, b)', 2, 2, ([a, b], ctx, node) => {
    const A = asMatrix(a, ctx);
    return membershipInfo(A, colVec(asVec(b, ctx)), 'col', stepsFor(ctx, `Row reducing [${labelOf(node, 0)} | ${labelOf(node, 1)}]`));
  }, 'is b in Col(A)? (row reduce [A | b])');
  def('inrow', 'inrow(A, v)', 2, 2, ([a, b], ctx, node) => {
    const A = asMatrix(a, ctx);
    return membershipInfo(M.transpose(A), colVec(asVec(b, ctx)), 'row', stepsFor(ctx, `Row reducing [${labelOf(node, 0)}ᵀ | ${labelOf(node, 1)}]`));
  }, 'is v in Row(A)? (same as v ∈ Col(Aᵀ))');
  def('inspan', 'inspan(b, v1, v2, …)', 2, 12, (args, ctx) => {
    const vs = args.slice(1).map((x) => asVec(x, ctx));
    const n = vs[0].length;
    if (vs.some((v) => v.length !== n)) throw new MathError('The spanning vectors must all have the same length.');
    return membershipInfo(M.fromCols(vs), colVec(asVec(args[0], ctx)), 'span', stepsFor(ctx, 'Row reducing [v₁ ⋯ vₖ | b]'));
  }, 'is b a linear combination of v1, v2, …?');
  def('gm', 'gm(A, λ)', 2, 2, ([a, l], ctx, node) => multiplicityInfo(asMatrix(a, ctx), asScalar(l, 'a number λ'), 'gm', stepsFor(ctx, `Row reducing ${N.toText(asScalar(l))}I − ${labelOf(node)}`)), 'geometric multiplicity: nullity(λI − A)');
  def('am', 'am(A, λ)', 2, 2, ([a, l], ctx) => multiplicityInfo(asMatrix(a, ctx), asScalar(l, 'a number λ'), 'am', null), 'algebraic multiplicity: multiplicity of λ as a root of χ_A(t)');
  def('iseig', 'iseig(A, λ)', 2, 2, ([a, l], ctx) => {
    const A = asMatrix(a, ctx), lam = asScalar(l, 'a number λ');
    if (!A.isSquare) throw new MathError('Eigenvalues need a square matrix.');
    const B = M.sub(M.scale(lam, M.identity(A.r)), A);
    const R2 = M.rref(B), rk = M.rank(B), gm = A.r - rk;
    const L = N.toLatex(lam);
    return new Info(`Is λ = ${N.toText(lam)} an eigenvalue?`, [
      { tex: `${L}I - A = ${M.latex(B)},\\qquad \\operatorname{rref}(${L}I - A) = ${M.latex(R2)}` },
      { text: gm > 0
        ? `✓ Yes — ${N.toText(lam)}I − A is singular (rank ${rk} < ${A.r}), so λ = ${N.toText(lam)} is an eigenvalue.`
        : `✗ No — ${N.toText(lam)}I − A is nonsingular (rref is I), so λ = ${N.toText(lam)} is not an eigenvalue.` },
      ...(gm > 0 ? [{ tex: `\\operatorname{gm}_A(${L}) = \\operatorname{nullity}(${L}I - A) = ${gm}` },
        { tex: `\\mathcal{E}_A(${L}) = \\operatorname{Null}(${L}I - A) = \\operatorname{span}\\left\\{${M.nullspace(B).map((v) => M.latex(colVec(v))).join(',\\ ')}\\right\\}` }] : []),
    ]);
  }, 'is λ an eigenvalue? (rref of λI − A, gm)');
  def('iseigvec', 'iseigvec(A, v, λ)', 3, 3, ([a, b, l], ctx) => {
    const A = asMatrix(a, ctx), v = colVec(asVec(b, ctx)), lam = asScalar(l, 'a number λ');
    const Av = M.mul(A, v), lv = M.scale(lam, v);
    const yes = M.equals(Av, lv) && !v.a.every((r) => N.isZero(r[0]));
    const blocks = [
      { tex: `A v = ${M.latex(Av)},\\qquad ${N.toLatex(lam)}\\,v = ${M.latex(lv)}` },
      { text: v.a.every((r) => N.isZero(r[0])) ? '✗ The zero vector is never an eigenvector.' : yes ? `✓ Yes — Av = ${N.toText(lam)}v, so v is an eigenvector for λ = ${N.toText(lam)}.` : `✗ No — Av ≠ ${N.toText(lam)}v.` },
    ];
    if (A.r === 2) blocks.push({ svg: plotSvg([{ v: v.col(0), label: 'v' }, { v: Av.col(0), label: 'Av' }]), text: 'v is an eigenvector exactly when Av is parallel to v.' });
    return new Info('Is v an eigenvector?', blocks);
  }, 'check whether Av = λv');
  def('plot', 'plot(u, v, …)', 1, 8, (args, ctx, node) => {
    const vs = args.map((x, i) => {
      const v = asVec(x, ctx);
      if (v.length !== 2) throw new MathError('plot draws vectors in ℝ² — each argument must have 2 entries.');
      return { v, label: node && node.args[i] ? exprText(node.args[i]) : `v${i + 1}` };
    });
    return new Info('Vectors in ℝ²', [{ svg: plotSvg(vs) }]);
  }, 'draw 2D vectors');
  def('factor', 'factor(A)', 1, 1, ([a], ctx) => {
    const A = asMatrix(a, ctx);
    const f = M.commonFactor(A);
    if (!f) {
      return new Info('Factor out a common fraction', [{ text: A.a.every((r) => r.every(N.isR)) ? 'No fractions to factor out — the entries are already integers.' : 'Factoring needs exact rational entries (this matrix has square roots or decimals).' }]);
    }
    return new Info('Factor out a common fraction', [
      { tex: `${M.latex(A, 0, { factor: false })} = ${N.toLatex(f.c)}${M.latex(f.K, 0, { factor: false })}` },
      { text: `c = ${N.toText(f.c)} is the gcd of the numerators over the lcm of the denominators, so the matrix left over has integer entries with no common factor.` },
    ], { c: f.c, K: f.K }, f.K); // K = factor(A) saves the integer matrix
  }, 'write A = c·K with K an integer matrix');
  def('transpose', 'transpose(A)', 1, 1, ([a], ctx) => vT(a, ctx), 'transpose');
  def('gram', 'gram(A)', 1, 1, ([a], ctx) => { const A = asMatrix(a, ctx); ctx.notes.push('Gram matrix G = AᵀA: entry (i, j) is ⟨aᵢ, aⱼ⟩ for columns aᵢ of A.'); return M.mul(M.transpose(A), A); }, 'Gram matrix AᵀA');
  def('norm', 'norm(v)', 1, 1, ([a], ctx) => {
    if (N.isNum(a)) return N.abs(a);
    const A = asMatrix(a, ctx);
    return N.sqrt(innerProduct(A, A, ctx));
  }, 'length ‖v‖ = √⟨v, v⟩');
  def('abs', 'abs(x)', 1, 1, ([a], ctx) => {
    if (N.isNum(a)) return N.abs(a);
    const A = asMatrix(a, ctx);
    if (A.r === 1 && A.c === 1) return N.abs(A.a[0][0]);
    if (A.isSquare) { ctx.notes.push('|A| of a square matrix is read as det(A).'); return M.det(A); }
    throw new MathError('|·| needs a number or a square matrix (for det).');
  }, 'absolute value, or det for |A|');
  def('unit normalize', 'unit(v)', 1, 1, ([a], ctx) => {
    const A = asMatrix(a, ctx);
    const n = N.sqrt(innerProduct(A, A, ctx, false));
    if (N.isZero(n)) throw new MathError("The zero vector can't be normalized.");
    return M.scale(N.inv(n), A);
  }, 'v / ‖v‖');
  def('dot', 'dot(u, v)', 2, 2, ([a, b], ctx) => innerProduct(a, b, ctx, false), 'standard dot product');
  def('ip', 'ip(u, v)', 2, 2, ([a, b], ctx) => innerProduct(a, b, ctx), 'inner product (respects the weight setting)');
  def('cross', 'cross(u, v)', 2, 2, ([a, b], ctx) => {
    const u = asVec(a, ctx), v = asVec(b, ctx);
    if (u.length !== 3 || v.length !== 3) throw new MathError('Cross product is only defined for vectors in ℝ³.');
    return colVec(M.cross(u, v));
  }, 'cross product in ℝ³');
  def('projmat projection', 'projmat(X) or projmat(v1, v2, …)', 1, 12, (args, ctx, node) => {
    // One matrix argument: V = Col(X). Several vectors: V = span of them (like the course's basis_of_V).
    let X;
    if (args.length === 1) {
      const a = args[0];
      if (a instanceof Info && !a.value) throw new MathError('That subspace is {0}, so its projection matrix is the zero matrix.');
      X = asMatrix(a, ctx);
    } else {
      const vs = args.map((x) => asVec(x, ctx));
      if (vs.some((v) => v.length !== vs[0].length)) throw new MathError('The spanning vectors must all have the same length.');
      X = M.fromCols(vs);
    }
    return projMatrixInfo(X, node && args.length === 1 ? labelOf(node) : null);
  }, 'projection matrix P_V = X(XᵀX)⁻¹Xᵀ onto V = Col(X)');
  def('subspaces fourfund', 'subspaces(A)', 1, 1, ([a], ctx) => fourSubspacesInfo(asMatrix(a, ctx)), 'the four fundamental subspaces: bases, dimensions, projection matrices');
  def('proj', 'proj(v, u)', 2, 2, ([a, b], ctx) => {
    const v = asMatrix(a, ctx), U = asMatrix(b, ctx);
    if (U.c === 1 || U.r === 1) {
      const u = colVec(asVec(U, ctx));
      const uu = innerProduct(u, u, ctx);
      if (N.isZero(uu)) throw new MathError("Can't project onto the zero vector.");
      ctx.notes.push('proj_u(v) = (⟨v, u⟩ / ⟨u, u⟩) u');
      return M.scale(N.div(innerProduct(v, u, ctx), uu), u);
    }
    const B = colsMatrix(M.colspace(U));
    ctx.notes.push('Projection onto Col(U): B(BᵀB)⁻¹Bᵀv, where B is a basis of the column space.');
    const Bt = M.transpose(B);
    return M.mul(B, M.mul(M.inverse(M.mul(Bt, B)), M.mul(Bt, v)));
  }, 'projection of v onto u (or onto Col(U))');
  def('angle', 'angle(u, v)', 2, 2, ([a, b], ctx) => {
    const uv = innerProduct(a, b, ctx);
    const nu = N.sqrt(innerProduct(a, a, ctx)), nv = N.sqrt(innerProduct(b, b, ctx));
    if (N.isZero(nu) || N.isZero(nv)) throw new MathError('Angle with the zero vector is undefined.');
    const c = N.div(uv, N.mul(nu, nv));
    const th = Math.acos(Math.max(-1, Math.min(1, N.toF(c))));
    return new Info('Angle between vectors', [
      { tex: `\\cos\\theta = \\frac{\\langle u, v\\rangle}{\\lVert u\\rVert\\,\\lVert v\\rVert} = ${N.toLatex(c)}` },
      { tex: `\\theta \\approx ${N.fmtFloat((th * 180) / Math.PI, 6)}^\\circ \\approx ${N.fmtFloat(th, 6)}\\text{ rad}` },
    ], {}, th);
  }, 'angle between vectors');
  def('dist', 'dist(u, v)', 2, 2, ([a, b], ctx) => { const d = vAdd(a, vNeg(b), ctx); return N.sqrt(innerProduct(d, d, ctx)); }, 'distance ‖u − v‖');
  def('null nullspace kernel', 'null(A)', 1, 1, ([a], ctx) => {
    const basis = M.nullspace(asMatrix(a, ctx));
    if (!basis.length) return new Info('Null space', [{ tex: '\\operatorname{Nul}(A) = \\{\\mathbf 0\\}' }, { text: 'Only the trivial solution: the columns are linearly independent.' }]);
    ctx.notes.push(`${basis.length > 1 ? `These ${basis.length} columns form` : 'This column forms'} a basis of Nul(A) (dimension ${basis.length}).`);
    return colsMatrix(basis);
  }, 'basis of the null space');
  def('col colspace range', 'col(A)', 1, 1, ([a], ctx) => {
    const cs = M.colspace(asMatrix(a, ctx));
    if (!cs.length) return new Info('Column space', [{ tex: '\\operatorname{Col}(A) = \\{\\mathbf 0\\}' }]);
    ctx.notes.push(`Pivot columns of A form a basis of Col(A) (dimension ${cs.length}).`);
    return colsMatrix(cs);
  }, 'basis of the column space');
  def('row rowspace', 'row(A)', 1, 1, ([a], ctx) => {
    const rs = M.rowspace(asMatrix(a, ctx));
    if (!rs.length) return new Info('Row space', [{ tex: '\\operatorname{Row}(A) = \\{\\mathbf 0\\}' }]);
    ctx.notes.push('Nonzero rows of rref(A) form a basis of Row(A); shown here as columns.');
    return colsMatrix(rs);
  }, 'basis of the row space (as columns)');
  def('solve', 'solve(A, b)', 2, 2, ([a, b], ctx, node) => {
    const A = asMatrix(a, ctx), B = asMatrix(b, ctx);
    const res = M.solve(A, B, stepsFor(ctx, `Solving ${labelOf(node, 0)}x = ${labelOf(node, 1)}`));
    return solutionInfo(res, A, B);
  }, 'solve Ax = b (all solutions)');
  def('lsq xhat leastsquares', 'lsq(A, b)', 2, 2, ([a, b], ctx) => leastSquaresInfo(asMatrix(a, ctx), colVec(asVec(b, ctx)), stepsFor(ctx, 'Row reducing the normal equations [AᵀA | Aᵀb]')), 'least squares: normal equations, x̂, projection Ax̂, error E');
  def('pinv pseudoinverse', 'pinv(A)', 1, 1, ([a], ctx) => pinvInfo(asMatrix(a, ctx)), 'Moore–Penrose pseudoinverse A⁺ (exact)');
  def('fit linefit', 'fit(points, degree)', 1, 2, (args, ctx) => {
    const P = asMatrix(args[0], ctx);
    let ts, ys, deg = 1;
    if (args[1] !== undefined && !N.isNum(args[1]) && asMatrix(args[1], ctx).isVector) {
      ts = asVec(P, ctx); ys = asVec(args[1], ctx); // fit(t, y)
    } else {
      if (P.c !== 2) throw new MathError('Give the data points as the rows of an n×2 matrix, e.g. fit([1 6; 2 5; 3 7; 4 10]).');
      ts = P.col(0); ys = P.col(1);
      if (args[1] !== undefined) deg = asInt(args[1], 'a degree');
    }
    if (ts.length !== ys.length) throw new MathError('t and y need the same number of entries.');
    if (deg < 0 || deg > 6) throw new MathError('Degree must be between 0 and 6.');
    return fitInfo(ts, ys, deg);
  }, 'least-squares line (or polynomial) of best fit, with a plot');
  def('char charpoly', 'charpoly(A)', 1, 1, ([a], ctx) => {
    const c = M.charpoly(asMatrix(a, ctx));
    return new Info('Characteristic polynomial', [{ tex: `\\chi_A(t) = \\det(tI - A) = ${M.polyLatex(c, 't')}` }]);
  }, 'characteristic polynomial');
  def('eig eigen', 'eig(A)', 1, 1, ([a], ctx) => eigenInfo(asMatrix(a, ctx)), 'eigenvalues, eigenvectors, diagonalization');
  def('lu palu', 'lu(A)', 1, 1, ([a], ctx, node) => {
    const A = asMatrix(a, ctx);
    const { P, L, U, swapped } = M.lu(A, stepsFor(ctx, `PA = LU for ${labelOf(node)} — each step shows [U | L | P]`));
    const blocks = [{ tex: 'PA = LU' }];
    if (!swapped) blocks.push({ text: 'No row swaps were needed, so P = I and A = LU.' });
    blocks.push({ label: 'P', tex: M.latex(P) }, { label: 'L', tex: M.latex(L) }, { label: 'U', tex: M.latex(U) });
    const parts = { P, L, U };
    return new Info('LU factorization', blocks, parts);
  }, 'LU factorization');
  def('qr', 'qr(A)', 1, 1, ([a], ctx, node) => qrInfo(asMatrix(a, ctx), stepsFor(ctx, `Gram–Schmidt on the columns of ${labelOf(node)}`)), 'A = QR via Gram–Schmidt, with P = QQᵀ');
  def('qrlsq', 'qrlsq(A, b) or qrlsq(Q, R, b)', 2, 3, (args, ctx) => {
    let Q, Rm, A;
    const b = colVec(asVec(args[args.length - 1], ctx));
    if (args.length === 3) {
      Q = asMatrix(args[0], ctx); Rm = asMatrix(args[1], ctx);
      if (!M.equals(M.mul(M.transpose(Q), Q), M.identity(Q.c))) throw new MathError('Q must have orthonormal columns (QᵀQ = I).');
      if (!Rm.isSquare || Rm.a.some((row, i) => row.some((x, j) => i > j && !N.isZero(x)))) throw new MathError('R must be square and upper-triangular.');
      A = M.mul(Q, Rm);
    } else {
      A = asMatrix(args[0], ctx);
      ({ Q, R: Rm } = qrFactor(A));
    }
    const At = M.transpose(A), Qtb = M.mul(M.transpose(Q), b);
    const N1 = M.hcat([M.mul(At, A), M.mul(At, b)]); N1.aug = 1;
    const N2 = M.hcat([Rm, Qtb]); N2.aug = 1;
    const R2 = M.rref(N2);
    const xh = new Matrix(R2.a.map((r) => [r[r.length - 1]]));
    return new Info('Least squares with A = QR', [
      { tex: `A = QR = ${M.latex(Q)}${M.latex(Rm)} = ${M.latex(A)}` },
      { text: 'Original least squares system:' },
      { tex: `[A^{\\mathsf T}A \\mid A^{\\mathsf T}b] = ${M.latex(N1)}` },
      { text: 'Since AᵀA = RᵀQᵀQR = RᵀR and Rᵀ is invertible, it reduces to Rx̂ = Qᵀb:' },
      { tex: `[R \\mid Q^{\\mathsf T}b] = ${M.latex(N2)},\\qquad \\operatorname{rref}[R \\mid Q^{\\mathsf T}b] = ${M.latex(R2)}` },
      { tex: `\\hat x = ${M.latex(xh)}` },
    ], { xhat: xh }, xh);
  }, 'least squares via QR: [R | Qᵀb]');
  def('gs gramschmidt', 'gs(A) or gs(v1, v2, …)', 1, 12, (args, ctx) => {
    const X = colsArg(args, ctx);
    return gsInfo(X, stepsFor(ctx, 'Gram–Schmidt: wₖ = vₖ − Σ proj_{wᵢ}(vₖ)'));
  }, 'Gram–Schmidt: mutually orthogonal and orthonormal bases');
  def('orth', 'orth(A) or orth(v1, …)', 1, 12, (args, ctx) => M.normalizeCols(M.gramSchmidt(colsArg(args, ctx), stepsFor(ctx, 'Gram–Schmidt'))), 'orthonormal basis of the span (as columns)');
  def('comp', 'comp(v, v1)', 2, 2, ([a, b], ctx) => {
    const v = asVec(a, ctx), u = asVec(b, ctx);
    if (v.length !== u.length) throw new MathError('comp needs two vectors of the same length.');
    const uu = M.dotCols(u, u);
    if (N.isZero(uu)) throw new MathError('Can\'t take a component along the zero vector.');
    const c = N.div(M.dotCols(u, v), N.sqrt(uu));
    ctx.notes.push('comp_{v₁}(v) = (v₁ · v) / ‖v₁‖ — the signed length of proj_{v₁}(v).');
    return c;
  }, 'scalar component of v in the direction of v1');
  def('isorthonormal orthonormal isorth', 'isorthonormal(Q) or isorthonormal(v1, …)', 1, 12, (args, ctx) => {
    const Q = colsArg(args, ctx);
    const G = M.mul(M.transpose(Q), Q);
    const on = M.equals(G, M.identity(Q.c));
    const og = G.a.every((r, i) => r.every((x, j) => i === j || N.isZero(x)));
    return new Info('Orthonormal?', [
      { tex: `Q = ${M.latex(Q)},\\qquad Q^{\\mathsf T}Q = ${M.latex(G)}` },
      { text: on ? '✓ Yes — QᵀQ = I, so the columns are orthonormal.'
        : og ? '✗ Not orthonormal, but the columns are mutually orthogonal (QᵀQ is diagonal) — divide each by its length to normalize.'
        : '✗ No — QᵀQ ≠ I (some columns are not orthogonal).' },
    ]);
  }, 'check QᵀQ = I');
  def('perp orthcomp', 'perp(X) or perp(v1, v2, …)', 1, 12, (args, ctx) => {
    const X = colsArg(args, ctx);
    const basis = M.nullspace(M.transpose(X));
    const dimV = M.rank(X), n = X.r;
    const blocks = [
      { tex: `V = \\operatorname{Col}(X),\\ X = ${M.latex(X)},\\qquad V^{\\perp} = \\operatorname{Null}(X^{\\mathsf T})` },
      { tex: `\\operatorname{rref}(X^{\\mathsf T}) = ${M.latex(M.rref(M.transpose(X)))}` },
      { tex: `V^{\\perp} = ${basis.length ? `\\operatorname{span}\\left\\{${basis.map((v) => M.latex(colVec(v))).join(',\\ ')}\\right\\}` : '\\{\\mathbf 0\\}'}` },
      { text: `dim V + dim V⊥ = ${dimV} + ${basis.length} = ${n}. Any basis with the same span is equally correct (Sage may print a different one).` },
    ];
    return new Info('Orthogonal complement', blocks, basis.length ? { Vperp: M.fromCols(basis) } : {}, basis.length ? M.fromCols(basis) : null);
  }, 'basis of the orthogonal complement V⊥ = Null(Xᵀ)');
  def('isindep indep', 'isindep(A) or isindep(v1, v2, …)', 1, 12, (args, ctx) => indepInfo(colsArg(args, ctx)), 'linear independence: nullity = 0? (shows a dependence if not)');
  def('basis', 'basis(v1, v2, …) or basis(A)', 1, 12, (args, ctx) => {
    const X = colsArg(args, ctx);
    const { pivots } = M.eliminate(X, { reduced: false });
    if (!pivots.length) return new Info('Basis of the span', [{ text: 'All vectors are zero, so the span is {0} (empty basis, dimension 0).' }]);
    const B = M.fromCols(pivots.map((j) => X.col(j)));
    return new Info('Basis of the span', [
      { tex: `\\operatorname{rref}${M.latex(X)} = ${M.latex(M.rref(X))}` },
      { text: `Pivot columns ${pivots.map((p) => p + 1).join(', ')} form a basis; the span has dimension ${pivots.length}.` },
      { tex: M.latex(B) },
    ], { B }, B);
  }, 'basis (pivot columns) and dimension of a span');
  def('adj', 'adj(A)', 1, 1, ([a], ctx) => M.adjugate(asMatrix(a, ctx)), 'adjugate');
  def('cof', 'cof(A)', 1, 1, ([a], ctx) => M.cofactorMatrix(asMatrix(a, ctx)), 'cofactor matrix');
  def('minor', 'minor(A, i, j)', 3, 3, ([a, i, j], ctx) => {
    const A = asMatrix(a, ctx), r = asInt(i), c = asInt(j);
    if (r < 1 || c < 1 || r > A.r || c > A.c) throw new MathError('Minor index out of range (indices start at 1).');
    return M.det(M.minorMatrix(A, r - 1, c - 1));
  }, 'minor M_ij (det with row i, col j deleted)');
  def('I eye', 'I(n)', 1, 1, ([n]) => M.identity(asInt(n, 'a size')), 'n×n identity');
  def('zeros', 'zeros(m, n)', 1, 2, ([m, n]) => M.zeros(asInt(m), n ? asInt(n) : asInt(m)), 'zero matrix');
  def('ones', 'ones(m, n)', 1, 2, ([m, n]) => M.fill(asInt(m), n ? asInt(n) : asInt(m), R.ONE), 'all-ones matrix');
  def('rand', 'rand(m, n)', 1, 2, ([m, n]) => M.random(asInt(m), n ? asInt(n) : asInt(m)), 'random integer matrix');
  def('diag', 'diag(a, b, …)', 1, 20, (args, ctx) => {
    if (args.length === 1 && !N.isNum(args[0])) {
      const A = asMatrix(args[0], ctx);
      if (A.isVector) return M.diag(asVec(A, ctx));
      return colVec(A.a.slice(0, Math.min(A.r, A.c)).map((r, i) => r[i]));
    }
    return M.diag(args.map((x) => asScalar(x)));
  }, 'diagonal matrix, or diagonal of A');
  def('sqrt', 'sqrt(x)', 1, 1, ([x]) => N.sqrt(asScalar(x)), 'square root');
  def('size dim', 'size(A)', 1, 1, ([a], ctx) => {
    const A = asMatrix(a, ctx);
    return new Info('Size', [{ tex: `${A.r} \\times ${A.c}` }]);
  }, 'dimensions');

  // Is b in Col(A) / Row(A) / span? Row reduce [A | b]: consistent ⇔ yes, and a solution gives the combination.
  function membershipInfo(A, b, kind, steps) {
    if (A.r !== b.r) throw new MathError(`b has ${b.r} entries but the ${kind === 'row' ? 'rows of A have' : 'columns have'} ${A.r}; they must match.`);
    const aug = M.hcat([A, b]);
    aug.aug = 1;
    const res = M.solve(A, b, steps);
    const R2 = M.rref(aug);
    const where = kind === 'col' ? '\\operatorname{Col}(A)' : kind === 'row' ? '\\operatorname{Row}(A)' : '\\operatorname{span}\\{v_1, \\dots, v_k\\}';
    const vec = kind === 'row' ? 'v' : 'b';
    const name = (j) => (kind === 'col' ? `a_{${j + 1}}` : kind === 'row' ? `r_{${j + 1}}` : `v_{${j + 1}}`);
    const title = kind === 'col' ? 'Is b in the column space?' : kind === 'row' ? 'Is v in the row space?' : 'Is b in the span?';
    const blocks = [{ tex: `\\operatorname{rref}${M.latex(aug)} = ${M.latex(R2)}` }];
    if (res.kind === 'none') {
      blocks.push({ text: `✗ No — there is a pivot in the last column (a row reads 0 = 1), so the system is inconsistent and ${vec} is not a linear combination of the ${kind === 'row' ? 'rows of A' : kind === 'col' ? 'columns of A' : 'given vectors'}.` });
      blocks.push({ tex: `${vec} \\notin ${where}` });
      return new Info(title, blocks);
    }
    const x = (res.kind === 'unique' ? res.x : res.xp).col(0);
    const terms = x.map((c, j) => ({ c, j })).filter(({ c }) => !N.isZero(c));
    const combo = terms.length
      ? terms.map(({ c, j }, k) => {
          const neg = N.sign(c) < 0, a = N.abs(c);
          const coef = N.isOne(a) ? '' : N.toLatex(a);
          return `${k === 0 ? (neg ? '-' : '') : neg ? ' - ' : ' + '}${coef}${name(j)}`;
        }).join('')
      : '0';
    blocks.push({ text: `✓ Yes — no pivot in the last column, so the system is consistent and ${vec} is a linear combination of the ${kind === 'row' ? 'rows of A' : kind === 'col' ? 'columns of A' : 'given vectors'}:` });
    blocks.push({ tex: `${vec} = ${combo}${res.kind === 'infinite' ? '\\quad(\\text{one of infinitely many ways})' : ''}` });
    const full = x.map((c, j) => `${N.sign(c) < 0 ? `\\left(${N.toLatex(c)}\\right)` : N.toLatex(c)}${M.latex(colVec(A.col(j)))}`).join(' + ');
    if (A.c <= 6) blocks.push({ tex: `${full} = ${M.latex(b)}` });
    blocks.push({ tex: `${vec} \\in ${where}` });
    return new Info(title, blocks, { x: new Matrix(x.map((c) => [c])) });
  }

  // Algebraic multiplicity: how many times (t − λ) divides χ_A(t)
  function algMult(A, lam) {
    let c = M.charpoly(A), k = 0;
    while (c.length > 1 && N.isZero(M.evalPoly(c, lam))) { c = M.deflate(c, lam); k++; }
    return k;
  }
  // gm(A, λ) / am(A, λ) cards. Both report the other number too, since the point is usually comparing them.
  function multiplicityInfo(A, lam, which, steps) {
    if (!A.isSquare) throw new MathError(`Eigenvalues need a square matrix, but this one is ${A.dims}.`);
    const n = A.r, L = N.toLatex(lam);
    const LI = N.isOne(lam) ? 'I' : N.isOne(N.neg(lam)) ? '-I' : `${L}I`; // λI, written I / −I for ±1
    const B = M.sub(M.scale(lam, M.identity(n)), A);
    const { R: R2, pivots } = M.eliminate(B, { reduced: true, steps });
    const gm = n - pivots.length;
    const am = algMult(A, lam);
    const free = [];
    for (let j = 0; j < n; j++) if (!pivots.includes(j)) free.push(`x_{${j + 1}}`);
    const blocks = [];
    if (which === 'gm') {
      blocks.push({ tex: `${LI} - A = ${M.latex(B)},\\qquad \\operatorname{rref}(${LI} - A) = ${M.latex(R2)}` });
      blocks.push({ tex: `\\operatorname{gm}_A(${L}) = \\operatorname{nullity}(${LI} - A) = n - \\operatorname{rank}(${LI} - A) = ${n} - ${pivots.length} = ${gm}` });
      if (gm > 0) {
        blocks.push({ text: `${gm} free variable${gm > 1 ? 's' : ''} (${free.join(', ').replace(/[{}_]/g, '')}), so the eigenspace has dimension ${gm}:` });
        blocks.push({ tex: `\\mathcal{E}_A(${L}) = \\operatorname{Null}(${LI} - A) = \\operatorname{span}\\left\\{${M.nullspace(B).map((v) => M.latex(colVec(v))).join(',\\ ')}\\right\\}` });
      }
    } else {
      const c = M.charpoly(A);
      blocks.push({ tex: `\\chi_A(t) = \\det(tI - A) = ${M.polyLatex(c, 't')}` });
      blocks.push({ tex: `\\operatorname{am}_A(${L}) = ${am}\\quad${am ? `\\text{(}(t ${N.sign(lam) < 0 ? '+' : '-'} ${N.toLatex(N.abs(lam))})^{${am}}\\text{ divides } \\chi_A(t)\\text{)}` : `\\text{(}\\chi_A(${L}) \\neq 0\\text{)}`}` });
    }
    if (am === 0 && gm === 0) blocks.push({ text: `λ = ${N.toText(lam)} is not an eigenvalue of A (${N.toText(lam)}I − A is nonsingular), so am = gm = 0.` });
    else {
      blocks.push({ tex: `1 \\le \\operatorname{gm}_A(${L}) = ${gm} \\;\\le\\; \\operatorname{am}_A(${L}) = ${am}` });
      blocks.push({ text: gm < am
        ? `gm < am, so λ = ${N.toText(lam)} is defective: there aren't enough independent eigenvectors for it, and A is not diagonalizable.`
        : `gm = am, so λ = ${N.toText(lam)} is not defective (A is diagonalizable exactly when this holds for every eigenvalue).` });
    }
    return new Info(which === 'gm' ? `Geometric multiplicity of λ = ${N.toText(lam)}` : `Algebraic multiplicity of λ = ${N.toText(lam)}`, blocks, {}, N.fromInt(which === 'gm' ? gm : am));
  }

  // Several vector args → their matrix of columns; one arg → that matrix.
  function colsArg(args, ctx) {
    if (args.length === 1) {
      const a = args[0];
      if (a instanceof Info && !a.value) throw new MathError('That subspace is {0}.');
      return asMatrix(a, ctx);
    }
    const vs = args.map((x) => asVec(x, ctx));
    if (vs.some((v) => v.length !== vs[0].length)) throw new MathError('All vectors must have the same length.');
    return M.fromCols(vs);
  }
  const normSq = (v) => M.dotCols(v, v);

  // Exact Moore–Penrose pseudoinverse from the rank factorization A = CF:  A⁺ = Fᵀ(FFᵀ)⁻¹(CᵀC)⁻¹Cᵀ
  function pinv(A) {
    const { R: Rr, pivots } = M.eliminate(A, { reduced: true });
    if (!pivots.length) return M.zeros(A.c, A.r);
    const C = M.fromCols(pivots.map((j) => A.col(j)));
    const F = new Matrix(Rr.a.slice(0, pivots.length));
    const Ft = M.transpose(F), Ct = M.transpose(C);
    return M.mul(Ft, M.mul(M.inverse(M.mul(F, Ft)), M.mul(M.inverse(M.mul(Ct, C)), Ct)));
  }
  function pinvInfo(A) {
    const P = pinv(A);
    const full = M.rank(A) === A.c;
    return new Info('Pseudoinverse', [
      { tex: `A^{+} = ${M.latex(P)}` },
      { text: full ? 'A has independent columns, so A⁺ = (AᵀA)⁻¹Aᵀ and x̂ = A⁺b is the unique least-squares solution.'
        : 'A has dependent columns; A⁺b is the least-squares solution of smallest length (what Sage’s pseudoinverse() gives).' },
    ], { Aplus: P }, P);
  }

  function leastSquaresInfo(A, b, steps) {
    if (A.r !== b.r) throw new MathError(`A has ${A.r} rows but b has ${b.r} entries.`);
    const At = M.transpose(A);
    const Ab = M.hcat([A, b]); Ab.aug = 1;
    const AtA = M.mul(At, A), Atb = M.mul(At, b);
    const NE = M.hcat([AtA, Atb]); NE.aug = 1;
    const consistent = M.solve(A, b).kind !== 'none';
    const res = M.solve(AtA, Atb, steps);
    const xh = M.mul(pinv(A), b);
    const p = M.mul(A, xh), e = M.sub(b, p);
    const E = normSq(e.col(0));
    const blocks = [
      { tex: `[A \\mid b] = ${M.latex(Ab)},\\qquad \\operatorname{rref}[A \\mid b] = ${M.latex(M.rref(Ab))}` },
      { text: consistent ? 'Ax = b is consistent (b ∈ Col(A)), so the least-squares solution solves it exactly and E = 0.'
        : 'Ax = b is inconsistent (pivot in the last column), so solve the normal equations AᵀA x̂ = Aᵀb instead:' },
      { tex: `[A^{\\mathsf T}A \\mid A^{\\mathsf T}b] = ${M.latex(NE)},\\qquad \\operatorname{rref}[A^{\\mathsf T}A \\mid A^{\\mathsf T}b] = ${M.latex(M.rref(NE))}` },
    ];
    if (res.kind === 'unique') blocks.push({ tex: `\\hat x = ${M.latex(xh)}` });
    else {
      let tex = `\\hat x = ${M.latex(res.xp)}`;
      res.basis.forEach((v, k) => { tex += ` + ${['s', 't', 'r', 'u'][k] || `t_{${k + 1}}`}${M.latex(colVec(v))}`; });
      blocks.push({ text: 'AᵀA is singular (A has dependent columns), so there are infinitely many least-squares solutions:' });
      blocks.push({ tex });
      blocks.push({ tex: `\\text{shortest one: } \\hat x = A^{+}b = ${M.latex(xh)}` });
    }
    blocks.push({ tex: `A\\hat x = P_{\\operatorname{Col}(A)}\\,b = ${M.latex(p)},\\qquad b - A\\hat x = ${M.latex(e)}` });
    blocks.push({ tex: `E = \\lVert b - A\\hat x\\rVert^{2} = ${N.toLatex(E)}${N.isZero(E) ? '' : `\\qquad (\\lVert b - A\\hat x\\rVert = ${N.toLatex(N.sqrt(E))})`}` });
    blocks.push({ text: 'The error vector b − Ax̂ is orthogonal to Col(A): Aᵀ(b − Ax̂) = 0.' });
    return new Info('Least squares', blocks, { xhat: xh, p, e }, xh);
  }

  function fitInfo(ts, ys, deg) {
    const n = ts.length;
    if (n < deg + 1) throw new MathError(`A degree-${deg} fit needs at least ${deg + 1} points.`);
    const A = new Matrix(ts.map((t) => Array.from({ length: deg + 1 }, (_, k) => N.powInt(t, k))));
    const y = colVec(ys);
    const At = M.transpose(A);
    const NE = M.hcat([M.mul(At, A), M.mul(At, y)]); NE.aug = 1;
    const xh = M.mul(pinv(A), y);
    const c = xh.col(0);
    const e = M.sub(y, M.mul(A, xh));
    const E = normSq(e.col(0));
    const terms = [];
    for (let k = deg; k >= 0; k--) {
      const a = c[k];
      if (N.isZero(a)) continue;
      const neg = N.sign(a) < 0, m = N.abs(a);
      const body = k === 0 ? N.toLatex(m) : (N.isOne(m) ? '' : N.toLatex(m)) + (k === 1 ? 't' : `t^{${k}}`);
      terms.push((terms.length ? (neg ? ' - ' : ' + ') : neg ? '-' : '') + body);
    }
    const f = terms.join('') || '0';
    const name = ['constant', 'line', 'quadratic', 'cubic'][deg] || `degree-${deg} polynomial`;
    return new Info(`Least squares ${name} of best fit`, [
      { tex: `A = ${M.latex(A)},\\quad y = ${M.latex(y)}\\qquad(\\text{rows of } A: ${Array.from({ length: deg + 1 }, (_, k) => (k === 0 ? '1' : k === 1 ? 't_i' : `t_i^{${k}}`)).join(',\\ ')})` },
      { tex: `[A^{\\mathsf T}A \\mid A^{\\mathsf T}y] = ${M.latex(NE)},\\qquad \\operatorname{rref} = ${M.latex(M.rref(NE))}` },
      { tex: `\\hat f(t) = ${f}` },
      { tex: `E = \\textstyle\\sum_i \\big(y_i - \\hat f(t_i)\\big)^2 = ${N.toLatex(E)}` },
      { svg: fitSvg(ts.map(N.toF), ys.map(N.toF), c.map(N.toF)) },
    ], { xhat: xh }, xh);
  }
  function fitSvg(ts, ys, coef) {
    const W = 340, H = 240, pad = 28;
    const f = (t) => coef.reduce((s, a, k) => s + a * t ** k, 0);
    let x0 = Math.min(...ts), x1 = Math.max(...ts);
    const dx = (x1 - x0 || 2) * 0.15; x0 -= dx; x1 += dx;
    const samples = Array.from({ length: 81 }, (_, i) => x0 + ((x1 - x0) * i) / 80);
    const allY = ys.concat(samples.map(f));
    let y0 = Math.min(...allY), y1 = Math.max(...allY);
    const dy = (y1 - y0 || 2) * 0.12; y0 -= dy; y1 += dy;
    const X = (x) => pad + ((x - x0) / (x1 - x0)) * (W - 2 * pad), Y = (y) => H - pad - ((y - y0) / (y1 - y0)) * (H - 2 * pad);
    let g = '';
    const step = (lo, hi) => { const r = hi - lo; const p = 10 ** Math.floor(Math.log10(r / 5)); return [1, 2, 5, 10].map((k) => k * p).find((s) => r / s <= 6) || p * 10; };
    const sx = step(x0, x1), sy = step(y0, y1);
    for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) g += `<line x1="${X(x)}" y1="${pad}" x2="${X(x)}" y2="${H - pad}" stroke="var(--line)" stroke-width="${Math.abs(x) < 1e-9 ? 1.4 : 0.6}"/><text x="${X(x)}" y="${H - pad + 13}" font-size="9" fill="var(--muted)" text-anchor="middle">${+x.toFixed(6)}</text>`;
    for (let y = Math.ceil(y0 / sy) * sy; y <= y1; y += sy) g += `<line x1="${pad}" y1="${Y(y)}" x2="${W - pad}" y2="${Y(y)}" stroke="var(--line)" stroke-width="${Math.abs(y) < 1e-9 ? 1.4 : 0.6}"/><text x="${pad - 4}" y="${Y(y) + 3}" font-size="9" fill="var(--muted)" text-anchor="end">${+y.toFixed(6)}</text>`;
    const path = samples.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(f(t)).toFixed(1)}`).join(' ');
    const dots = ts.map((t, i) => `<line x1="${X(t)}" y1="${Y(ys[i])}" x2="${X(t)}" y2="${Y(f(t))}" stroke="var(--bad)" stroke-width="1" stroke-dasharray="3 2"/><circle cx="${X(t)}" cy="${Y(ys[i])}" r="4" fill="var(--accent)"/>`).join('');
    return `<svg class="vplot" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Best-fit plot">${g}<path d="${path}" fill="none" stroke="var(--good)" stroke-width="2.2"/>${dots}</svg>`;
  }

  function qrFactor(A, steps) {
    const W = M.gramSchmidt(A, steps);
    if (W.c < A.c) throw new MathError('A = QR needs linearly independent columns (Gram–Schmidt produced a zero vector).');
    const Q = M.normalizeCols(W);
    const Rm = M.mul(M.transpose(Q), A).map((x, i, j) => (i > j ? R.ZERO : x));
    return { W, Q, R: Rm };
  }
  function qrInfo(A, steps) {
    const { W, Q, R: Rm } = qrFactor(A, steps);
    const P = M.mul(Q, M.transpose(Q));
    return new Info('A = QR factorization', [
      { text: 'Gram–Schmidt on the columns of A gives a mutually orthogonal basis of Col(A):' },
      { tex: `W = ${M.latex(W)}` },
      { text: 'Normalize each column to get Q (orthonormal columns), then R = QᵀA (upper-triangular):' },
      { tex: `Q = ${M.latex(Q)}` },
      { tex: `R = Q^{\\mathsf T}A = ${M.latex(Rm)}` },
      { tex: `P_{\\operatorname{Col}(A)} = QQ^{\\mathsf T} = ${M.latex(P)}` },
      { text: 'For least squares, AᵀA x̂ = Aᵀb reduces to R x̂ = Qᵀb — try qrlsq(A, b).' },
    ], { Q, R: Rm, P });
  }
  function gsInfo(X, steps) {
    const W = M.gramSchmidt(X, steps);
    const U = M.normalizeCols(W);
    const vecs = (Mx) => Array.from({ length: Mx.c }, (_, j) => M.latex(colVec(Mx.col(j)))).join(',\\ ');
    const blocks = [
      { tex: `V = \\operatorname{span}\\left\\{${vecs(X)}\\right\\}` },
      { text: `Mutually orthogonal basis of V (dimension ${W.c}):` },
      { tex: `\\left\\{${vecs(W)}\\right\\}` },
      { text: 'Orthonormal basis of V (divide each by its length):' },
      { tex: `\\left\\{${vecs(U)}\\right\\}` },
    ];
    if (W.c < X.c) blocks.push({ text: `${X.c - W.c} of the vectors were dependent on earlier ones and were dropped.` });
    return new Info('Gram–Schmidt', blocks, { W, Q: U }, W);
  }

  function indepInfo(X) {
    const { R: Rr, pivots } = M.eliminate(X, { reduced: true });
    const nul = X.c - pivots.length;
    const blocks = [
      { tex: `A = ${M.latex(X)},\\qquad \\operatorname{rref}(A) = ${M.latex(Rr)}` },
      { tex: `\\operatorname{nullity}(A) = ${X.c} - ${pivots.length} = ${nul}` },
    ];
    if (!nul) {
      blocks.push({ text: `✓ Linearly independent — every column is a pivot column (nullity 0), so the only solution to c₁v₁ + ⋯ + c${'ₖ'}vₖ = 0 is c = 0.` });
    } else {
      blocks.push({ text: `✗ Linearly dependent — nullity ${nul} > 0. Each non-pivot column is a combination of the pivot columns before it:` });
      const name = (j) => `v_{${j + 1}}`;
      for (let j = 0; j < X.c; j++) {
        if (pivots.includes(j)) continue;
        const terms = pivots.map((pc, i) => ({ c: Rr.a[i][j], pc })).filter(({ c, pc }) => pc < j && !N.isZero(c));
        const rhs = terms.length ? terms.map(({ c, pc }, k) => {
          const neg = N.sign(c) < 0, m = N.abs(c);
          return `${k ? (neg ? ' - ' : ' + ') : neg ? '-' : ''}${N.isOne(m) ? '' : N.toLatex(m)}${name(pc)}`;
        }).join('') : '\\mathbf 0';
        blocks.push({ tex: `${name(j)} = ${rhs}` });
      }
      blocks.push({ text: 'A basis of the span: the pivot columns ' + pivots.map((p) => `v${p + 1}`).join(', ') + '.' });
    }
    return new Info('Linear independence', blocks);
  }

  // Projection matrix onto V = Col(X): P_V = X(XᵀX)⁻¹Xᵀ, after reducing X to a basis (its pivot columns).
  function projMatrix(X) {
    const basis = M.colspace(X);
    if (!basis.length) return { P: M.zeros(X.r, X.r), B: null };
    const B = M.fromCols(basis);
    const Bt = M.transpose(B);
    const G = M.mul(Bt, B), Gi = M.inverse(G);
    return { P: M.mul(B, M.mul(Gi, Bt)), B, G, Gi };
  }
  function projMatrixInfo(X, label) {
    const { P, B, G, Gi } = projMatrix(X);
    if (!B) return new Info('Projection matrix', [{ text: 'V = {0} (X is the zero matrix), so the projection matrix is the zero matrix.' }, { tex: `P_V = ${M.latex(P)}` }], { P }, P);
    const n = X.r, k = B.c;
    const blocks = [];
    if (k < X.c) blocks.push({ text: `The ${X.c} columns are linearly dependent, so I use the ${k} pivot column${k > 1 ? 's' : ''} as a basis of V (P_V only depends on V, not on the basis).` });
    blocks.push({ tex: `X = ${M.latex(B)}\\quad(\\text{columns form a basis of } V,\\ \\dim V = ${k})` });
    if (k === 1) {
      const v = B.col(0);
      blocks.push({ tex: `P_V = \\frac{v v^{\\mathsf T}}{v^{\\mathsf T} v} = \\frac{1}{${N.toLatex(G.a[0][0])}}${M.latex(M.mul(B, M.transpose(B)))}` });
    } else {
      blocks.push({ tex: `X^{\\mathsf T}X = ${M.latex(G)},\\qquad (X^{\\mathsf T}X)^{-1} = ${M.latex(Gi)}` });
    }
    blocks.push({ tex: `P_V = X(X^{\\mathsf T}X)^{-1}X^{\\mathsf T} = ${M.latex(P)}` });
    const sq = M.equals(M.mul(P, P), P), sym = M.isSymmetric(P);
    blocks.push({ text: `Checks: P² = P ${sq ? '✓' : '✗'} · Pᵀ = P ${sym ? '✓' : '✗'} · rank(P) = dim V = ${k} · trace(P) = ${N.toText(M.trace(P))}` });
    const Q = M.sub(M.identity(n), P);
    blocks.push({ tex: `I - P_V = ${M.latex(Q)}\\quad\\text{projects onto } V^{\\perp}${label ? '' : ''}` });
    blocks.push({ text: 'Project a vector with P v (e.g. P = ans, then P v), or use proj(v, X) directly.' });
    return new Info('Projection matrix onto V', blocks, { P, Q }, P);
  }

  // The four fundamental subspaces, in the course's terms (pivot columns, pivot solutions), with projections.
  function fourSubspacesInfo(A) {
    const At = M.transpose(A);
    const vecs = (list) => (list.length ? `\\left\\{${list.map((v) => M.latex(colVec(v))).join(',\\ ')}\\right\\}` : '\\{\\mathbf 0\\}');
    const spaces = [
      { name: 'Col(A)', tex: '\\operatorname{Col}(A)', basis: M.colspace(A), how: 'pivot columns of A', dim: A.r, part: 'Pcol', alt: M.rowspace(At), altHow: 'nonzero rows of rref(Aᵀ)' },
      { name: 'Col(Aᵀ)', tex: '\\operatorname{Col}(A^{\\mathsf T})', basis: M.colspace(At), how: 'pivot columns of Aᵀ (rows of A)', dim: A.c, part: 'Prow', alt: M.rowspace(A), altHow: 'nonzero rows of rref(A)' },
      { name: 'Null(A)', tex: '\\operatorname{Null}(A)', basis: M.nullspace(A), how: 'pivot solutions to Av = 0', dim: A.c, part: 'Pnull' },
      { name: 'Null(Aᵀ)', tex: '\\operatorname{Null}(A^{\\mathsf T})', basis: M.nullspace(At), how: 'pivot solutions to Aᵀv = 0', dim: A.r, part: 'Plnull' },
    ];
    const r = spaces[0].basis.length;
    const blocks = [
      { tex: `\\operatorname{rref}(A) = ${M.latex(M.rref(A))},\\qquad \\operatorname{rref}(A^{\\mathsf T}) = ${M.latex(M.rref(At))}` },
      { text: `rank(A) = ${r}. Dimensions: dim Col(A) = dim Col(Aᵀ) = ${r}, dim Null(A) = ${A.c} − ${r} = ${A.c - r}, dim Null(Aᵀ) = ${A.r} − ${r} = ${A.r - r}.` },
    ];
    const parts = {};
    for (const s of spaces) {
      const P = s.basis.length ? projMatrix(M.fromCols(s.basis)).P : M.zeros(s.dim, s.dim);
      parts[s.part] = P;
      blocks.push({ text: `${s.name} ⊆ ℝ${'⁰¹²³⁴⁵⁶⁷⁸⁹'[s.dim] || '^' + s.dim} — basis from ${s.how}, dimension ${s.basis.length}:` });
      blocks.push({ tex: `${s.tex} = \\operatorname{span}${vecs(s.basis)},\\qquad P_{${s.tex}} = ${M.latex(P)}` });
      if (s.alt && s.alt.length) blocks.push({ tex: `\\text{another basis (${s.altHow}): }${vecs(s.alt)}` });
    }
    blocks.push({ text: 'Orthogonal complements: Col(Aᵀ) ⊥ Null(A) in ℝⁿ and Col(A) ⊥ Null(Aᵀ) in ℝᵐ, so P_Col(Aᵀ) + P_Null(A) = I and P_Col(A) + P_Null(Aᵀ) = I.' });
    return new Info('The four fundamental subspaces', blocks, parts);
  }

  function aboutInfo(A) {
    const z = N.isZero, one = N.isOne;
    const all = (f) => A.a.every((row, i) => row.every((x, j) => f(x, i, j)));
    const yes = (b) => (b ? '✓' : '✗');
    const { pivots } = M.eliminate(A, { reduced: false });
    const rank = pivots.length;
    // REF / RREF checks
    let isRef = true, isRref = true, lastLead = -1, seenZero = false;
    const leads = [];
    A.a.forEach((row) => {
      const lead = row.findIndex((x) => !z(x));
      if (lead < 0) { seenZero = true; return; }
      if (seenZero || lead <= lastLead) isRef = false;
      lastLead = lead;
      leads.push(lead);
    });
    if (!isRef) isRref = false;
    else leads.forEach((c, i) => {
      if (!one(A.a[i][c])) isRref = false;
      A.a.forEach((row, r) => { if (r !== i && !z(row[c])) isRref = false; });
    });
    const sq = A.isSquare;
    const lines = [
      `Size: ${A.r} × ${A.c}${sq ? ' (square)' : ''}${A.c === 1 ? ' — a column vector' : A.r === 1 ? ' — a row vector' : ''}`,
      `${yes(all(z))} zero matrix`,
    ];
    if (sq) {
      lines.push(
        `${yes(all((x, i, j) => (i === j ? one(x) : z(x))))} identity`,
        `${yes(all((x, i, j) => i === j || z(x)))} diagonal`,
        `${yes(all((x, i, j) => i <= j || z(x)))} upper triangular`,
        `${yes(all((x, i, j) => i >= j || z(x)))} lower triangular`,
        `${yes(M.isSymmetric(A))} symmetric (Aᵀ = A)`,
        `${yes(all((x, i, j) => N.eq(x, N.neg(A.a[j][i]))))} skew-symmetric (Aᵀ = −A)`,
      );
    }
    lines.push(
      `${yes(isRef)} in row echelon form`,
      `${yes(isRref)} in reduced row echelon form`,
      `rank(A) = ${rank}, nullity(A) = ${A.c - rank}${rank === 1 ? ' — rank one' : ''}`,
      pivots.length ? `pivot columns: ${pivots.map((p) => p + 1).join(', ')} (first pivot column: ${pivots[0] + 1})` : 'no pivot columns (A is zero)',
    );
    const blocks = [{ text: lines.join('\n') }];
    const diag = A.a.slice(0, Math.min(A.r, A.c)).map((r, i) => r[i]);
    blocks.push({ tex: `\\operatorname{diag}(A) = (${diag.map((x) => N.toLatex(x)).join(',\\ ')})` });
    if (sq) {
      const d = M.det(A);
      const ns = rank === A.r;
      blocks.push({ tex: `\\operatorname{tr}(A) = ${N.toLatex(M.trace(A))},\\qquad \\det(A) = ${N.toLatex(d)}` });
      blocks.push({ text: ns
        ? '✓ Nonsingular. Equivalently: rref(A) = I · rank(A) = n · Null(A) = {0} · Ax = b has exactly one solution for every b · det(A) ≠ 0 · 0 is not an eigenvalue · A⁻¹ exists.'
        : '✗ Singular. Equivalently: rref(A) ≠ I · rank(A) < n · Null(A) contains nonzero vectors · Ax = 0 has infinitely many solutions · det(A) = 0 · 0 is an eigenvalue · no inverse.' });
    }
    return new Info('Adjectives', blocks);
  }

  // Simple SVG drawing of 2D vectors from the origin
  function plotSvg(vs) {
    const pts = vs.map(({ v }) => v.map(N.toF));
    const mx = Math.max(1, ...pts.flat().map(Math.abs));
    const lim = Math.ceil(mx * 1.15);
    const S = 240, pad = 14, sc = (S / 2 - pad) / lim;
    const X = (x) => S / 2 + x * sc, Y = (y) => S / 2 - y * sc;
    const colors = ['var(--accent)', 'var(--bad)', 'var(--good)', '#a855f7', '#d97706', '#0891b2', '#db2777', '#65a30d'];
    const step = lim <= 10 ? 1 : Math.ceil(lim / 10);
    let g = '';
    for (let k = -lim; k <= lim; k += step) {
      g += `<line x1="${X(k)}" y1="${Y(-lim)}" x2="${X(k)}" y2="${Y(lim)}" stroke="var(--line)" stroke-width="${k === 0 ? 1.5 : 0.6}"/>`;
      g += `<line x1="${X(-lim)}" y1="${Y(k)}" x2="${X(lim)}" y2="${Y(k)}" stroke="var(--line)" stroke-width="${k === 0 ? 1.5 : 0.6}"/>`;
    }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let arrows = '', defs = '';
    // draw longer vectors first so parallel shorter ones stay visible on top
    const order = pts.map((p, i) => i).sort((a, b) => Math.hypot(...pts[b]) - Math.hypot(...pts[a]));
    order.forEach((i) => {
      const [x, y] = pts[i];
      const c = colors[i % colors.length];
      defs += `<marker id="ah${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`;
      arrows += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(x)}" y2="${Y(y)}" stroke="${c}" stroke-width="2.4" marker-end="url(#ah${i})"/>`;
      const off = 10 / Math.max(1e-9, Math.hypot(x, y));
      arrows += `<text x="${X(x) + x * off * 1.2}" y="${Y(y) - y * off * 1.2 + 4}" fill="${c}" font-size="12" font-family="var(--mono)" text-anchor="middle">${esc(vs[i].label)}</text>`;
    });
    return `<svg class="vplot" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Vector plot"><defs>${defs}</defs>${g}<text x="${S - 4}" y="${Y(0) - 4}" font-size="10" fill="var(--muted)" text-anchor="end">${lim}</text>${arrows}</svg>`;
  }

  function solutionInfo(res, A, B, lsq = false) {
    const title = lsq ? 'Least-squares solution' : 'Solution of Ax = b';
    if (res.kind === 'none') {
      return new Info(title, [{ text: 'No solution — the system is inconsistent (b is not in Col(A)).' }, { text: 'Tip: lsq(A, b) finds the best approximate solution.' }]);
    }
    if (res.kind === 'unique') {
      return new Info(title, [{ text: 'Unique solution:' }, { tex: `${lsq ? '\\hat x' : 'x'} = ${M.latex(res.x)}` }], { x: res.x }, res.x);
    }
    const n = A.c;
    const vars = res.free.map((f) => `x_{${f + 1}}`);
    const params = res.free.map((_, k) => (res.free.length <= 3 ? ['s', 't', 'r'][k] : `t_{${k + 1}}`));
    let tex = `x = ${M.latex(res.xp)}`;
    res.basis.forEach((v, k) => { tex += ` + ${params[k]}${M.latex(M.fromCols([v]))}`; });
    const blocks = [
      { text: `Infinitely many solutions — ${res.free.length} free variable${res.free.length > 1 ? 's' : ''} (${vars.map((v) => v.replace(/[{}_]/g, '')).join(', ')}).` },
      { tex },
      { tex: `${params.join(', ')} \\in \\mathbb{R}` },
    ];
    const parts = { xp: res.xp };
    if (res.basis.length) parts.N = M.fromCols(res.basis);
    return new Info(title, blocks, parts, B.c === 1 ? res.xp : null);
  }

  function eigenInfo(A) {
    const n = A.r;
    const e = M.eigen(A);
    const blocks = [{ tex: `\\chi_A(t) = \\det(tI - A) = ${M.polyLatex(e.charpoly, 't')}` }];
    const allRational = e.other.length === 0;
    if (allRational) {
      const factors = e.exact.map(({ v, mult }) => {
        const s = N.isZero(v) ? 't' : `(t ${N.sign(v) < 0 ? '+' : '-'} ${N.toLatex(N.abs(v))})`;
        return mult > 1 ? `${s}^{${mult}}` : s;
      });
      if (e.exact.length) blocks.push({ tex: `\\phantom{\\chi_A(t)} = ${factors.join('')}` });
    }
    let geoTotal = 0;
    const parts = {};
    const Pcols = [], Dvals = [];
    for (const { v, mult, basis } of e.exact) {
      geoTotal += basis.length;
      const vecs = basis.map((b) => M.latex(M.fromCols([b]))).join(',\\ ');
      blocks.push({
        tex: `\\lambda = ${N.toLatex(v)}:\\quad \\operatorname{am}_A(${N.toLatex(v)}) = ${mult},\\ \\operatorname{gm}_A(${N.toLatex(v)}) = ${basis.length},\\quad \\mathcal{E}_A(${N.toLatex(v)}) = \\operatorname{Null}(${N.toLatex(v)}I - A) = \\operatorname{span}\\left\\{${vecs}\\right\\}`,
      });
      basis.forEach((b) => { Pcols.push(b); Dvals.push(v); });
    }
    let complex = false;
    if (e.quadratic) {
      const q = e.quadratic;
      blocks.push({ tex: `\\text{Remaining quadratic factor gives } \\lambda = ${q.tex}` });
      if (q.complex) complex = true;
    }
    for (const z of e.other) {
      if (z.im !== 0) { complex = true; if (!e.quadratic) blocks.push({ tex: `\\lambda \\approx ${N.fmtFloat(z.re)} ${z.im < 0 ? '-' : '+'} ${N.fmtFloat(Math.abs(z.im))}i` }); continue; }
      geoTotal += z.basis ? z.basis.length : 0;
      const label = z.tex || `\\approx ${N.fmtFloat(z.re)}`;
      const vecs = (z.basis || []).map((b) => M.latex(M.fromCols([b]))).join(',\\ ');
      blocks.push({ tex: `\\lambda = ${label}${z.tex ? `\\ (\\approx ${N.fmtFloat(z.re)})` : ''}:\\quad E \\approx \\operatorname{span}\\left\\{${vecs}\\right\\}` });
      (z.basis || []).forEach((b) => { Pcols.push(b); Dvals.push(z.re); });
    }
    if (complex) blocks.push({ text: 'Complex eigenvalues ⇒ not diagonalizable over ℝ (no real eigenvector for those).' });
    else if (geoTotal === n) {
      const P = M.fromCols(Pcols), D = M.diag(Dvals);
      blocks.push({ text: 'Diagonalizable: the eigenvectors form a basis, so A = PDP⁻¹ with' });
      blocks.push({ tex: `P = ${M.latex(P)},\\quad D = ${M.latex(D)}` });
      parts.P = P; parts.D = D;
    } else {
      blocks.push({ text: `Not diagonalizable: the eigenspaces only give ${geoTotal} independent eigenvector${geoTotal === 1 ? '' : 's'} (need ${n}).` });
    }
    if (M.isSymmetric(A)) blocks.push({ text: 'A is symmetric, so its eigenvalues are real and eigenvectors for distinct eigenvalues are orthogonal (spectral theorem).' });
    const tr = M.trace(A), dt = M.det(A);
    blocks.push({ tex: `\\textstyle\\sum \\lambda_i = \\operatorname{tr}A = ${N.toLatex(tr)},\\quad \\prod \\lambda_i = \\det A = ${N.toLatex(dt)}` });
    return new Info('Eigenvalues & eigenvectors', blocks, parts);
  }

  // ---------- Pretty text of an AST (used for labels) ----------
  function exprText(n) {
    switch (n.type) {
      case 'num': return n.v;
      case 'var': return n.name;
      case 'group': return `(${exprText(n.a)})`;
      case 'neg': return `-${exprText(n.a)}`;
      case 'T': return `${exprText(n.a)}ᵀ`;
      case 'pow': return `${exprText(n.a)}^${exprText(n.e)}`;
      case 'ip': return `⟨${exprText(n.a)}, ${exprText(n.b)}⟩`;
      case 'bin': return n.op === '*' ? (n.implicit ? `${exprText(n.l)}${exprText(n.r)}` : `${exprText(n.l)}·${exprText(n.r)}`) : `${exprText(n.l)} ${n.op} ${exprText(n.r)}`;
      case 'call': return `${n.name}(${n.args.map(exprText).join(', ')})`;
      case 'index': return `${n.name}(${n.args.map(exprText).join(', ')})`;
      case 'matrix': return '[…]';
    }
    return '?';
  }
  LA.exprText = exprText;

  // ---------- Top-level ----------
  const RESERVED = new Set(['I', 'ans', 'pi']);
  function validName(name) {
    if (!/^[A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*$/.test(name)) return 'Names must start with a letter (letters, digits and _ allowed).';
    if (RESERVED.has(name) || /^I\d+$/.test(name)) return `"${name}" is reserved.`;
    if (isFunc(name)) return `"${name}" is a function name.`;
    return null;
  }

  function makeCtx(ws, settings, wantSteps = true) {
    return {
      get: (n) => ws[n],
      has: (n) => Object.prototype.hasOwnProperty.call(ws, n),
      settings,
      steps: [],
      notes: [],
      wantSteps,
    };
  }

  // Run a statement. ws: {name: value}. Returns {value, assign, steps, notes}.
  function run(src, ws, settings, { wantSteps = true } = {}) {
    const ctx = makeCtx(ws, settings, wantSteps);
    const ast = parse(src, { known: ctx.has });
    let target = null, expr = ast;
    if (ast.type === 'assign') {
      const err = validName(ast.name);
      if (err) throw new MathError(err);
      target = ast.name;
      expr = ast.expr;
    }
    let value = evaluate(expr, ctx);
    if (value instanceof Eye) value = materialize(value, ctx);
    if (value instanceof Info && target) {
      if (!value.value) throw new MathError(`That result can't be stored in a single variable. Use the "save" buttons on the card for its parts.`);
      value = value.value;
      if (value instanceof Info) value = null;
    }
    if (typeof value === 'number' && !isFinite(value)) throw new MathError('Result is not finite');
    return { value, assign: target, steps: ctx.steps, notes: [...new Set(ctx.notes)], ast };
  }

  // Evaluate a single grid cell (a scalar expression).
  function evalScalar(src, ws, settings) {
    const s = src.trim();
    if (s === '') return R.ZERO;
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(\/[+-]?(\d+\.?\d*|\.\d+))?$/i.test(s)) return N.parseLiteral(s);
    const ctx = makeCtx(ws || {}, settings || { defaultN: 3 }, false);
    const v = evaluate(parse(s, { known: ctx.has }), ctx);
    return asScalar(v, 'a number');
  }

  // Parse a block of text (pasted from a spreadsheet, MATLAB, NumPy, LaTeX...) into a 2D array of strings.
  function parseBlock(text) {
    let t = text.trim();
    if (!t) return null;
    // LaTeX bmatrix / pmatrix
    const lx = /\\begin\{[bpvBV]?matrix\}([\s\S]*)\\end\{[bpvBV]?matrix\}/.exec(t);
    if (lx) return lx[1].split('\\\\').map((r) => r.split('&').map((c) => c.trim())).filter((r) => r.some((c) => c));
    // Python nested lists / np.array
    t = t.replace(/^\s*(np\.)?(array|matrix|Matrix)\s*\(/, '').replace(/\)\s*$/, '');
    if (/^\[\s*\[/.test(t)) {
      const rows = t.slice(1, -1).match(/\[[^\[\]]*\]/g);
      if (rows) return rows.map((r) => r.slice(1, -1).split(',').map((c) => c.trim()).filter((c) => c !== ''));
    }
    t = t.replace(/^\[|\]$/g, '').replace(/^\{|\}$/g, '');
    const rowSep = /\s*(?:;|\r?\n)\s*/;
    const rows = t.split(rowSep).filter((r) => r.trim() !== '');
    return rows.map((r) => {
      if (r.includes('\t')) return r.split('\t').map((c) => c.trim());
      if (r.includes(',')) return r.split(',').map((c) => c.trim()).filter((c) => c !== '');
      return r.trim().split(/\s+/);
    });
  }

  LA.expr = {
    tokenize, parse, evaluate, run, evalScalar, parseBlock, validName, FUNCS, isFunc, makeCtx,
    innerProduct, materialize, asMatrix, GREEK, splitIdent,
  };
})();
