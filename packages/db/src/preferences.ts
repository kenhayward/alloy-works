import { INTERFACE_LANGUAGES, type InterfaceLanguage } from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * **A person's interface language** (the UI plan, UI-E; LOC-005): one of the declared languages, or
 * null for their browser's. Read through the row as JSON, so a tenant before 0166 reads null.
 */
export async function interfaceLanguageOf(
  trx: TenantTransaction,
  principal: string,
): Promise<InterfaceLanguage | null> {
  const { rows } = await sql<{ language: string | null }>`
    select to_jsonb(p) ->> 'interface_language' as language from principal p
     where p.id = ${principal}::uuid`.execute(trx);
  const language = rows[0]?.language ?? null;
  return (INTERFACE_LANGUAGES as readonly string[]).includes(language ?? '')
    ? (language as InterfaceLanguage)
    : null;
}

/** Sets it; the caller checked it is a declared language or null. */
export async function setInterfaceLanguage(
  trx: TenantTransaction,
  principal: string,
  language: InterfaceLanguage | null,
): Promise<void> {
  await trx
    .updateTable('principal')
    .set({ interface_language: language })
    .where('id', '=', principal)
    .execute();
}
