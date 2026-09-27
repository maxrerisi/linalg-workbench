# LinAlg Workbench

A lightweight, dependency-free web app for linear algebra students:

- **Matrix editor** with spreadsheet-style entry (Tab/Enter/arrows, Space → next cell, `;` → next row, paste from Excel/MATLAB/NumPy/LaTeX).
- **Calculator** with exact fractions, saved session variables (`A = 3I`, `A^-1`, `<v, A v>`, `eig(A)`, `solve(A, b)`, `elim(A)` for EA = R, …) and step-by-step row reduction.
- **Identity explainer**: type `<v, A w> = <A^T v, w>` and get a rule-by-rule derivation plus a numeric check (with counterexamples for false identities).

Built around Duke's Math 218 (Fitzpatrick): row operations use the class notation (`r2 - 3r1 → r2`),
Gauss–Jordan only swaps when a pivot is 0, EA = R clears a whole column per elementary matrix,
PA = LU shows `[U | L | P]` at each step, eigen output uses χ_A(t) = det(tI − A), am/gm and Null(λI − A),
and digraph incidence matrices match Sage (−1 tail, +1 head, edges sorted).

Also included:
- `about(A)` — matrix "adjectives" (symmetric, triangular, REF/RREF, rank, nonsingular checklist)
- `iseig(A, λ)`, `iseigvec(A, v, λ)`, `innull(A, v)`, `augment(A, B)`, `plot(u, v, …)`
- Matrix–vector products shown as linear combinations of columns
- **Digraphs** tab: edge list → drawing, incidence matrix, net flow Aw, adjacency matrix
- **Practice** tab: random problems with clean answers (rref, systems, inverses, EA = R, PA = LU, null spaces, eigenvalues…) and step-by-step solutions

Plain HTML/CSS/JS — no build step. KaTeX is loaded from a CDN for math rendering.

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Append `?test` to the URL to run the built-in self-test (results in the console).

## Deploy with Coolify

1. Push this repo to GitHub/GitLab (or any Git source Coolify can reach).
2. In Coolify: **New Resource → Application →** pick the repo and branch.
3. Build pack: **Dockerfile** (uses the `Dockerfile` in the repo root).
4. Ports exposes: **80**. Set your domain and deploy.

The container is `nginx:alpine` serving the static files, with gzip and a `/healthz` endpoint used by the Docker health check.

Test the image locally:

```bash
docker build -t linalg-workbench . && docker run --rm -p 8080:80 linalg-workbench
```
