// Directed graphs: parse an edge list, draw it, and build its incidence / adjacency matrices.
// Incidence convention matches Sage's DiGraph.incidence_matrix(): rows = vertices, columns = edges,
// −1 where the edge leaves a vertex (tail) and +1 where it enters (head).
(function () {
  const LA = window.LA;
  const N = LA.num;
  const { R } = N;

  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  // sortEdges: number edges the way Sage does (sorted by tail, then head, in vertex order)
  function parse(edgeText, vertexText = '', sortEdges = true) {
    let edges = [];
    const parts = edgeText.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const m = /^\(?\s*([\w']+)\s*(?:->|→|=>|>|-|\s)\s*([\w']+)\s*\)?$/.exec(p);
      if (!m) throw new LA.MathError(`Couldn't read the edge "${p}". Write edges like 1->2 or v1 > v3.`);
      edges.push([m[1], m[2]]);
    }
    let vertices = vertexText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const seen = new Set(vertices);
    const extra = [];
    for (const [u, v] of edges) for (const x of [u, v]) if (!seen.has(x)) { seen.add(x); extra.push(x); }
    vertices = vertices.concat(extra.sort(natural));
    if (sortEdges) {
      const idx = new Map(vertices.map((v, i) => [v, i]));
      edges = edges.map((e, k) => [...e, k]).sort((a, b) => idx.get(a[0]) - idx.get(b[0]) || idx.get(a[1]) - idx.get(b[1]) || a[2] - b[2]).map(([u, v]) => [u, v]);
    }
    return { vertices, edges };
  }

  function incidence({ vertices, edges }) {
    const idx = new Map(vertices.map((v, i) => [v, i]));
    const rows = vertices.map(() => edges.map(() => R.ZERO));
    edges.forEach(([u, v], e) => {
      if (u === v) return; // a loop contributes nothing to net flow
      rows[idx.get(u)][e] = N.fromInt(-1);
      rows[idx.get(v)][e] = N.fromInt(1);
    });
    return new LA.Matrix(rows);
  }
  function adjacency({ vertices, edges }) {
    const idx = new Map(vertices.map((v, i) => [v, i]));
    const rows = vertices.map(() => vertices.map(() => 0));
    for (const [u, v] of edges) rows[idx.get(u)][idx.get(v)]++;
    return new LA.Matrix(rows.map((r) => r.map((k) => N.fromInt(k))));
  }

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function svg({ vertices, edges }, weights) {
    const n = vertices.length;
    const W = 360, H = 300, rad = n <= 1 ? 0 : Math.min(118, 80 + n * 7);
    const cx = W / 2, cy = H / 2 + (n === 3 ? rad * 0.22 : 0); // a triangle sits visually lower
    const pos = vertices.map((_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    });
    const idx = new Map(vertices.map((v, i) => [v, i]));
    const pairCount = new Map();
    const VR = 17;
    let out = '';
    edges.forEach(([u, v], e) => {
      const a = idx.get(u), b = idx.get(v);
      const label = `e${e + 1}` + (weights && weights[e] !== undefined ? ` (${weights[e]})` : '');
      if (a === b) {
        const [x, y] = pos[a];
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
        const ox = x + (dx / d) * 30, oy = y + (dy / d) * 30;
        out += `<circle cx="${ox}" cy="${oy}" r="14" fill="none" stroke="var(--muted)" stroke-width="1.6"/>`;
        out += `<text x="${ox + (dx / d) * 24}" y="${oy + (dy / d) * 24 + 4}" class="dg-elabel" text-anchor="middle">${esc(label)}</text>`;
        return;
      }
      // Edges between the same pair (either direction) fan out symmetrically around the straight line
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const k = pairCount.get(key) || 0;
      pairCount.set(key, k + 1);
      const total = edges.filter(([p, q]) => (idx.get(p) === a && idx.get(q) === b) || (idx.get(p) === b && idx.get(q) === a)).length;
      const [x1, y1] = pos[a], [x2, y2] = pos[b];
      const lo = pos[Math.min(a, b)], hi = pos[Math.max(a, b)];
      const ddx = hi[0] - lo[0], ddy = hi[1] - lo[1], d = Math.hypot(ddx, ddy);
      const nx = -ddy / d, ny = ddx / d;
      const bend = (k - (total - 1) / 2) * 44;
      const mx = (x1 + x2) / 2 + nx * bend, my = (y1 + y2) / 2 + ny * bend;
      // shorten ends to the circle boundary
      const s = (px, py, qx, qy) => { const L = Math.hypot(qx - px, qy - py); return [px + ((qx - px) / L) * VR, py + ((qy - py) / L) * VR]; };
      const [sx, sy] = s(x1, y1, mx, my), [ex, ey] = s(x2, y2, mx, my);
      out += `<path d="M${sx},${sy} Q${mx},${my} ${ex},${ey}" fill="none" stroke="var(--muted)" stroke-width="1.6" marker-end="url(#dgArrow)"/>`;
      const lx = 0.25 * sx + 0.5 * mx + 0.25 * ex, ly = 0.25 * sy + 0.5 * my + 0.25 * ey;
      out += `<text x="${lx + nx * 10 * Math.sign(bend || 1)}" y="${ly + ny * 10 * Math.sign(bend || 1) + 4}" class="dg-elabel" text-anchor="middle">${esc(label)}</text>`;
    });
    vertices.forEach((v, i) => {
      const [x, y] = pos[i];
      out += `<circle cx="${x}" cy="${y}" r="${VR}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.8"/>`;
      out += `<text x="${x}" y="${y + 4.5}" class="dg-vlabel" text-anchor="middle">${esc(v)}</text>`;
    });
    return `<svg class="dg-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Digraph drawing"><defs><marker id="dgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"/></marker></defs>${out}</svg>`;
  }

  LA.digraph = { parse, incidence, adjacency, svg };
})();
