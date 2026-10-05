### Changed

- **Faster CI.** The connector's suite and the navigation budgets run in jobs of their own, and the stack's images reuse cached layers.
- **The interface's navigation budget at the 90th percentile.** Opening a large document and each outline act is now held to 250 ms at p90 over ten samples, where it was p95 over twenty.
