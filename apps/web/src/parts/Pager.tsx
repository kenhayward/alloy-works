import { Icon } from '../editor/Icon.js';
import { IconButton } from './IconButton.js';
import styles from './parts.module.css';

/** How many a page shows (ADR-0050, decision 8). */
export const PAGE_SIZE = 10;

/** The page of `items` the pager is at. */
export function pageOf<T>(items: readonly T[], page: number): readonly T[] {
  return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

/**
 * Where a reader is in a list ten to a page, "11 to 20 of 148", and Previous and Next a page at a
 * time, which stay reachable at either end and do nothing there. One page offers no paging.
 */
export function Pager({
  label,
  total,
  page,
  onPage,
}: {
  label: string;
  total: number;
  /** From 0. */
  page: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  const step = (to: number) => {
    if (to >= 0 && to < pages) onPage(to);
  };
  return (
    <nav aria-label={label} className={styles['pager']}>
      <span className={styles['pagerRange']}>{`${first} to ${last} of ${total}`}</span>
      {pages > 1 && (
        <>
          <IconButton
            label="Previous page"
            className={styles['pagerButton']}
            aria-disabled={page === 0}
            onClick={() => step(page - 1)}
          >
            <Icon name="Previous page" />
          </IconButton>
          <span>{`Page ${page + 1} of ${pages}`}</span>
          <IconButton
            label="Next page"
            className={styles['pagerButton']}
            aria-disabled={page === pages - 1}
            onClick={() => step(page + 1)}
          >
            <Icon name="Next page" />
          </IconButton>
        </>
      )}
    </nav>
  );
}
