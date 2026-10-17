### Added

- **Query limits and cost.** No more of an environment's query runs are in flight at once than its limit, four unless an administrator lowers it; one past it waits a moment, then fails as throttled and can be tried again, never with a partial result. Every run is recorded with what it cost, and through the API an administrator reads the totals by query and by document, or every run as CSV.
