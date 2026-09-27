// Matrix algorithms over the scalar type in num.js. Most routines can record
// human-readable steps (LaTeX) for display in the "show steps" panel.
(function () {
  const LA = window.LA;
  const N = LA.num;
  const { R, MathError } = { R: N.R, MathError: LA.MathError };

  class Matrix {
    constructor(rows) {
      if (!rows.length || !rows[0].length) throw new MathError('Empty matrix');
      const c = rows[0].length;
      for (const row of rows) if (row.length !== c) throw new MathError('All rows must have the same length');
      this.a = rows;
      this.r = rows.length;
      this.c = c;
    }
    get dims() { return `${this.r}×${this.c}`; }
    get isSquare() { return this.r === this.c; }
    get isVector() { return this.c === 1 || this.r === 1; }
    col(j) { return this.a.map((row) => row[j]); }
    map(f) { return new Matrix(this.a.map((row, i) => row.map((x, j) => f(x, i, j)))); }
    clone() { return new Matrix(this.a.map((r) => r.slice())); }
  }

  const fromCols = (cols) => new Matrix(cols[0].map((_, i) => cols.map((c) => c[i])));
  const isExactM = (M) => M.a.every((r) => r.every(N.isExact));

  function identity(n) {
    return new Matrix(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? R.ONE : R.ZERO))));
  }
  function zeros(r, c) { return new Matrix(Array.from({ length: r }, () => Array.from({ length: c }, () => R.ZERO))); }
  function fill(r, c, v) { return new Matrix(Array.from({ length: r }, () => Array.from({ length: c }, () => v))); }
  function random(r, c, lo = -5, hi = 5) {
    return new Matrix(Array.from({ length: r }, () => Array.from({ length: c }, () => N.randInt(lo, hi))));
  }
  function diag(vals) {
    const n = vals.length;
    return new Matrix(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? vals[i] : R.ZERO))));
  }

  function transpose(A) { return new Matrix(A.a[0].map((_, j) => A.a.map((row) => row[j]))); }

  function sameDims(A, B, what) {
    if (A.r !== B.r || A.c !== B.c) throw new MathError(`Can't ${what} a ${A.dims} and a ${B.dims} matrix: dimensions must match.`);
  }
  function add(A, B) { sameDims(A, B, 'add'); return A.map((x, i, j) => N.add(x, B.a[i][j])); }
  function sub(A, B) { sameDims(A, B, 'subtract'); return A.map((x, i, j) => N.sub(x, B.a[i][j])); }
  function scale(s, A) { return A.map((x) => N.mul(s, x)); }
  function mul(A, B) {
    if (A.c !== B.r)
      throw new MathError(`Can't multiply a ${A.dims} by a ${B.dims}: the inner dimensions (${A.c} and ${B.r}) must match.`);
    const out = [];
    for (let i = 0; i < A.r; i++) {
      const row = [];
      for (let j = 0; j < B.c; j++) {
        let s = R.ZERO;
        for (let k = 0; k < A.c; k++) s = N.add(s, N.mul(A.a[i][k], B.a[k][j]));
        row.push(s);
      }
      out.push(row);
    }
    return new Matrix(out);
  }
  function needSquare(A, what) {
    if (!A.isSquare) throw new MathError(`${what} needs a square matrix, but this one is ${A.dims}.`);
  }
  function pow(A, k) {
    needSquare(A, 'A matrix power');
    if (k < 0) return pow(inverse(A), -k);
    let res = identity(A.r), b = A;
    while (k > 0) {
      if (k & 1) res = mul(res, b);
      b = mul(b, b);
      k >>= 1;
    }
    return res;
  }
  function equals(A, B) {
    if (A.r !== B.r || A.c !== B.c) return false;
    return A.a.every((row, i) => row.every((x, j) => N.eq(x, B.a[i][j], 1e-7)));
  }
  function hcat(ms) {
    const r = ms[0].r;
    for (const m of ms) if (m.r !== r) throw new MathError(`Can't place a ${m.dims} block beside a block with ${r} rows.`);
    return new Matrix(Array.from({ length: r }, (_, i) => ms.flatMap((m) => m.a[i])));
  }
  function vcat(ms) {
    const c = ms[0].c;
    for (const m of ms) if (m.c !== c) throw new MathError(`Can't stack a ${m.dims} block under a block with ${c} columns.`);
    return new Matrix(ms.flatMap((m) => m.a.map((r) => r.slice())));
  }
  function trace(A) {
    needSquare(A, 'Trace');
    let s = R.ZERO;
    for (let i = 0; i < A.r; i++) s = N.add(s, A.a[i][i]);
    return s;
  }
  function isSymmetric(A) { return A.isSquare && equals(A, transpose(A)); }

  // ---------- LaTeX ----------
  function latex(A, aug = 0) {
    let body = A.a.map((row) => row.map((x) => N.toLatex(x)).join(' & ')).join(' \\\\ ');
    if (body.includes('\\frac')) body = body.replace(/\\frac/g, '\\dfrac');
    if (aug > 0) {
      const spec = 'c'.repeat(A.c - aug) + '|' + 'c'.repeat(aug);
      return `\\left[\\begin{array}{${spec}}${body}\\end{array}\\right]`;
    }
    return `\\begin{bmatrix}${body}\\end{bmatrix}`;
  }
  function coefLatex(f) {
    // coefficient in front of a row: "3", "\frac12", "(-2)" ... returns '' for 1
    if (N.isOne(f)) return '';
    const s = N.toLatex(f);
    return s.startsWith('-') ? `\\left(${s}\\right)` : s;
  }
  const Rl = (i) => `R_{${i + 1}}`;

  // ---------- Elimination ----------
  // Gaussian (reduced=false) or Gauss–Jordan (reduced=true) elimination.
  // augment: number of trailing columns that are never used as pivots.
  function eliminate(M, { reduced = true, augment = 0, steps = null, tol = null, opLog = null } = {}) {
    const A = M.a.map((r) => r.slice());
    const m = M.r, n = M.c, nc = n - augment;
    const exact = isExactM(M);
    const z = tol ? (x) => Math.abs(N.toF(x)) < tol : N.isZero;
    const pivots = [];
    let swaps = 0;
    let scaleProd = R.ONE; // product of scalings applied (for determinant)
    const snap = () => new Matrix(A.map((r) => r.slice()));
    let row = 0;
    for (let col = 0; col < nc && row < m; col++) {
      let p = -1;
      if (exact) {
        for (let i = row; i < m; i++) {
          if (z(A[i][col])) continue;
          if (p < 0) p = i;
          if (N.isOne(N.abs(A[i][col]))) { p = i; break; }
        }
      } else {
        let best = tol || 1e-10;
        for (let i = row; i < m; i++) {
          const v = Math.abs(N.toF(A[i][col]));
          if (v > best) { best = v; p = i; }
        }
      }
      if (p < 0) { for (let i = row; i < m; i++) A[i][col] = R.ZERO; continue; }
      let ops = [];
      if (p !== row) {
        [A[p], A[row]] = [A[row], A[p]];
        swaps++;
        if (opLog) opLog.push({ type: 'swap', i: row, j: p });
        ops.push(`${Rl(row)} \\leftrightarrow ${Rl(p)}`);
      }
      const piv = A[row][col];
      if (reduced && !N.isOne(piv)) {
        const f = N.inv(piv);
        A[row] = A[row].map((x) => N.mul(x, f));
        A[row][col] = R.ONE;
        scaleProd = N.mul(scaleProd, piv);
        if (opLog) opLog.push({ type: 'scale', i: row, f });
        ops.push(`${Rl(row)} \\leftarrow ${coefLatex(f)}${Rl(row)}`);
      }
      if (steps && ops.length) steps.push({ ops, mat: snap(), aug: augment });
      ops = [];
      const pv = A[row][col];
      for (let r = reduced ? 0 : row + 1; r < m; r++) {
        if (r === row || z(A[r][col])) { if (r !== row) A[r][col] = R.ZERO; continue; }
        const f = N.div(A[r][col], pv);
        A[r] = A[r].map((x, j) => {
          const v = N.sub(x, N.mul(f, A[row][j]));
          return !N.isExact(v) && Math.abs(v) < 1e-11 ? R.ZERO : v;
        });
        A[r][col] = R.ZERO;
        const neg = N.sign(f) < 0;
        if (opLog) opLog.push({ type: 'add', i: r, j: row, f: N.neg(f) });
        ops.push(`${Rl(r)} \\leftarrow ${Rl(r)} ${neg ? '+' : '-'} ${coefLatex(N.abs(f))}${Rl(row)}`);
      }
      if (steps && ops.length) steps.push({ ops, mat: snap(), aug: augment });
      pivots.push(col);
      row++;
    }
    return { R: new Matrix(A), pivots, swaps, scaleProd };
  }

  // Elementary matrix for a logged row operation on an m-row matrix
  function elementary(op, m) {
    const E = identity(m).a.map((r) => r.slice());
    if (op.type === 'swap') { [E[op.i], E[op.j]] = [E[op.j], E[op.i]]; }
    else if (op.type === 'scale') E[op.i][op.i] = op.f;
    else E[op.i][op.j] = op.f; // R_i ← R_i + f R_j
    return new Matrix(E);
  }
  // EA = R: returns the elementary matrices (in order applied), E = E_k⋯E_1, and R
  function elimFactor(A) {
    const opLog = [];
    const { R: Rm } = eliminate(A, { reduced: true, opLog });
    const Es = opLog.map((op) => ({ op, E: elementary(op, A.r) }));
    let E = identity(A.r);
    for (const { E: Ek } of Es) E = mul(Ek, E);
    return { Es, E, R: Rm };
  }
  function opLatex(op) {
    if (op.type === 'swap') return `${Rl(op.i)} \\leftrightarrow ${Rl(op.j)}`;
    if (op.type === 'scale') return `${Rl(op.i)} \\leftarrow ${coefLatex(op.f)}${Rl(op.i)}`;
    const neg = N.sign(op.f) < 0;
    return `${Rl(op.i)} \\leftarrow ${Rl(op.i)} ${neg ? '-' : '+'} ${coefLatex(N.abs(op.f))}${Rl(op.j)}`;
  }

  function rref(M, steps) { return eliminate(M, { reduced: true, steps }).R; }
  function ref(M, steps) { return eliminate(M, { reduced: false, steps }).R; }
  function rank(M) { return eliminate(M, { reduced: false }).pivots.length; }

  function det(A, steps) {
    needSquare(A, 'The determinant');
    const n = A.r;
    const L = (M) => latex(M).replace('bmatrix', 'vmatrix').replace('bmatrix', 'vmatrix');
    if (n === 1) return A.a[0][0];
    if (n === 2) {
      const [[a, b], [c, d]] = A.a;
      const v = N.sub(N.mul(a, d), N.mul(b, c));
      if (steps) steps.push({ text: `\\det = ad - bc = (${N.toLatex(a)})(${N.toLatex(d)}) - (${N.toLatex(b)})(${N.toLatex(c)}) = ${N.toLatex(v)}` });
      return v;
    }
    if (n === 3 && steps) {
      // Cofactor expansion along the first row
      const terms = [];
      let total = R.ZERO;
      const parts = [];
      for (let j = 0; j < 3; j++) {
        const Mj = minorMatrix(A, 0, j);
        const d = det(Mj);
        const s = j % 2 === 0 ? '+' : '-';
        const a = A.a[0][j];
        terms.push(`${j ? s : s === '-' ? '-' : ''} (${N.toLatex(a)})${L(Mj)}`);
        parts.push(`${j ? s : ''} (${N.toLatex(a)})(${N.toLatex(d)})`);
        total = N.add(total, N.mul(j % 2 ? N.neg(a) : a, d));
      }
      steps.push({ text: `\\text{Cofactor expansion along row 1:}` });
      steps.push({ text: `\\det = ${terms.join(' ')}` });
      steps.push({ text: `= ${parts.join(' ')} = ${N.toLatex(total)}` });
      return total;
    }
    const st = steps ? [] : null;
    const { R: U, pivots, swaps } = eliminate(A, { reduced: false, steps: st });
    if (pivots.length < n) {
      if (steps) { steps.push(...st); steps.push({ text: '\\text{A zero pivot column appears, so } \\det = 0' }); }
      return R.ZERO;
    }
    let d = swaps % 2 ? N.neg(R.ONE) : R.ONE;
    for (let i = 0; i < n; i++) d = N.mul(d, U.a[i][i]);
    if (steps) {
      steps.push({ text: '\\text{Reduce to upper-triangular form (row swaps flip the sign):}' });
      steps.push(...st);
      const diagStr = U.a.map((r, i) => `(${N.toLatex(r[i])})`).join('');
      steps.push({ text: `\\det = ${swaps % 2 ? '-' : ''}${diagStr} = ${N.toLatex(d)}${swaps ? `\\quad(${swaps}\\text{ swap${swaps > 1 ? 's' : ''}})` : ''}` });
    }
    return d;
  }

  function inverse(A, steps) {
    needSquare(A, 'The inverse');
    const n = A.r;
    const aug = hcat([A, identity(n)]);
    if (steps) steps.push({ ops: ['\\text{Start with } [A \\mid I]'], mat: aug, aug: n });
    const { R: Rm, pivots } = eliminate(aug, { reduced: true, augment: n, steps });
    if (pivots.length < n) throw new MathError(`This matrix is singular (rank ${pivots.length} < ${n}, det = 0), so it has no inverse.`);
    if (steps) steps.push({ text: '\\text{Left block is } I\\text{, so the right block is } A^{-1}.' });
    return new Matrix(Rm.a.map((r) => r.slice(n)));
  }

  function minorMatrix(A, i, j) {
    return new Matrix(A.a.filter((_, r) => r !== i).map((row) => row.filter((_, c) => c !== j)));
  }
  function cofactorMatrix(A) {
    needSquare(A, 'The cofactor matrix');
    if (A.r === 1) return new Matrix([[R.ONE]]);
    return A.map((_, i, j) => {
      const d = det(minorMatrix(A, i, j));
      return (i + j) % 2 ? N.neg(d) : d;
    });
  }
  function adjugate(A) { return transpose(cofactorMatrix(A)); }

  function nullspace(A, tol) {
    const { R: Rm, pivots } = eliminate(A, { reduced: true, tol });
    const n = A.c;
    const free = [];
    for (let j = 0; j < n; j++) if (!pivots.includes(j)) free.push(j);
    return free.map((f) => {
      const v = Array(n).fill(R.ZERO);
      v[f] = R.ONE;
      pivots.forEach((pc, i) => { v[pc] = N.neg(Rm.a[i][f]); });
      return v;
    });
  }
  function colspace(A) {
    const { pivots } = eliminate(A, { reduced: false });
    return pivots.map((j) => A.col(j));
  }
  function rowspace(A) {
    const { R: Rm, pivots } = eliminate(A, { reduced: true });
    return Rm.a.slice(0, pivots.length);
  }

  // Solve A x = b. Returns {kind:'unique', x} | {kind:'none'} | {kind:'infinite', xp, basis, free}
  function solve(A, b, steps) {
    if (A.r !== b.r) throw new MathError(`A has ${A.r} rows but b has ${b.r}; they must match to solve Ax = b.`);
    const aug = hcat([A, b]);
    if (steps) steps.push({ ops: ['\\text{Augmented matrix } [A \\mid b]'], mat: aug, aug: b.c });
    const { R: Rm, pivots } = eliminate(aug, { reduced: true, augment: b.c, steps });
    const n = A.c;
    for (let i = pivots.length; i < A.r; i++) {
      if (Rm.a[i].slice(n).some((x) => !N.isZero(x))) {
        if (steps) steps.push({ text: `\\text{Row ${i + 1} reads } 0 = ${N.toLatex(Rm.a[i].find((x, j) => j >= n && !N.isZero(x)))}\\text{ — inconsistent.}` });
        return { kind: 'none', R: Rm };
      }
    }
    const xp = zeros(n, b.c).a;
    pivots.forEach((pc, i) => { for (let k = 0; k < b.c; k++) xp[pc][k] = Rm.a[i][n + k]; });
    if (pivots.length === n) return { kind: 'unique', x: new Matrix(xp) };
    const free = [];
    for (let j = 0; j < n; j++) if (!pivots.includes(j)) free.push(j);
    const basis = nullspace(A);
    return { kind: 'infinite', xp: new Matrix(xp), basis, free };
  }

  // Faddeev–LeVerrier: coefficients of det(λI − A), low → high degree (monic).
  function charpoly(A) {
    needSquare(A, 'The characteristic polynomial');
    const n = A.r;
    const c = Array(n + 1).fill(R.ZERO);
    c[n] = R.ONE;
    let M = zeros(n, n);
    const I = identity(n);
    for (let k = 1; k <= n; k++) {
      M = add(mul(A, M), scale(c[n - k + 1], I));
      c[n - k] = N.div(N.neg(trace(mul(A, M))), N.fromInt(k));
    }
    return c;
  }

  function polyLatex(c, v = '\\lambda') {
    let s = '';
    for (let k = c.length - 1; k >= 0; k--) {
      const a = c[k];
      if (N.isZero(a)) continue;
      const neg = N.sign(a) < 0;
      const m = N.abs(a);
      let term;
      const vk = k === 0 ? '' : k === 1 ? v : `${v}^{${k}}`;
      if (k === 0) term = N.toLatex(m);
      else term = (N.isOne(m) ? '' : N.toLatex(m)) + vk;
      if (!s) s = (neg ? '-' : '') + term;
      else s += (neg ? ' - ' : ' + ') + term;
    }
    return s || '0';
  }

  // ---------- polynomial roots ----------
  function evalPoly(c, x) { let s = R.ZERO; for (let k = c.length - 1; k >= 0; k--) s = N.add(N.mul(s, x), c[k]); return s; }
  function deflate(c, r) {
    // divide by (x - r)
    const n = c.length - 1;
    const q = Array(n).fill(R.ZERO);
    let carry = R.ZERO;
    for (let k = n; k >= 1; k--) { carry = N.add(c[k], N.mul(carry, r)); q[k - 1] = carry; }
    return q;
  }
  function divisors(n) {
    n = n < 0n ? -n : n;
    if (n === 0n || n > 10n ** 12n) return null;
    const out = [];
    for (let d = 1n; d * d <= n; d++) if (n % d === 0n) { out.push(d); if (d * d !== n) out.push(n / d); }
    return out;
  }
  function rationalRoots(coeffs) {
    let c = coeffs.slice();
    const roots = [];
    if (!c.every(N.isR)) return { roots, rest: c };
    const push = (v) => {
      const f = roots.find((r) => N.eq(r.v, v));
      if (f) f.mult++; else roots.push({ v, mult: 1 });
    };
    while (c.length > 1 && N.isZero(c[0])) { push(R.ZERO); c = c.slice(1); }
    if (c.length <= 1) return { roots, rest: c };
    let L = 1n;
    for (const a of c) L = (L * a.d) / N.bgcd(L, a.d);
    const ints = c.map((a) => (a.n * L) / a.d);
    const ps = divisors(ints[0]), qs = divisors(ints[ints.length - 1]);
    if (!ps || !qs) return { roots, rest: c };
    const cands = [];
    for (const p of ps) for (const q of qs) { cands.push(new R(p, q)); cands.push(new R(-p, q)); }
    for (const x of cands) {
      while (c.length > 1 && N.isZero(evalPoly(c, x))) { push(x); c = deflate(c, x); }
    }
    return { roots, rest: c };
  }
  // Durand–Kerner for the remaining (irrational/complex) roots; returns [{re, im}]
  function numericRoots(c) {
    const n = c.length - 1;
    if (n < 1) return [];
    const a = c.map(N.toF);
    const lead = a[n];
    const p = a.map((x) => x / lead);
    const evalC = (re, im) => {
      let sr = 0, si = 0;
      for (let k = n; k >= 0; k--) { const t = sr * re - si * im + p[k]; si = sr * im + si * re; sr = t; }
      return [sr, si];
    };
    let z = Array.from({ length: n }, (_, k) => { const ang = (2 * Math.PI * k) / n + 0.4; return [Math.cos(ang) * 1.3, Math.sin(ang) * 1.3]; });
    for (let it = 0; it < 500; it++) {
      let delta = 0;
      z = z.map((zi, i) => {
        let [nr, ni] = evalC(zi[0], zi[1]);
        let dr = 1, di = 0;
        z.forEach((zj, j) => { if (j === i) return; const xr = zi[0] - zj[0], xi = zi[1] - zj[1]; const t = dr * xr - di * xi; di = dr * xi + di * xr; dr = t; });
        const den = dr * dr + di * di || 1e-300;
        const qr = (nr * dr + ni * di) / den, qi = (ni * dr - nr * di) / den;
        delta = Math.max(delta, Math.hypot(qr, qi));
        return [zi[0] - qr, zi[1] - qi];
      });
      if (delta < 1e-14) break;
    }
    return z.map(([re, im]) => ({ re: Math.abs(re) < 1e-12 ? 0 : re, im: Math.abs(im) < 1e-9 ? 0 : im }));
  }

  // Scale an exact vector by the LCM of its denominators (nicer eigenvectors)
  function clearDenoms(v) {
    if (!v.every(N.isR)) return v;
    let L = 1n;
    for (const x of v) L = (L * x.d) / N.bgcd(L, x.d);
    return L === 1n ? v : v.map((x) => N.mul(x, new R(L)));
  }

  // Eigen-analysis. Returns a structured object used by the evaluator to build an info card.
  function eigen(A) {
    needSquare(A, 'Eigenvalues');
    const n = A.r;
    const c = charpoly(A);
    const { roots, rest } = rationalRoots(c);
    const res = { charpoly: c, exact: [], other: [] };
    for (const { v, mult } of roots) {
      const B = sub(A, scale(v, identity(n)));
      const basis = nullspace(B).map(clearDenoms);
      res.exact.push({ v, mult, basis });
    }
    const deg = rest.length - 1;
    if (deg === 2 && rest.every(N.isR)) {
      const [c0, c1, c2] = rest;
      const D = N.sub(N.mul(c1, c1), N.mul(N.fromInt(4), N.mul(c2, c0)));
      const p = N.div(N.neg(c1), N.mul(N.fromInt(2), c2));
      const q = N.div(N.sqrt(N.abs(D)), N.mul(N.fromInt(2), c2));
      const complex = N.sign(D) < 0;
      const qa = N.abs(q);
      const qt = complex && N.isOne(qa) ? '' : N.toLatex(qa);
      const tex = `${N.isZero(p) ? '' : N.toLatex(p)} \\pm ${qt}${complex ? 'i' : ''}`;
      res.quadratic = { p, q: N.abs(q), complex, tex };
      if (!complex) {
        for (const s of [1, -1]) {
          const val = N.toF(p) + s * N.toF(q);
          const basis = nullspace(sub(A, scale(val, identity(n))), 1e-6);
          res.other.push({ re: val, im: 0, basis, tex: `${N.isZero(p) ? '' : N.toLatex(p)} ${s > 0 ? '+' : '-'} ${N.toLatex(N.abs(q))}` });
        }
      } else {
        for (const s of [1, -1]) res.other.push({ re: N.toF(p), im: s * N.toF(q), basis: null });
      }
    } else if (deg >= 1) {
      for (const z of numericRoots(rest)) {
        const basis = z.im === 0 ? nullspace(sub(A, scale(z.re, identity(n))), 1e-6) : null;
        res.other.push({ ...z, basis });
      }
    }
    return res;
  }

  // PA = LU with row pivoting only when needed.
  function lu(A) {
    const m = A.r, n = A.c;
    const U = A.a.map((r) => r.slice());
    const L = identity(m).a.map((r) => r.slice());
    const perm = Array.from({ length: m }, (_, i) => i);
    const exact = isExactM(A);
    let swapped = false;
    for (let k = 0; k < Math.min(m, n); k++) {
      let p = -1;
      if (exact) { for (let i = k; i < m; i++) if (!N.isZero(U[i][k])) { p = i; break; } }
      else { let best = 1e-12; for (let i = k; i < m; i++) { const v = Math.abs(N.toF(U[i][k])); if (v > best) { best = v; p = i; } } }
      if (p < 0) continue;
      if (p !== k) {
        swapped = true;
        [U[p], U[k]] = [U[k], U[p]];
        [perm[p], perm[k]] = [perm[k], perm[p]];
        for (let j = 0; j < k; j++) [L[p][j], L[k][j]] = [L[k][j], L[p][j]];
      }
      for (let i = k + 1; i < m; i++) {
        const f = N.div(U[i][k], U[k][k]);
        L[i][k] = f;
        U[i] = U[i].map((x, j) => N.sub(x, N.mul(f, U[k][j])));
        U[i][k] = R.ZERO;
      }
    }
    const P = new Matrix(perm.map((pi) => Array.from({ length: m }, (_, j) => (j === pi ? R.ONE : R.ZERO))));
    return { P, L: new Matrix(L), U: new Matrix(U), swapped };
  }

  function dotCols(u, v) {
    let s = R.ZERO;
    for (let i = 0; i < u.length; i++) s = N.add(s, N.mul(u[i], v[i]));
    return s;
  }
  // Gram–Schmidt on the columns of A. Returns orthogonal (unnormalized) columns, skipping dependent ones.
  function gramSchmidt(A, steps) {
    const out = [];
    for (let j = 0; j < A.c; j++) {
      let v = A.col(j);
      const pieces = [];
      for (let k = 0; k < out.length; k++) {
        const u = out[k];
        const coef = N.div(dotCols(v, u), dotCols(u, u));
        if (!N.isZero(coef)) pieces.push(`${N.sign(coef) < 0 ? '+' : '-'} ${coefLatex(N.abs(coef))}u_{${k + 1}}`);
        v = v.map((x, i) => N.sub(x, N.mul(coef, u[i])));
      }
      if (v.every(N.isZero)) {
        if (steps) steps.push({ text: `a_{${j + 1}} \\text{ is dependent on earlier columns — skipped}` });
        continue;
      }
      out.push(v);
      if (steps) steps.push({ text: `u_{${out.length}} = a_{${j + 1}} ${pieces.join(' ')} = ${latex(fromCols([v]))}` });
    }
    if (!out.length) throw new MathError('All columns are zero; nothing to orthogonalize.');
    return fromCols(out);
  }
  function normalizeCols(Q) {
    const cols = [];
    for (let j = 0; j < Q.c; j++) {
      const c = Q.col(j);
      const nr = N.sqrt(dotCols(c, c));
      cols.push(c.map((x) => N.div(x, nr)));
    }
    return fromCols(cols);
  }

  function cross(u, v) {
    const [a1, a2, a3] = u, [b1, b2, b3] = v;
    const s = N.sub, m = N.mul;
    return [s(m(a2, b3), m(a3, b2)), s(m(a3, b1), m(a1, b3)), s(m(a1, b2), m(a2, b1))];
  }

  LA.Matrix = Matrix;
  LA.mat = {
    Matrix, fromCols, identity, zeros, fill, random, diag, transpose, add, sub, scale, mul, pow, equals,
    hcat, vcat, trace, isSymmetric, latex, eliminate, rref, ref, rank, det, inverse, minorMatrix,
    cofactorMatrix, adjugate, nullspace, colspace, rowspace, solve, charpoly, polyLatex, eigen, lu,
    gramSchmidt, normalizeCols, cross, dotCols, isExactM, coefLatex, elimFactor, opLatex,
  };
})();
