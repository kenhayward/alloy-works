/**
 * Roles are cluster-wide: a login role, and the role every tenant belongs to, are the same rows for
 * every database in the cluster. Two databases prepared at once - which a test run does, and which
 * a deployment provisioning tenants in parallel would - can touch one of those rows at the same
 * moment, and Postgres refuses the second with "tuple concurrently updated". The work is the same
 * whoever does it and safe to repeat, so the answer is to wait a moment and do it again.
 */
const CONFLICT = /tuple concurrently updated|deadlock detected|duplicate key value/i;

export async function retryOnRoleConflict<T>(
  work: () => Promise<T>,
  options: { readonly attempts?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 12;
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts || !CONFLICT.test(message)) throw error;
      // Random, not a fixed step: several databases prepared at once collide on the same rows, and
      // retrying in step with each other is how they keep colliding.
      const ceiling = Math.min(1000, 25 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * ceiling));
    }
  }
}
