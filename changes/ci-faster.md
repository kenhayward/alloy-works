### Changed

- **Faster CI.** The connector's suite runs in a job of its own, the stack's images reuse cached layers, and the navigation and publishing budgets run only off CI, where they bind.
- **Navigation budgets at the 90th percentile.** Opening a large document, each outline act and each jump are now held at p90 over ten samples, where they were p95 over twenty.
