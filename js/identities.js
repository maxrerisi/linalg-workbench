// Symbolic identity explainer.
// Both sides of an equation are rewritten, one named rule at a time, into a canonical
// form. If the canonical forms agree we print the chain LHS = … = RHS with each rule.
// Independently, both sides are evaluated on random matrices to confirm or refute.
(function () {
  const LA = window.LA;
  const N = LA.num;
  const Mx = LA.mat;
  const { R } = N;
  const E = LA.expr;

  // ---------- rules (name + formula shown to the student) ----------
  const T_ = '^{\\mathsf T}';
  const RULES = {
    ipDef: { name: 'Definition of the dot product', tex: `\\langle x, y\\rangle = x${T_}y` },
    frob: { name: 'Frobenius inner product', tex: `\\langle X, Y\\rangle = \\operatorname{tr}(X${T_}Y)` },
    gram: { name: 'Gram matrix', tex: `\\operatorname{gram}(A) = A${T_}A` },
    normSq: { name: 'Norm from the inner product', tex: `\\lVert x\\rVert^2 = \\langle x, x\\rangle` },
    tt: { name: 'Double transpose', tex: `(X${T_})${T_} = X` },
    tProd: { name: 'Transpose of a product (reverses order)', tex: `(XY)${T_} = Y${T_}X${T_}` },
    tScal: { name: 'Scalars pass through transpose', tex: `(cX)${T_} = cX${T_}` },
    tSum: { name: 'Transpose of a sum', tex: `(X+Y)${T_} = X${T_}+Y${T_}` },
    tInv: { name: 'Transpose and inverse commute', tex: `(X^{-1})${T_} = (X${T_})^{-1}` },
    tPow: { name: 'Transpose of a power', tex: `(X^k)${T_} = (X${T_})^k` },
    tI: { name: 'Identity is symmetric', tex: `I${T_} = I` },
    tScalar: { name: 'A scalar is its own transpose', tex: `c${T_} = c` },
    invInv: { name: 'Double inverse', tex: '(X^{-1})^{-1} = X' },
    invProd: { name: 'Inverse of a product (reverses order)', tex: '(XY)^{-1} = Y^{-1}X^{-1}' },
    invScal: { name: 'Inverse of a scalar multiple', tex: '(cX)^{-1} = c^{-1}X^{-1}' },
    invI: { name: 'Inverse of the identity', tex: 'I^{-1} = I' },
    invPow: { name: 'Inverse of a power', tex: '(X^k)^{-1} = X^{-k}' },
    powPow: { name: 'Power of a power', tex: '(X^a)^b = X^{ab}' },
    powExpand: { name: 'Expand the power', tex: 'X^k = X\\,X\\cdots X' },
    pow01: { name: 'Zeroth/first power', tex: 'X^0 = I,\\ X^1 = X' },
    powI: { name: 'Powers of the identity', tex: 'I^k = I' },
    detI: { name: 'Determinant of the identity', tex: '\\det I = 1' },
    detT: { name: 'Determinant of a transpose', tex: `\\det(X${T_}) = \\det X` },
    detInv: { name: 'Determinant of an inverse', tex: '\\det(X^{-1}) = \\frac{1}{\\det X}' },
    detPow: { name: 'Determinant of a power', tex: '\\det(X^k) = (\\det X)^k' },
    detProd: { name: 'Determinant is multiplicative', tex: '\\det(XY) = \\det X\\,\\det Y' },
    detScal: { name: 'Determinant of a scalar multiple', tex: '\\det(cX) = c^{n}\\det X \\ (X\\ n\\times n)' },
    trLin: { name: 'Trace is additive', tex: '\\operatorname{tr}(X+Y) = \\operatorname{tr}X + \\operatorname{tr}Y' },
    trScal: { name: 'Scalars pull out of the trace', tex: '\\operatorname{tr}(cX) = c\\operatorname{tr}X' },
    trT: { name: 'Trace of a transpose', tex: `\\operatorname{tr}(X${T_}) = \\operatorname{tr}X` },
    trCyc: { name: 'Cyclic property of trace', tex: '\\operatorname{tr}(XY) = \\operatorname{tr}(YX)' },
    distrib: { name: 'Distributive law', tex: 'X(Y+Z) = XY + XZ' },
    scalComm: { name: 'Scalars commute with everything', tex: 'X(cY) = c\\,XY' },
    scalCancel: { name: 'Combine scalar factors', tex: 'c^a c^b = c^{a+b}' },
    powMerge: { name: 'Combine powers', tex: 'X^aX^b = X^{a+b}' },
    invCancel: { name: 'A matrix times its inverse', tex: 'XX^{-1} = X^{-1}X = I' },
    idMul: { name: 'Multiplying by the identity', tex: 'XI = IX = X' },
    scalarT: { name: 'A 1×1 product is a scalar, so it equals its transpose', tex: `x${T_}My = (x${T_}My)${T_} = y${T_}M${T_}x` },
    like: { name: 'Combine like terms', tex: 'aX + bX = (a+b)X' },
    sortTerms: { name: 'Addition is commutative', tex: 'X + Y = Y + X' },
    compute: { name: 'Compute with explicit numbers', tex: '' },
    arith: { name: 'Arithmetic', tex: '' },
  };

  // ---------- constructors ----------
  const num = (v) => ({ t: 'num', v });
  const ONE = () => num(R.ONE);
  const T = (a) => ({ t: 'T', a });
  const inv = (a) => ({ t: 'inv', a });
  const powN = (a, n) => (n === 1 ? a : { t: 'pow', a, n });
  const fn = (name, args) => ({ t: 'fn', name, args });
  const isNum = (x) => x.t === 'num';

  function mul(fs) {
    const flat = [];
    for (const f of fs) if (f.t === 'mul') flat.push(...f.f); else flat.push(f);
    let c = R.ONE;
    const rest = [];
    for (const f of flat) {
      if (isNum(f)) c = N.mul(c, f.v);
      else rest.push(f);
    }
    if (N.isZero(c)) return num(R.ZERO);
    if (!N.isOne(c)) rest.unshift(num(c));
    if (rest.length === 0) return num(c);
    if (rest.length === 1) return rest[0];
    return { t: 'mul', f: rest };
  }
  function add(ts) {
    const flat = [];
    for (const t of ts) if (t.t === 'add') flat.push(...t.ts); else flat.push(t);
    const rest = flat.filter((t) => !(isNum(t) && N.isZero(t.v)));
    if (rest.length === 0) return num(R.ZERO);
    if (rest.length === 1) return rest[0];
    return { t: 'add', ts: rest };
  }

  // ---------- keys, shapes ----------
  function key(n) {
    switch (n.t) {
      case 'num': return '#' + N.toText(n.v, 'frac');
      case 'var': return n.name;
      case 'I': return 'I';
      case 'lit': return 'L[' + n.m.a.map((r) => r.map((x) => N.toText(x, 'frac')).join(',')).join(';') + ']';
      case 'T': return key(n.a) + "'";
      case 'inv': return key(n.a) + '~';
      case 'pow': return key(n.a) + '^' + n.n;
      case 'mul': return '(' + n.f.map(key).join('*') + ')';
      case 'add': return '(' + n.ts.map(key).join('+') + ')';
      case 'ip': return '<' + key(n.a) + ',' + key(n.b) + '>';
      case 'fn': return n.name + '(' + n.args.map(key).join(',') + ')';
    }
    return '?';
  }

  // Ordering key for terms: powers expanded so A^2 < AB < BA < B^2
  function sortKey(n) {
    if (n.t === 'pow' && n.n > 0) return Array(n.n).fill(sortKey(n.a)).join('*');
    if (n.t === 'mul') return n.f.map(sortKey).join('*');
    return key(n);
  }

  const SCALAR_FNS = new Set(['det', 'tr', 'norm', 'rank', 'abs', 'dot']);

  function makeShape(dims) {
    function isScalar(n) {
      switch (n.t) {
        case 'num': case 'ip': return true;
        case 'var': { const d = dims(n.name); return !!(d && d.scalar); }
        case 'fn': return SCALAR_FNS.has(n.name);
        case 'T': case 'inv': case 'pow': return isScalar(n.a);
        case 'mul': return n.f.every(isScalar);
        case 'add': return isScalar(n.ts[0]);
      }
      return false;
    }
    function shape(n) {
      switch (n.t) {
        case 'num': case 'ip': return [1, 1];
        case 'var': { const d = dims(n.name); return d ? [d.r, d.c] : null; }
        case 'I': return null;
        case 'lit': return [n.m.r, n.m.c];
        case 'T': { const s = shape(n.a); return s && [s[1], s[0]]; }
        case 'inv': case 'pow': return shape(n.a);
        case 'fn': {
          if (SCALAR_FNS.has(n.name)) return [1, 1];
          if (n.name === 'gram') { const s = shape(n.args[0]); return s && [s[1], s[1]]; }
          return null;
        }
        case 'mul': {
          const ch = n.f.filter((f) => !isScalar(f));
          if (!ch.length) return [1, 1];
          const a = shape(ch[0]), b = shape(ch[ch.length - 1]);
          if (!a || !b) return null;
          return [a[0], b[1]];
        }
        case 'add': { for (const t of n.ts) { const s = shape(t); if (s) return s; } return null; }
      }
      return null;
    }
    return { isScalar, shape };
  }

  // ---------- AST → symbolic form ----------
  class Unsupported extends Error {}
  function toSym(n, ctx) {
    switch (n.type) {
      case 'num': return num(N.parseLiteral(n.v));
      case 'group': return toSym(n.a, ctx);
      case 'var': return n.name === 'I' ? { t: 'I' } : { t: 'var', name: n.name };
      case 'neg': return mul([num(N.neg(R.ONE)), toSym(n.a, ctx)]);
      case 'T': return T(toSym(n.a, ctx));
      case 'pow': {
        const e = E.evaluate(n.e, E.makeCtx({}, { defaultN: 3 }, false));
        if (!N.isNum(e) || !N.isInt(e)) throw new Unsupported('Only integer exponents are supported symbolically.');
        const k = Number(N.isR(e) ? e.n : e);
        const a = toSym(n.a, ctx);
        return k === -1 ? inv(a) : { t: 'pow', a, n: k };
      }
      case 'ip': return { t: 'ip', a: toSym(n.a, ctx), b: toSym(n.b, ctx) };
      case 'bin': {
        const l = toSym(n.l, ctx), r = toSym(n.r, ctx);
        if (n.op === '+') return add([l, r]);
        if (n.op === '-') return add([l, mul([num(N.neg(R.ONE)), r])]);
        if (n.op === '*') return mul([l, r]);
        if (n.op === '/') return mul([l, isNum(r) ? num(N.inv(r.v)) : { t: 'pow', a: r, n: -1 }]);
        break;
      }
      case 'call': {
        const args = n.args.map((a) => toSym(a, ctx));
        switch (n.name) {
          case 'inv': return inv(args[0]);
          case 'transpose': return T(args[0]);
          case 'trace': return fn('tr', args);
          case 'dot': case 'ip': return { t: 'ip', a: args[0], b: args[1] };
          case 'sqrt': throw new Unsupported('sqrt is not supported in symbolic mode.');
          default: return fn(n.name, args);
        }
      }
      case 'matrix': return { t: 'lit', m: E.asMatrix(E.evaluate(n, E.makeCtx({}, { defaultN: 3 }, false))) };
      case 'index': throw new Unsupported('Indexing is not supported in symbolic mode.');
    }
    throw new Unsupported('Unsupported expression');
  }

  // ---------- LaTeX ----------
  function varTex(name) {
    if (E.GREEK.includes(name)) return '\\' + name;
    const m = /^([A-Za-z]+)_?(\d+)$/.exec(name);
    if (m) return `${m[1]}_{${m[2]}}`;
    const u = /^(.+?)_(.+)$/.exec(name);
    if (u) return `${u[1]}_{${u[2]}}`;
    return name.length > 1 ? `\\mathit{${name}}` : name;
  }
  const atomic = (n) => ['var', 'I', 'lit', 'fn', 'ip'].includes(n.t) || (n.t === 'num' && N.sign(n.v) >= 0 && N.isInt(n.v));
  const wrap = (n) => (atomic(n) ? tex(n) : `\\left(${tex(n)}\\right)`);
  function tex(n) {
    switch (n.t) {
      case 'num': return N.toLatex(n.v, 'frac');
      case 'var': return varTex(n.name);
      case 'I': return 'I';
      case 'lit': return Mx.latex(n.m);
      case 'T': return wrap(n.a) + T_;
      case 'inv': return wrap(n.a) + '^{-1}';
      case 'pow': return wrap(n.a) + `^{${n.n}}`;
      case 'ip': return `\\langle ${tex(n.a)},\\, ${tex(n.b)} \\rangle`;
      case 'fn': {
        const a = n.args.map(tex).join(',\\, ');
        if (n.name === 'det') return `\\det(${a})`;
        if (n.name === 'norm') return `\\lVert ${a} \\rVert`;
        if (n.name === 'abs') return `\\lvert ${a} \\rvert`;
        return `\\operatorname{${n.name}}(${a})`;
      }
      case 'mul': {
        let fs = n.f.slice();
        let pre = '';
        if (isNum(fs[0])) {
          const c = fs.shift().v;
          if (N.isOne(N.neg(c))) pre = '-';
          else pre = N.sign(c) < 0 ? `-${N.toLatex(N.abs(c), 'frac')}` : N.toLatex(c, 'frac');
        }
        // negative-power scalars go in a denominator
        const den = fs.filter((f) => f.t === 'pow' && f.n < 0 && !['mul', 'add'].includes(f.a.t) && isScalarGuess(f.a));
        if (den.length) {
          fs = fs.filter((f) => !den.includes(f));
          const d = den.map((f) => (f.n === -1 ? wrapIfSum(f.a) : `${wrap(f.a)}^{${-f.n}}`)).join('\\,');
          const numer = fs.map((f) => (f.t === 'add' ? `\\left(${tex(f)}\\right)` : tex(f))).join('\\,');
          const sign = pre.startsWith('-') ? '-' : '';
          const coef = pre.replace(/^-/, '');
          return `${sign}\\frac{${coef}${coef && numer ? '\\,' : ''}${numer || (coef ? '' : '1')}}{${d}}`;
        }
        const body = fs.map((f) => (f.t === 'add' || (f.t === 'num' && N.sign(f.v) < 0) ? `\\left(${tex(f)}\\right)` : tex(f))).join(' ');
        return pre + (pre && pre !== '-' ? '\\,' : '') + body;
      }
      case 'add': {
        let s = '';
        n.ts.forEach((t, i) => {
          let neg = false, body;
          if (t.t === 'num' && N.sign(t.v) < 0) { neg = true; body = N.toLatex(N.abs(t.v), 'frac'); }
          else if (t.t === 'mul' && isNum(t.f[0]) && N.sign(t.f[0].v) < 0) { neg = true; body = tex(mul([num(N.abs(t.f[0].v)), ...t.f.slice(1)])); }
          else body = tex(t);
          if (i === 0) s = (neg ? '-' : '') + body;
          else s += (neg ? ' - ' : ' + ') + body;
        });
        return s;
      }
    }
    return '?';
  }
  const wrapIfSum = (n) => (n.t === 'add' ? `\\left(${tex(n)}\\right)` : tex(n));
  let isScalarGuess = () => false; // set per explanation (depends on dims)

  // ---------- rewrite engine ----------
  function makeRewriter(S) {
    const { isScalar, shape } = S;
    const split = (fs) => ({ sc: fs.filter(isScalar), ch: fs.filter((f) => !isScalar(f)) });
    const scalarInv = (x) => (isNum(x) ? num(N.inv(x.v)) : x.t === 'pow' ? powN(x.a, -x.n) : powN(x, -1));

    function children(n) {
      switch (n.t) {
        case 'T': case 'inv': case 'pow': return [n.a];
        case 'ip': return [n.a, n.b];
        case 'fn': return n.args;
        case 'mul': return n.f;
        case 'add': return n.ts;
      }
      return [];
    }
    function rebuild(n, k, c) {
      switch (n.t) {
        case 'T': return T(c);
        case 'inv': return inv(c);
        case 'pow': return { t: 'pow', a: c, n: n.n };
        case 'ip': return k === 0 ? { t: 'ip', a: c, b: n.b } : { t: 'ip', a: n.a, b: c };
        case 'fn': return fn(n.name, n.args.map((a, i) => (i === k ? c : a)));
        case 'mul': return mul(n.f.map((a, i) => (i === k ? c : a)));
        case 'add': return add(n.ts.map((a, i) => (i === k ? c : a)));
      }
      return n;
    }
    function step(n) {
      const kids = children(n);
      for (let k = 0; k < kids.length; k++) {
        const r = step(kids[k]);
        if (r) return { n: rebuild(n, k, r.n), rule: r.rule };
      }
      return here(n);
    }
    const ok = (n, rule) => ({ n, rule });

    // Transpose of a single chain factor, simplified one level.
    function tpush(x) {
      if (isScalar(x)) return x;
      if (x.t === 'T') return x.a;
      if (x.t === 'inv') return inv(tpush(x.a));
      if (x.t === 'pow') return powN(tpush(x.a), x.n);
      if (x.t === 'I') return x;
      if (x.t === 'lit') return { t: 'lit', m: Mx.transpose(x.m) };
      return T(x);
    }
    const baseExp = (x) => (x.t === 'inv' ? [x.a, -1] : x.t === 'pow' ? [x.a, x.n] : [x, 1]);
    const mkPow = (b, e) => (e === 0 ? { t: 'I' } : e === 1 ? b : e === -1 ? inv(b) : { t: 'pow', a: b, n: e });

    function here(n) {
      switch (n.t) {
        case 'ip': {
          if (isScalar(n.a) && isScalar(n.b)) return ok(mul([n.a, n.b]), RULES.arith);
          const s = shape(n.a);
          if (s && s[1] > 1 && s[0] > 1) return ok(fn('tr', [mul([T(n.a), n.b])]), RULES.frob);
          return ok(mul([T(n.a), n.b]), RULES.ipDef);
        }
        case 'fn': return fnRule(n);
        case 'T': {
          const x = n.a;
          if (x.t === 'T') return ok(x.a, RULES.tt);
          if (isScalar(x)) return ok(x, RULES.tScalar);
          if (x.t === 'mul') {
            const { sc, ch } = split(x.f);
            return ok(mul([...sc, ...ch.slice().reverse().map(T)]), ch.length >= 2 ? RULES.tProd : RULES.tScal);
          }
          if (x.t === 'add') return ok(add(x.ts.map(T)), RULES.tSum);
          if (x.t === 'inv') return ok(inv(T(x.a)), RULES.tInv);
          if (x.t === 'pow') return ok(powN(T(x.a), x.n), RULES.tPow);
          if (x.t === 'I') return ok(x, RULES.tI);
          if (x.t === 'lit') return ok({ t: 'lit', m: Mx.transpose(x.m) }, RULES.compute);
          return null;
        }
        case 'inv': {
          const x = n.a;
          if (x.t === 'inv') return ok(x.a, RULES.invInv);
          if (x.t === 'I') return ok(x, RULES.invI);
          if (isNum(x)) return ok(num(N.inv(x.v)), RULES.arith);
          if (isScalar(x)) return ok(powN(x, -1), RULES.arith);
          if (x.t === 'pow') return ok(powN(x.a, -x.n), RULES.invPow);
          if (x.t === 'mul') {
            const { sc, ch } = split(x.f);
            return ok(mul([...sc.map(scalarInv), ...ch.slice().reverse().map(inv)]), ch.length >= 2 ? RULES.invProd : RULES.invScal);
          }
          if (x.t === 'lit') { try { return ok({ t: 'lit', m: Mx.inverse(x.m) }, RULES.compute); } catch (e) { return null; } }
          return null;
        }
        case 'pow': {
          const x = n.a, k = n.n;
          if (k === 1) return ok(x, RULES.pow01);
          if (k === 0) return ok(isScalar(x) ? ONE() : { t: 'I' }, RULES.pow01);
          if (x.t === 'pow') return ok(powN(x.a, x.n * k), RULES.powPow);
          if (isNum(x)) return ok(num(N.powInt(x.v, k)), RULES.arith);
          if (x.t === 'I') return ok(x, RULES.powI);
          if (x.t === 'fn' && x.name === 'norm' && k % 2 === 0) {
            const ip = { t: 'ip', a: x.args[0], b: x.args[0] };
            return ok(powN(ip, k / 2), RULES.normSq);
          }
          if (x.t === 'inv') return ok(powN(x.a, -k), RULES.invPow);
          if ((x.t === 'mul' || x.t === 'add') && k >= 2 && k <= 4) return ok(mul(Array(k).fill(x)), RULES.powExpand);
          if ((x.t === 'mul' || x.t === 'add') && k < 0) return ok(inv(powN(x, -k)), RULES.invPow);
          if (x.t === 'lit' && x.m.isSquare) { try { return ok({ t: 'lit', m: Mx.pow(x.m, k) }, RULES.compute); } catch (e) { return null; } }
          return null;
        }
        case 'mul': return mulRule(n);
        case 'add': return addRule(n);
      }
      return null;
    }

    function fnRule(n) {
      const x = n.args[0];
      if (n.name === 'gram') return ok(mul([T(x), x]), RULES.gram);
      if (n.name === 'det') {
        if (x.t === 'I') return ok(ONE(), RULES.detI);
        if (x.t === 'T') return ok(fn('det', [x.a]), RULES.detT);
        if (x.t === 'inv') return ok(powN(fn('det', [x.a]), -1), RULES.detInv);
        if (x.t === 'pow') return ok(powN(fn('det', [x.a]), x.n), RULES.detPow);
        if (x.t === 'lit' && x.m.isSquare) return ok(num(Mx.det(x.m)), RULES.compute);
        if (x.t === 'mul') {
          const { sc, ch } = split(x.f);
          if (sc.length && ch.length) {
            const s = shape(mul(ch));
            if (s) {
              const c = mul(sc);
              const cn = isNum(c) ? num(N.powInt(c.v, s[0])) : powN(c, s[0]);
              return ok(mul([cn, fn('det', [mul(ch)])]), RULES.detScal);
            }
          }
          if (!sc.length && ch.length >= 2) {
            const allSq = ch.every((f) => { const s = shape(f); return !s || s[0] === s[1]; });
            if (allSq) return ok(mul(ch.map((f) => fn('det', [f]))), RULES.detProd);
          }
        }
        return null;
      }
      if (n.name === 'tr') {
        if (x.t === 'add') return ok(add(x.ts.map((t) => fn('tr', [t]))), RULES.trLin);
        if (x.t === 'T') return ok(fn('tr', [x.a]), RULES.trT);
        if (x.t === 'lit' && x.m.isSquare) return ok(num(Mx.trace(x.m)), RULES.compute);
        if (x.t === 'mul') {
          const { sc, ch } = split(x.f);
          if (sc.length && ch.length) return ok(mul([...sc, fn('tr', [mul(ch)])]), RULES.trScal);
          if (ch.length >= 2) {
            let best = ch, bk = key(mul(ch));
            for (let r = 1; r < ch.length; r++) {
              const rot = [...ch.slice(r), ...ch.slice(0, r)];
              const k = key(mul(rot));
              if (k < bk) { best = rot; bk = k; }
            }
            if (best !== ch) return ok(fn('tr', [mul(best)]), RULES.trCyc);
          }
        }
        return null;
      }
      return null;
    }

    function mulRule(n) {
      const fs = n.f;
      // distribute over sums
      const ai = fs.findIndex((f) => f.t === 'add');
      if (ai >= 0) {
        const before = fs.slice(0, ai), after = fs.slice(ai + 1);
        return ok(add(fs[ai].ts.map((t) => mul([...before, t, ...after]))), RULES.distrib);
      }
      const coef = isNum(fs[0]) ? [fs[0]] : [];
      const rest = coef.length ? fs.slice(1) : fs;
      const { sc, ch } = split(rest);
      // gather scalar factors by base, summing exponents
      const groups = new Map();
      for (const s of sc) {
        const [b, e] = s.t === 'pow' ? [s.a, s.n] : [s, 1];
        const k = key(b);
        if (!groups.has(k)) groups.set(k, { b, e: 0 });
        groups.get(k).e += e;
      }
      const scNew = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).filter(([, g]) => g.e !== 0).map(([, g]) => powN(g.b, g.e));
      const reordered = mul([...coef, ...scNew, ...ch]);
      if (key(reordered) !== key(n)) {
        const cancelled = scNew.length !== sc.length;
        return ok(reordered, cancelled ? RULES.scalCancel : RULES.scalComm);
      }
      // merge adjacent powers of the same matrix
      for (let i = 0; i + 1 < ch.length; i++) {
        const [b1, e1] = baseExp(ch[i]), [b2, e2] = baseExp(ch[i + 1]);
        if (b1.t !== 'I' && key(b1) === key(b2)) {
          const e = e1 + e2;
          const merged = mkPow(b1, e);
          const nch = [...ch.slice(0, i), ...(e === 0 ? [] : [merged]), ...ch.slice(i + 2)];
          const res = nch.length ? mul([...coef, ...scNew, ...nch]) : mul([...coef, ...scNew, { t: 'I' }]);
          return ok(res, e === 0 ? RULES.invCancel : RULES.powMerge);
        }
        if (ch[i].t === 'lit' && ch[i + 1].t === 'lit') {
          try {
            const p = { t: 'lit', m: Mx.mul(ch[i].m, ch[i + 1].m) };
            return ok(mul([...coef, ...scNew, ...ch.slice(0, i), p, ...ch.slice(i + 2)]), RULES.compute);
          } catch (e) { /* dims mismatch: leave */ }
        }
      }
      // drop identities
      if (ch.some((f) => f.t === 'I') && (ch.length >= 2)) {
        return ok(mul([...coef, ...scNew, ...ch.filter((f) => f.t !== 'I')]), RULES.idMul);
      }
      // a 1×1 chain equals its transpose: pick the canonical orientation
      if (ch.length >= 2) {
        const s = shape(mul(ch));
        if (s && s[0] === 1 && s[1] === 1) {
          const tr = ch.slice().reverse().map(tpush);
          if (key(mul(tr)) < key(mul(ch))) return ok(mul([...coef, ...scNew, ...tr]), RULES.scalarT);
        }
      }
      return null;
    }

    function splitCoef(t) {
      if (isNum(t)) return [t.v, null];
      if (t.t === 'mul' && isNum(t.f[0])) return [t.f[0].v, mul(t.f.slice(1))];
      return [R.ONE, t];
    }
    function addRule(n) {
      const groups = new Map();
      const order = [];
      for (const t of n.ts) {
        const [c, r] = splitCoef(t);
        const k = r ? key(r) : '#';
        if (!groups.has(k)) { groups.set(k, { c: R.ZERO, r, count: 0 }); order.push(k); }
        const g = groups.get(k);
        g.c = N.add(g.c, c);
        g.count++;
      }
      if (order.length < n.ts.length) {
        const ts = order.map((k) => groups.get(k)).filter((g) => !N.isZero(g.c)).map((g) => (g.r ? mul([num(g.c), g.r]) : num(g.c)));
        return ok(add(ts), RULES.like);
      }
      const sk = (t) => { const r = splitCoef(t)[1]; return r ? sortKey(r) : '#'; };
      const sorted = n.ts.slice().sort((a, b) => {
        const x = sk(a), y = sk(b);
        return x < y ? -1 : x > y ? 1 : 0;
      });
      if (sorted.some((t, i) => t !== n.ts[i])) return ok(add(sorted), RULES.sortTerms);
      return null;
    }

    function normalize(n, limit = 120) {
      const chain = [{ n, rule: null }];
      const seen = new Set([key(n)]);
      let cur = n;
      for (let i = 0; i < limit; i++) {
        const r = step(cur);
        if (!r) break;
        const k = key(r.n);
        if (seen.has(k)) { cur = r.n; break; }
        seen.add(k);
        chain.push({ n: r.n, rule: r.rule });
        cur = r.n;
      }
      return { chain, final: cur };
    }
    return { normalize };
  }

  // ---------- naming conventions & dimensions ----------
  const SCALAR_LETTERS = new Set(['a', 'c', 'd', 'k', 'l', 'm', 's', 't', ...E.GREEK]);
  function kindByName(name) {
    if (/^[A-Z]/.test(name) || /^[Α-Ω]/.test(name)) return 'matrix';
    const base = name.replace(/[_\d].*$/, '');
    if (SCALAR_LETTERS.has(base) || /^[α-ω]/.test(name)) return 'scalar';
    return 'vector';
  }

  function collectVars(ast, out = new Set()) {
    if (!ast || typeof ast !== 'object') return out;
    if (ast.type === 'var' && ast.name !== 'I' && ast.name !== 'pi' && !/^I\d+$/.test(ast.name)) out.add(ast.name);
    if (ast.type === 'index') out.add(ast.name);
    for (const k of ['a', 'b', 'l', 'r', 'e', 'lhs', 'rhs']) if (ast[k]) collectVars(ast[k], out);
    if (ast.args) ast.args.forEach((x) => collectVars(x, out));
    if (ast.rows) ast.rows.forEach((row) => row.forEach((x) => collectVars(x, out)));
    return out;
  }

  // ---------- numeric verification ----------
  function randNonSingular(n) {
    for (let k = 0; k < 20; k++) {
      const A = Mx.random(n, n, -4, 4);
      if (!N.isZero(Mx.det(A))) return A;
    }
    return Mx.identity(n);
  }
  function sameValue(a, b, n) {
    if (a instanceof LA.Eye) a = Mx.scale(a.s, Mx.identity(n));
    if (b instanceof LA.Eye) b = Mx.scale(b.s, Mx.identity(n));
    if (a instanceof LA.Info) a = a.value;
    if (b instanceof LA.Info) b = b.value;
    const toS = (v) => (v instanceof LA.Matrix && v.r === 1 && v.c === 1 ? v.a[0][0] : v);
    a = toS(a); b = toS(b);
    if (N.isNum(a) && N.isNum(b)) return N.eq(a, b, 1e-7);
    if (a instanceof LA.Matrix && b instanceof LA.Matrix) return Mx.equals(a, b);
    return false;
  }
  function numericCheck(lhs, rhs, vars, dimsOf, ws, settings, n) {
    const trials = [];
    let attempts = 0;
    while (trials.length < 4 && attempts < 25) {
      attempts++;
      const env = {};
      for (const v of vars) {
        if (ws[v] !== undefined) { env[v] = ws[v]; continue; }
        const d = dimsOf(v);
        if (d.scalar) { let s; do { s = N.randInt(-5, 5); } while (N.isZero(s)); env[v] = s; }
        else if (d.c === 1) env[v] = Mx.random(d.r, 1, -4, 4);
        else env[v] = randNonSingular(d.r);
      }
      const ctx = E.makeCtx(env, { ...settings, defaultN: n }, false);
      let L, Rv;
      try {
        L = E.evaluate(lhs, ctx);
        Rv = E.evaluate(rhs, ctx);
      } catch (e) {
        if (/singular|Division by zero/.test(e.message)) continue;
        return { status: 'error', message: e.message };
      }
      const same = sameValue(L, Rv, n);
      trials.push({ env, L, R: Rv, same });
      if (!same) return { status: 'fail', trial: trials[trials.length - 1] };
      if (vars.every((v) => ws[v] !== undefined)) break; // deterministic: one trial is enough
    }
    if (!trials.length) return { status: 'error', message: 'Could not find invertible random values to test with.' };
    return { status: 'pass', trials };
  }

  // ---------- main entry ----------
  function explain(src, ws, settings, n = 3) {
    const has = (k) => Object.prototype.hasOwnProperty.call(ws, k);
    const isEq = /(^|[^<>])=/.test(src);
    const ast = E.parse(isEq ? src : `${src} = ${src}`, { equation: true, loose: true, known: has });
    const vars = [...collectVars(ast)];
    // dimensions: workspace values win; otherwise by naming convention with size n (or inferred)
    let nn = n;
    for (const v of vars) if (ws[v] instanceof LA.Matrix) { nn = ws[v].r; break; }
    const dims = {};
    for (const v of vars) {
      const w = ws[v];
      if (w instanceof LA.Matrix) dims[v] = { r: w.r, c: w.c, scalar: false, from: 'ws' };
      else if (w !== undefined && N.isNum(w)) dims[v] = { r: 1, c: 1, scalar: true, from: 'ws' };
      else {
        const k = kindByName(v);
        dims[v] = k === 'scalar' ? { r: 1, c: 1, scalar: true } : k === 'vector' ? { r: nn, c: 1, scalar: false } : { r: nn, c: nn, scalar: false };
      }
    }
    const dimsOf = (v) => dims[v];
    const S = makeShape(dimsOf);
    isScalarGuess = S.isScalar;
    const rw = makeRewriter(S);

    const out = { vars, dims, n: nn, isEq };
    try {
      const L = toSym(ast.lhs), Rr = toSym(ast.rhs);
      const nl = rw.normalize(L);
      out.left = nl;
      if (isEq) {
        const nr = rw.normalize(Rr);
        out.right = nr;
        out.proved = key(nl.final) === key(nr.final);
        out.lines = buildLines(nl, nr, out.proved);
        if (!out.proved) out.hint = hintFor(nl.final, nr.final);
      } else {
        out.lines = nl.chain.map((c, i) => ({ tex: (i ? '= ' : '') + tex(c.n), rule: c.rule }));
      }
    } catch (e) {
      out.symError = e.message;
    }
    out.texOf = tex;
    if (isEq) out.numeric = numericCheck(ast.lhs, ast.rhs, vars, dimsOf, ws, settings, nn);
    else if (vars.every((v) => ws[v] !== undefined)) {
      try { out.value = E.evaluate(ast.lhs, E.makeCtx(ws, settings, false)); } catch (e) { /* ignore */ }
    }
    return out;
  }

  function buildLines(nl, nr, proved) {
    const lines = [];
    nl.chain.forEach((c, i) => lines.push({ tex: tex(c.n), rule: c.rule, side: 'L' }));
    if (proved) {
      const rc = nr.chain;
      for (let j = rc.length - 2; j >= 0; j--) lines.push({ tex: tex(rc[j].n), rule: rc[j + 1].rule, side: 'R' });
    }
    // drop consecutive visual duplicates
    const out = [];
    for (const l of lines) if (!out.length || out[out.length - 1].tex !== l.tex) out.push(l);
    return out.map((l, i) => ({ ...l, tex: (i ? '= ' : '') + l.tex }));
  }

  function hintFor(a, b) {
    const terms = (x) => (x.t === 'add' ? x.ts : [x]);
    const factors = (t) => (t.t === 'mul' ? t.f.filter((f) => !isNum(f)) : [t]);
    const coefOf = (t) => (t.t === 'mul' && isNum(t.f[0]) ? t.f[0].v : isNum(t) ? t.v : R.ONE);
    // total coefficient per unordered multiset of factors
    const bag = (x) => {
      const m = new Map();
      for (const t of terms(x)) {
        const k = factors(t).map(sortKey).join('*').split('*').sort().join('*');
        m.set(k, N.add(m.get(k) || R.ZERO, coefOf(t)));
      }
      return [...m.entries()].filter(([, c]) => !N.isZero(c)).map(([k, c]) => k + ':' + N.toText(c, 'frac')).sort().join('|');
    };
    if (bag(a) === bag(b)) return 'Both sides have the same factors, just multiplied in a different order. Matrix multiplication is not commutative (AB ≠ BA in general), so this only holds for special matrices — e.g. ones that commute.';
    // X^T X appearing on one side only → orthogonality
    const stripGram = (t) => {
      const f = factors(t);
      for (let i = 0; i + 1 < f.length; i++) {
        if (f[i].t === 'T' && key(f[i].a) === key(f[i + 1])) return { name: tex(f[i + 1]), rest: mul([...(t.t === 'mul' && isNum(t.f[0]) ? [t.f[0]] : []), ...f.slice(0, i), ...f.slice(i + 2)]) };
      }
      return null;
    };
    if (terms(a).length === 1 && terms(b).length === 1) {
      for (const [x, y] of [[a, b], [b, a]]) {
        const g = stripGram(x);
        if (g && key(g.rest) === key(y)) return `The sides differ by a factor ${g.name}^{\\mathsf T}${g.name}. This holds exactly when ${g.name}^{\\mathsf T}${g.name} = I, i.e. when ${g.name} is orthogonal.`;
      }
    }
    return null;
  }

  // Library of classic identities (click to try)
  const LIBRARY = [
    { eq: '<v, A w> = <A^T v, w>', note: 'Moving a matrix across the inner product (adjoint)' },
    { eq: '(A B)^T = B^T A^T', note: 'Transpose reverses products' },
    { eq: '(A B)^-1 = B^-1 A^-1', note: 'Inverse reverses products' },
    { eq: '(A^T)^-1 = (A^-1)^T', note: 'Transpose and inverse commute' },
    { eq: 'norm(A v)^2 = <v, gram(A) v>', note: '‖Av‖² via the Gram matrix AᵀA' },
    { eq: '<u + v, w> = <u, w> + <v, w>', note: 'Linearity of the inner product' },
    { eq: 'norm(u + v)^2 = norm(u)^2 + 2<u, v> + norm(v)^2', note: 'Expanding a squared norm' },
    { eq: 'det(2A) = 8 det(A)', note: 'det(cA) = cⁿ det A (here n = 3)' },
    { eq: 'det(A^-1 B A) = det(B)', note: 'Similar matrices share determinants' },
    { eq: 'tr(A B C) = tr(C A B)', note: 'Cyclic property of the trace' },
    { eq: '<A, B> = tr(A^T B)', note: 'Frobenius inner product of matrices' },
    { eq: '(A + B)^2 = A^2 + 2A B + B^2', note: 'Usually FALSE — try it and see why' },
    { eq: '(A B)^T = A^T B^T', note: 'A classic mistake' },
    { eq: '<A v, A w> = <v, w>', note: 'True only for orthogonal A' },
    { eq: '(A + B)^2', note: 'No "=": just expand/simplify' },
  ];

  LA.identities = { explain, LIBRARY, RULES, tex, kindByName };
})();
