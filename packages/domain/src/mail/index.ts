import { z } from 'zod';

/**
 * A mail channel's settings (mail.md; the EM plan). Each refuses a line break before anything reaches
 * a library: a break in a recipient changed who it went to in the spike (EM-J).
 */
const noControl = (value: string) => !/\p{Cc}/u.test(value);

/** A host name or address, with no scheme, path or port. */
export const mailHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.:[\]-]+$/);

/** The two ports that are TLS: 465 at once, 587 by STARTTLS, required (EM-J). */
export const mailPortSchema = z.union([z.literal(465), z.literal(587)]);

export const mailAddressSchema = z.email().max(254);

export const mailDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(noControl, 'must hold no control characters');

export const mailUsernameSchema = z
  .string()
  .min(1)
  .max(254)
  .refine(noControl, 'must hold no control characters');

export const mailPasswordSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(noControl, 'must hold no control characters');

/** Whose relay a tenant's mail leaves by (EM-B). */
export const mailRelaySchema = z.enum(['platform', 'own']);
export type MailRelay = z.infer<typeof mailRelaySchema>;

/**
 * What a password is sealed to: its host, port and username, so it opens for no other relay, and an
 * administrator cannot repoint the host at their own server and read it through AUTH (EM-I).
 */
export function mailCredentialContext(host: string, port: number, username: string): string {
  return JSON.stringify([host, port, username]);
}

export const mailSealRequestSchema = z.strictObject({
  tenant: z.string().min(1),
  host: mailHostSchema,
  port: mailPortSchema,
  username: mailUsernameSchema,
  password: mailPasswordSchema,
});
export type MailSealRequest = z.infer<typeof mailSealRequestSchema>;
