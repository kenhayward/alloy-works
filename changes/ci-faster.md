### Changed

- **Faster CI.** The connector's suite and the navigation budgets run in jobs of their own, and the stack's images reuse cached layers.
- **Navigation budgets at the 90th percentile.** Opening a large document, each outline act and each jump are now held at p90 over ten samples, where they were p95 over twenty.
