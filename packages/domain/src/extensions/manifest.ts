import { z } from 'zod';

import { canonicalJson } from '../stored/canonical.js';

/**
 * An extension's manifest (extensions.md; the EX plan, EX-A; ADR-0066): what a remote service says
 * it is, what a connection to it takes, what it can do and where it sends a tenant's data. Parsed
 * strictly: a member it does not know is refused, so nothing it declares is read past.
 */

/** The most a manifest may be, as fetched. */
export const MANIFEST_MOST_BYTES = 64 * 1024;

const text = (most: number) => z.string().trim().min(1).max(most);
const settingKey = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/);

/** An HTTPS URL with a host and nothing a credential could hide in. */
export const httpsUrl = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.hostname !== '' &&
        url.username === '' &&
        url.password === '' &&
        url.search === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  }, 'An https URL, with no user, password, query or fragment')
  .meta({ examples: ['https://gauges.example.test/alloy'] });

export const extensionSettingSchema = z.strictObject({
  key: settingKey,
  label: text(80),
  type: z.enum(['text', 'number', 'boolean']),
  required: z.boolean(),
});
export type ExtensionSetting = z.infer<typeof extensionSettingSchema>;

export const extensionCapabilitiesSchema = z.strictObject({
  parameters: z.boolean(),
  keyColumns: z.boolean(),
  rowLimit: z.boolean(),
});
export type ExtensionCapabilities = z.infer<typeof extensionCapabilitiesSchema>;

export const extensionManifestSchema = z.strictObject({
  manifest: z.literal(1),
  name: text(80),
  version: z
    .string()
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/)
    .meta({ examples: ['1.2.0'] }),
  publisher: text(80),
  description: text(500),
  kind: z.literal('source'),
  endpoint: httpsUrl,
  settings: z
    .array(extensionSettingSchema)
    .max(20)
    .refine((fields) => new Set(fields.map((each) => each.key)).size === fields.length, {
      message: 'Each setting once',
    }),
  authentication: z.union([z.literal('none'), z.strictObject({ label: text(80) })]),
  capabilities: extensionCapabilitiesSchema,
  outbound: z
    .array(z.strictObject({ host: z.string().regex(/^[a-z0-9.-]{1,253}$/), purpose: text(200) }))
    .max(20),
});
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

/**
 * A manifest read, or why not: the paths that failed and never their values, which are whatever the
 * named host answered (the EX pre-flight review).
 */
export function readManifest(
  value: unknown,
):
  | { readonly ok: true; readonly manifest: ExtensionManifest }
  | { readonly ok: false; readonly paths: readonly string[] } {
  const parsed = extensionManifestSchema.safeParse(value);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  // An unknown member is named by where it stands, never by its own key.
  const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(top)');
  return { ok: false, paths: [...new Set(paths)].slice(0, 20) };
}

/** What a manifest is pinned by: SHA-256 of its canonical JSON, as hex. Pure; the digest is the caller's. */
export const manifestDigestInput = (manifest: ExtensionManifest): string => canonicalJson(manifest);

const tenant = z.string().regex(/^[0-9a-z]{1,40}$/);

/** The connector asked to fetch a manifest (EX-B): one `GET`, the guard's, 64 KiB, no redirect. */
export const manifestRequestSchema = z.strictObject({
  requestId: z.uuid(),
  tenant,
  url: httpsUrl,
});
export type ManifestRequest = z.infer<typeof manifestRequestSchema>;

export const manifestAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fetched'), body: z.string().max(MANIFEST_MOST_BYTES) }),
  z.strictObject({
    type: z.literal('failed'),
    code: z.enum([
      'host_refused',
      'connection_failed',
      'timeout',
      'manifest_refused',
      'manifest_too_large',
      'connector_error',
    ]),
  }),
]);
export type ManifestAnswer = z.infer<typeof manifestAnswerSchema>;

/** The line the supervisor writes to a manifest fetch's child: no secret, the guard's ranges. */
export const childManifestRequestSchema = z.strictObject({
  kind: z.literal('manifest'),
  request: manifestRequestSchema,
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
});
export type ChildManifestRequest = z.infer<typeof childManifestRequestSchema>;
