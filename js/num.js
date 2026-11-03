// Scalars: exact rationals (R, BigInt-backed), exact square-root forms (Surd), exact complex
// numbers a + bi with rational a, b (C), or JS floats.
// Arithmetic stays exact whenever both operands are exact; otherwise falls back to floats.
(function () {
  const LA = (window.LA = window.LA || {});

  function bgcd(a, b) {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b) [a, b] = [b, a % b];
    return a;
  }
  const babs = (a) => (a < 0n ? -a : a);

  class R {
    constructor(n, d = 1n) {
      if (d === 0n) throw new LA.MathError('Division by zero');
      if (d < 0n) { n = -n; d = -d; }
      const g = bgcd(n, d) || 1n;
      this.n = n / g;
      this.d = d / g;
    }
    static int(k) { return new R(BigInt(k)); }
    toFloat() { return Number(this.n) / Number(this.d); }
  }
  R.ZERO = new R(0n);
  R.ONE = new R(1n);

  // c * sqrt(r), r a squarefree positive BigInt > 1, c rational
  class Surd {
    constructor(c, r) { this.c = c; this.r = r; }
    toFloat() { return this.c.toFloat() * Math.sqrt(Number(this.r)); }
  }

  class MathError extends Error {}
  LA.MathError = MathError;

  // Complex number re + im·i with exact rational parts (im ≠ 0; otherwise it is just an R).
  class C {
    constructor(re, im) { this.re = re; this.im = im; }
    toFloat() { throw new MathError('This needs a real number, but got a complex one.'); }
  }

  const isR = (x) => x instanceof R;
  const isSurd = (x) => x instanceof Surd;
  const isC = (x) => x instanceof C;
  const isNum = (x) => isR(x) || isSurd(x) || isC(x) || typeof x === 'number';
  const mkC = (re, im) => (im.n === 0n ? re : new C(re, im));
  // Real and imaginary parts of an exact scalar (complex arithmetic is only done exactly)
  function parts(a) {
    if (isC(a)) return [a.re, a.im];
    if (isR(a)) return [a, R.ZERO];
    throw new MathError('Complex numbers can only be combined with exact numbers (no square roots or decimals).');
  }
  const toF = (x) => (typeof x === 'number' ? x : x.toFloat());
  const EPS = 1e-10;

  function fromInt(k) { return new R(BigInt(k)); }

  // Parse a plain numeric literal ("3", "-2.5", ".5", "1e-3", "3/4") into an exact rational.
  function parseLiteral(s) {
    s = String(s).trim();
    if (s.includes('/')) {
      const [a, b] = s.split('/');
      return div(parseLiteral(a), parseLiteral(b));
    }
    const m = /^([+-])?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) throw new MathError(`Not a number: "${s}"`);
    const intPart = m[2] || '0';
    const frac = m[3] || '';
    let n = BigInt(intPart + frac);
    let d = 10n ** BigInt(frac.length);
    const e = m[4] ? parseInt(m[4], 10) : 0;
    if (Math.abs(e) > 400) throw new MathError('Exponent too large');
    if (e > 0) n *= 10n ** BigInt(e);
    if (e < 0) d *= 10n ** BigInt(-e);
    if (m[1] === '-') n = -n;
    return new R(n, d);
  }

  // Convert a float to an exact rational when it is (very nearly) a simple fraction.
  function fromFloat(x) {
    if (!isFinite(x)) throw new MathError('Result is not finite');
    if (Number.isInteger(x) && Math.abs(x) < 2 ** 53) return fromInt(x);
    return x;
  }

  function add(a, b) {
    if (isR(a) && isR(b)) return new R(a.n * b.d + b.n * a.d, a.d * b.d);
    if (isC(a) || isC(b)) {
      if (isZero(a)) return b;
      if (isZero(b)) return a;
      const [ar, ai] = parts(a), [br, bi] = parts(b);
      return mkC(add(ar, br), add(ai, bi));
    }
    if (isSurd(a) && isSurd(b) && a.r === b.r) return mkSurd(add(a.c, b.c), a.r);
    if (isZero(a)) return b;
    if (isZero(b)) return a;
    return toF(a) + toF(b);
  }
  function neg(a) {
    if (isR(a)) return new R(-a.n, a.d);
    if (isSurd(a)) return new Surd(neg(a.c), a.r);
    if (isC(a)) return new C(neg(a.re), neg(a.im));
    return -a;
  }
  function sub(a, b) { return add(a, neg(b)); }
  function mul(a, b) {
    if (isR(a) && isR(b)) return new R(a.n * b.n, a.d * b.d);
    if (isC(a) || isC(b)) {
      if (isZero(a) || isZero(b)) return R.ZERO;
      const [ar, ai] = parts(a), [br, bi] = parts(b);
      return mkC(sub(mul(ar, br), mul(ai, bi)), add(mul(ar, bi), mul(ai, br)));
    }
    if (isR(a) && isSurd(b)) return mkSurd(mul(a, b.c), b.r);
    if (isSurd(a) && isR(b)) return mkSurd(mul(a.c, b), a.r);
    if (isSurd(a) && isSurd(b)) return mul(mul(a.c, b.c), sqrt(new R(a.r * b.r)));
    if (isZero(a) || isZero(b)) return R.ZERO;
    return toF(a) * toF(b);
  }
  function inv(a) {
    if (isZero(a)) throw new MathError('Division by zero');
    if (isR(a)) return new R(a.d, a.n);
    if (isSurd(a)) return mkSurd(inv(mul(a.c, new R(a.r))), a.r); // 1/(c√r) = √r/(c r)
    if (isC(a)) { const d = add(mul(a.re, a.re), mul(a.im, a.im)); return mkC(div(a.re, d), neg(div(a.im, d))); } // 1/z = z̄/|z|²
    return 1 / a;
  }
  function div(a, b) { return mul(a, inv(b)); }
  function isZero(a) {
    if (isR(a)) return a.n === 0n;
    if (isSurd(a)) return a.c.n === 0n;
    if (isC(a)) return a.re.n === 0n && a.im.n === 0n;
    return Math.abs(a) < EPS;
  }
  function isOne(a) { return isR(a) ? a.n === 1n && a.d === 1n : isC(a) ? false : Math.abs(toF(a) - 1) < EPS; }
  function isExact(a) { return isR(a) || isSurd(a) || isC(a); }
  // For complex numbers this is the *display* sign (of the real part, or of the imaginary part when
  // purely imaginary) so that "x − (2+3i)" style formatting works; abs() is the matching display
  // absolute value. Use modulus() for |z|.
  function sign(a) {
    if (isR(a)) return a.n > 0n ? 1 : a.n < 0n ? -1 : 0;
    if (isC(a)) return a.re.n !== 0n ? sign(a.re) : sign(a.im);
    const f = toF(a);
    return Math.abs(f) < EPS ? 0 : f > 0 ? 1 : -1;
  }
  function eq(a, b, tol = 1e-9) {
    if (isR(a) && isR(b)) return a.n === b.n && a.d === b.d;
    if (isC(a) || isC(b)) {
      try { const [ar, ai] = parts(a), [br, bi] = parts(b); return eq(ar, br) && eq(ai, bi); } catch (e) { return false; }
    }
    const x = toF(a), y = toF(b);
    return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
  }
  function cmp(a, b) { const s = sign(sub(a, b)); return s; }
  function abs(a) { return sign(a) < 0 ? neg(a) : a; }
  function conj(a) { return isC(a) ? new C(a.re, neg(a.im)) : a; }
  function re(a) { return isC(a) ? a.re : a; }
  function im(a) { return isC(a) ? a.im : R.ZERO; }
  // |z| = √(z z̄) = √(a² + b²); for real numbers the usual absolute value
  function modulus(a) { return isC(a) ? sqrt(add(mul(a.re, a.re), mul(a.im, a.im))) : abs(a); }

  function mkSurd(c, r) {
    if (r === 1n) return c;
    if (isR(c) && c.n === 0n) return R.ZERO;
    return new Surd(c, r);
  }

  // Integer square root for BigInt
  function isqrt(n) {
    if (n < 0n) throw new MathError('sqrt of negative');
    if (n < 2n) return n;
    let x = BigInt(Math.floor(Math.sqrt(Number(n))));
    while (x * x > n) x--;
    while ((x + 1n) * (x + 1n) <= n) x++;
    return x;
  }
  // Split n = s^2 * r with r squarefree (trial division, bounded).
  function squareSplit(n) {
    let s = 1n, r = n;
    for (let p = 2n; p * p <= r && p < 100000n; p++) {
      while (r % (p * p) === 0n) { r /= p * p; s *= p; }
    }
    return [s, r];
  }

  function sqrt(a) {
    if (isC(a)) return NaN_ERR('Square roots of non-real complex numbers are not supported.');
    if (sign(a) < 0) {
      // √(−r) = i√r when √r is rational, e.g. sqrt(-4) = 2i
      const r = isR(a) ? sqrt(neg(a)) : null;
      if (isR(r)) return mkC(R.ZERO, r);
      return NaN_ERR('Square root of a negative number (not an exact complex number here)');
    }
    if (isR(a)) {
      const nd = a.n * a.d; // sqrt(n/d) = sqrt(n d)/d
      if (nd > 10n ** 24n) return Math.sqrt(a.toFloat());
      const rt = isqrt(nd);
      if (rt * rt === nd) return new R(rt, a.d);
      const [s, r] = squareSplit(nd);
      return mkSurd(new R(s, a.d), r);
    }
    return Math.sqrt(toF(a));
  }
  function NaN_ERR(msg) { throw new MathError(msg); }

  function powInt(a, k) {
    if (k < 0) return powInt(inv(a), -k);
    let r = R.ONE, b = a;
    while (k > 0) {
      if (k & 1) r = mul(r, b);
      b = mul(b, b);
      k >>= 1;
    }
    return r;
  }
  function pow(a, e) {
    if (isR(e) && e.d === 1n && babs(e.n) < 100000n) return powInt(a, Number(e.n));
    if (isC(a) || isC(e)) throw new MathError('Only integer powers of complex numbers are supported.');
    if (isR(e) && e.d === 2n && e.n === 1n) return sqrt(a);
    const r = Math.pow(toF(a), toF(e));
    if (isNaN(r)) throw new MathError('Result is not a real number');
    return r;
  }
  function isInt(a) { return isR(a) ? a.d === 1n : Number.isInteger(a); }

  // ---------- formatting ----------
  let displayMode = 'frac'; // 'frac' | 'dec'
  function setMode(m) { displayMode = m; }
  function getMode() { return displayMode; }

  function fmtFloat(x, digits = 6) {
    if (Object.is(x, -0) || Math.abs(x) < 1e-12) return '0';
    if (Math.abs(x - Math.round(x)) < 1e-9 && Math.abs(x) < 1e15) return String(Math.round(x));
    let s = x.toPrecision(digits);
    if (s.includes('e')) {
      let [m, e] = s.split('e');
      if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
      return `${m}e${e.replace('+', '')}`;
    }
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  // a + bi with no spaces (so it stays one cell/element when pasted), e.g. 2-3i, -i, 1/2+3/4i
  function complexText(z, fmt) {
    const re = z.re, im = z.im;
    const imAbs = abs(im);
    const imPart = isOne(imAbs) ? 'i' : `${fmt(imAbs)}i`;
    if (re.n === 0n) return (sign(im) < 0 ? '-' : '') + imPart;
    return `${fmt(re)}${sign(im) < 0 ? '-' : '+'}${imPart}`;
  }
  // Plain-text form (always re-parseable by the expression parser)
  function toText(a, mode = displayMode) {
    if (isC(a)) return complexText(a, (x) => toText(x, mode));
    if (isR(a)) {
      if (mode === 'dec' && a.d !== 1n) return fmtFloat(a.toFloat());
      return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
    }
    if (isSurd(a)) {
      if (mode === 'dec') return fmtFloat(a.toFloat());
      const c = a.c;
      const cn = c.n, cd = c.d;
      const sgn = cn < 0n ? '-' : '';
      const an = babs(cn);
      const num = an === 1n ? `sqrt(${a.r})` : `${an}*sqrt(${a.r})`;
      return sgn + (cd === 1n ? num : `${num}/${cd}`);
    }
    return fmtFloat(a);
  }

  function toLatex(a, mode = displayMode) {
    if (isC(a)) {
      const im = a.im, imAbs = abs(im);
      const imPart = isOne(imAbs) ? 'i' : `${toLatex(imAbs, mode)}i`;
      if (a.re.n === 0n) return (sign(im) < 0 ? '-' : '') + imPart;
      return `${toLatex(a.re, mode)} ${sign(im) < 0 ? '-' : '+'} ${imPart}`;
    }
    if (isR(a)) {
      if (mode === 'dec' && a.d !== 1n) return fmtFloat(a.toFloat());
      if (a.d === 1n) return a.n.toString();
      const s = a.n < 0n ? '-' : '';
      return `${s}\\frac{${babs(a.n)}}{${a.d}}`;
    }
    if (isSurd(a)) {
      if (mode === 'dec') return fmtFloat(a.toFloat());
      const cn = a.c.n, cd = a.c.d;
      const s = cn < 0n ? '-' : '';
      const an = babs(cn);
      const root = `\\sqrt{${a.r}}`;
      const num = an === 1n ? root : `${an}${root}`;
      return s + (cd === 1n ? num : `\\frac{${num}}{${cd}}`);
    }
    const t = fmtFloat(a);
    return t.includes('e') ? t.replace(/e(-?\d+)/, '\\times 10^{$1}') : t;
  }

  // Serialize for storage
  function serialize(a) {
    if (isR(a)) return { r: [a.n.toString(), a.d.toString()] };
    if (isSurd(a)) return { s: [a.c.n.toString(), a.c.d.toString(), a.r.toString()] };
    if (isC(a)) return { c: [serialize(a.re), serialize(a.im)] };
    return { f: a };
  }
  function deserialize(o) {
    if (o.r) return new R(BigInt(o.r[0]), BigInt(o.r[1]));
    if (o.s) return new Surd(new R(BigInt(o.s[0]), BigInt(o.s[1])), BigInt(o.s[2]));
    if (o.c) return mkC(deserialize(o.c[0]), deserialize(o.c[1]));
    return o.f;
  }

  function randInt(lo, hi) { return fromInt(lo + Math.floor(Math.random() * (hi - lo + 1))); }

  LA.num = {
    R, Surd, C, isR, isSurd, isC, isNum, mkC, toF, fromInt, fromFloat, parseLiteral,
    add, sub, mul, div, neg, inv, sqrt, pow, powInt, abs, conj, re, im, modulus,
    isZero, isOne, isExact, isInt, sign, eq, cmp,
    toText, toLatex, fmtFloat, setMode, getMode, serialize, deserialize, randInt, bgcd,
  };
})();
