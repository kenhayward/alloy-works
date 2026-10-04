### Changed

- **Versions and the changelog move at a slice or tranche close**, not on every pull request. Each
  pull request records its change in `changes/`.
- **Lint, format, typecheck and build now block a merge in CI.**
- **A baseline is declared at every slice or tranche close**, so the traceability gate covers what
  has shipped, not only 0.13.0.
- **CLAUDE.md and the process docs are shorter**, and plans and reviews scale with risk.
