// Practice problem generator. Problems are built backwards from nice answers
// (integer inverses, integer eigenvalues, integer L and U …) so hand computation stays clean.
(function () {
  const LA = window.LA;
  const N = LA.num;
  const M = LA.mat;
  const { R } = N;

  const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const rnz = (lo, hi) => { let x; do { x = ri(lo, hi); } while (x === 0); return x; };
  const I = (k) => N.fromInt(k);
  const mat = (rows) => new LA.Matrix(rows.map((r) => r.map(I)));
  const randMat = (m, n, lo = -4, hi = 4) => mat(Array.from({ length: m }, () => Array.from({ length: n }, () => ri(lo, hi))));
  const maxAbs = (A) => Math.max(...A.a.flat().map((x) => Math.abs(N.toF(x))));

  // Product of random integer elementary matrices: det = ±1, so the inverse is an integer matrix too.
  function unimodular(n, ops = n * 2 + 1, bound = 9) {
    for (let tries = 0; tries < 50; tries++) {
      let A = M.identity(n);
      for (let k = 0; k < ops; k++) {
        const i = ri(0, n - 1);
        let j = ri(0, n - 1);
        if (i === j) j = (j + 1) % n;
        const E = M.identity(n).a.map((r) => r.slice());
        E[i][j] = I(rnz(-2, 2));
        A = M.mul(new LA.Matrix(E), A);
      }
      if (Math.random() < 0.3) { const p = ri(0, n - 2); A = new LA.Matrix(A.a.map((r, i) => (i === p ? A.a[p + 1] : i === p + 1 ? A.a[p] : r))); }
      if (maxAbs(A) <= bound && maxAbs(M.inverse(A)) <= bound * 2) return A;
    }
    return M.identity(n);
  }
  // Random m×n matrix of the given rank with small integer entries
  function ofRank(m, n, r) {
    for (let t = 0; t < 50; t++) {
      const A = M.mul(randMat(m, r, -2, 2), randMat(r, n, -2, 2));
      if (M.rank(A) === r && maxAbs(A) <= 9) return A;
    }
    return M.mul(randMat(m, r, -1, 1), randMat(r, n, -1, 1));
  }

  const TYPES = {
    rref: {
      label: 'Row reduce to rref',
      make() {
        const m = ri(3, 4), n = ri(3, 5);
        const A = ofRank(m, n, ri(2, Math.min(m, n)));
        return { vars: { A }, prompt: `\\text{Find } \\operatorname{rref}(A) \\text{ for } A = ${M.latex(A)}`, solve: 'rref(A)', extra: ['about(A)'] };
      },
    },
    system: {
      label: 'Solve a linear system',
      make() {
        const n = ri(3, 4), m = 3;
        const A = ofRank(m, n, ri(2, 3));
        let b;
        const consistent = Math.random() < 0.8;
        if (consistent) b = M.mul(A, randMat(n, 1, -2, 2));
        else b = randMat(m, 1, -5, 5);
        const vars = Array.from({ length: n }, (_, j) => `x_{${j + 1}}`);
        const eqs = A.a.map((row, i) => {
          let s = '';
          row.forEach((c, j) => {
            if (N.isZero(c)) return;
            const neg = N.sign(c) < 0, a = N.abs(c);
            const t = (N.isOne(a) ? '' : N.toLatex(a)) + vars[j];
            s += s ? (neg ? ' - ' : ' + ') + t : (neg ? '-' : '') + t;
          });
          return `${s || '0'} &= ${N.toLatex(b.a[i][0])}`;
        });
        return {
          vars: { A, b },
          prompt: `\\text{Solve the system (or show it is inconsistent):}\\quad\\begin{aligned}${eqs.join('\\\\')}\\end{aligned}`,
          solve: 'solve(A, b)',
          extra: ['rref([A b])'],
        };
      },
    },
    product: {
      label: 'Matrix product',
      make() {
        const m = ri(2, 3), k = ri(2, 4), n = ri(1, 3);
        const A = randMat(m, k, -3, 3), B = randMat(k, n, -3, 3);
        return { vars: { A, B }, prompt: `\\text{Compute } AB \\text{ for } A = ${M.latex(A)},\\ B = ${M.latex(B)}`, solve: 'A B' };
      },
    },
    inverse: {
      label: 'Invert a matrix',
      make() {
        const n = ri(2, 3);
        const A = unimodular(n);
        return { vars: { A }, prompt: `\\text{Find } A^{-1} \\text{ by row reducing } [A \\mid I] \\text{, where } A = ${M.latex(A)}`, solve: 'inv(A)' };
      },
    },
    ear: {
      label: 'EA = R factorization',
      make() {
        const [m, n] = [[2, 3], [3, 2], [3, 3], [2, 2]][ri(0, 3)];
        const A = Math.random() < 0.5 && m === n ? unimodular(m, 3, 6) : ofRank(m, n, Math.min(m, n, ri(1, 2) + 1));
        return { vars: { A }, prompt: `\\text{Find an } EA = R \\text{ factorization of } A = ${M.latex(A)}`, solve: 'elim(A)', extra: ['rref(A)'] };
      },
    },
    palu: {
      label: 'PA = LU factorization',
      make() {
        const n = 3;
        const L = mat([[1, 0, 0], [ri(-3, 3), 1, 0], [ri(-3, 3), ri(-3, 3), 1]]);
        const U = mat([[rnz(-3, 3), ri(-4, 4), ri(-4, 4)], [0, rnz(-3, 3), ri(-4, 4)], [0, 0, ri(-3, 3)]]);
        let A = M.mul(L, U);
        if (Math.random() < 0.5) {
          // force a swap: make the (2,2) pivot vanish after the first step, or swap the first rows
          A = new LA.Matrix([A.a[1], A.a[0], A.a[2]]);
          if (N.isZero(A.a[0][0])) A = M.mul(L, U);
        }
        return { vars: { A }, prompt: `\\text{Find a } PA = LU \\text{ factorization of } A = ${M.latex(A)}`, solve: 'lu(A)' };
      },
    },
    nullspace: {
      label: 'Null space basis',
      make() {
        const m = 3, n = ri(4, 5);
        const A = ofRank(m, n, ri(2, 3));
        return { vars: { A }, prompt: `\\text{Find a basis of } \\operatorname{Null}(A) \\text{ for } A = ${M.latex(A)}`, solve: 'null(A)', extra: ['rref(A)'] };
      },
    },
    eigen: {
      label: 'Eigenvalues & eigenspaces',
      make() {
        const n = ri(2, 3);
        const P = unimodular(n, n + 1, 4);
        const vals = Array.from({ length: n }, () => ri(-4, 5));
        if (n === 3 && Math.random() < 0.35) vals[2] = vals[1];
        const A = M.mul(P, M.mul(M.diag(vals.map(I)), M.inverse(P)));
        return { vars: { A }, prompt: `\\text{Find } \\chi_A(t)\\text{, the eigenvalues, and a basis of each eigenspace for } A = ${M.latex(A)}`, solve: 'eig(A)' };
      },
    },
    nonsingular: {
      label: 'Nonsingular or singular?',
      make() {
        const n = 3;
        const A = Math.random() < 0.5 ? unimodular(n, 4, 7) : ofRank(n, n, 2);
        return { vars: { A }, prompt: `\\text{Is } A = ${M.latex(A)} \\text{ nonsingular? Justify with rref or rank.}`, solve: 'about(A)', extra: ['rref(A)'] };
      },
    },
  };

  function generate(type) {
    const keys = Object.keys(TYPES);
    const k = type === 'mix' || !TYPES[type] ? keys[ri(0, keys.length - 1)] : type;
    return { type: k, label: TYPES[k].label, ...TYPES[k].make() };
  }

  LA.practice = { TYPES, generate };
})();
