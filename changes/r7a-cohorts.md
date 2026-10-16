### Added

- **Bulk generation, through the API.** Make many documents from one template, one for each row of parameters given inline or taken from a query result, as a job. Every row is made from the template as it stood when asked for, reported made or failed, and a failed row leaves nothing. The cohort is found again by its id, and its failed rows can be run again, corrected, without touching the rest.
