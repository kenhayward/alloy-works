import { bootstrapTestLoginRoles } from '@alloy-works/db/testing';

/**
 * The worker suite's other global setup: the login roles, once for the run. Roles are cluster-wide,
 * so each file then prepares only its own database (`prepareDatabase`), and the files can run side by
 * side without two of them writing one role.
 */
export default async function setup(): Promise<void> {
  await bootstrapTestLoginRoles();
}
