import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The internet-facing stack is development's compose file with every door shut by an overlay, so what
 * development later adds to compose.yaml is exactly what this has to notice.
 */
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../deploy/${path}`, import.meta.url)), 'utf8');

const base = read('compose.yaml');
const overlay = read('compose.internet.yaml');
const caddy = read('internet/Caddyfile');
const realm = read('internet/alloy-realm.json');
const configure = read('internet/configure.sh');
const deploy = read('internet/deploy.sh');
const example = read('internet/internet.env.example');

/** A service's block in a compose file: its own lines, up to the next service or top-level key. */
function serviceBlocks(file: string): Map<string, string> {
  const services = file.slice(file.indexOf('\nservices:'));
  const end = services.slice(1).search(/\n[a-z]/);
  const body = end === -1 ? services : services.slice(0, end + 1);
  const blocks = new Map<string, string>();
  for (const part of body.split(/\n(?=  [a-z-]+:\n)/).slice(1)) {
    blocks.set(/^ {2}([a-z-]+):/.exec(part)![1]!, part);
  }
  return blocks;
}

const baseServices = serviceBlocks(base);
const services = serviceBlocks(overlay);

describe('the internet stack', () => {
  it('finds the services it is reading', () => {
    expect(baseServices.size).toBeGreaterThan(8);
    expect(services.has('public-proxy')).toBe(true);
    expect(services.has('service')).toBe(true);
  });

  it('takes back every port development publishes', () => {
    for (const [name, block] of baseServices) {
      if (/\n {6}profiles:|\n {4}profiles:/.test(block) || !/\n {4}ports:/.test(block)) continue;
      if (name === 'stand-in-idp') {
        expect(services.get(name)).toMatch(/scale: 0/);
      } else {
        expect(services.get(name), name).toMatch(/\n {4}ports: !reset \[\]/);
      }
    }
  });

  it('publishes port 443 of the proxy, and on the machine alone the console of Keycloak', () => {
    const published = [...services]
      .filter(([, block]) => /\n {4}ports:\n/.test(block))
      .map(([name, block]) => [name, [...block.matchAll(/^ {6}- '(.+)'$/gm)].map((m) => m[1])]);
    expect(published).toEqual([
      ['public-proxy', ['443:443']],
      ['keycloak', ['127.0.0.1:${KEYCLOAK_CONSOLE_PORT:-9090}:9090']],
    ]);
  });

  it('holds no value development publishes, in any file it ships', () => {
    const published = new Set(
      [
        ...base.matchAll(
          /(?:PASSWORD|SECRET[A-Z_]*|[A-Z_]*_KEY|AWS_SECRET_ACCESS_KEY):\s+(\S{8,})/g,
        ),
      ]
        .map((match) => match[1]!)
        .filter((value) => !value.startsWith('$') && value !== 'postgres'),
    );
    for (const value of [
      'aw_service_dev',
      'aw_worker_dev',
      'aw_migrator_dev',
      'aw_restorer_dev',
      'aw_steward_dev',
      'stand-in-dev-secret',
      'keycloak-dev-admin',
      'postgres:postgres',
    ]) {
      published.add(value);
    }
    expect(published.size).toBeGreaterThan(10);
    for (const file of [overlay, caddy, realm, configure, example]) {
      for (const value of published) expect(file).not.toContain(value);
    }
  });

  it('replaces each secret a running process holds in development', () => {
    const names = [
      ...new Set(
        [...base.matchAll(/^ {6}((?:SECRET|CONNECTOR)_[A-Z_]*KEY|SECRET_[A-Z_]+):/gm)].map(
          (match) => match[1]!,
        ),
      ),
    ].filter((name) => name !== 'SECRET_GOOGLE');
    expect(names.length).toBeGreaterThan(8);
    for (const name of names) expect(overlay, name).toMatch(new RegExp(`^ {6}${name}: `, 'm'));
  });

  it('asks the setting for every secret, with no default and no way past it', () => {
    for (const match of overlay.matchAll(
      /\$\{([A-Z_]*(?:PASSWORD|SECRET|_KEY)[A-Z_]*)([^}]*)\}/g,
    )) {
      expect(match[2], match[1]).toBe(':?');
      expect(example, match[1]).toMatch(new RegExp(`^${match[1]}=`, 'm'));
    }
  });

  it('never turns the sign-in guard off, and offers no stand-in and no Google', () => {
    expect(overlay).toMatch(/ALLOW_INSECURE_ISSUERS: 'false'/);
    expect(services.get('stand-in-idp')).toMatch(/scale: 0/);
    expect(services.get('service')).toMatch(/GOOGLE_CLIENT_ID: !reset null/);
    expect(services.get('service')).toMatch(/SIGN_IN_HOST: !reset null/);
    expect(services.get('setup')).toMatch(/environment:setup/);
    expect(overlay).not.toMatch(/dev:setup/);
  });

  it('gives the connector no development certificate authority', () => {
    expect(services.get('connector')).toMatch(/CONNECTOR_CA_FILE: !reset null/);
    expect(services.get('connector')).toMatch(/volumes: !reset \[\]/);
  });

  it('holds every long-running container to a memory limit and no new privileges', () => {
    for (const [name, block] of services) {
      if (/scale: 0|restart: 'no'/.test(block + (baseServices.get(name) ?? ''))) continue;
      expect(block, name).toMatch(/\n {4}mem_limit: /);
      expect(block, name).toMatch(/no-new-privileges:true/);
    }
  });

  it('keeps administration off the internet at the door', () => {
    expect(caddy).toMatch(
      /@administration path \/admin \/admin\/\* \/realms\/master \/realms\/master\/\*/,
    );
    expect(caddy).toMatch(/respond @administration 404/);
    expect(caddy).toMatch(/admin off/);
  });

  it('answers on the store for objects in the bucket and nothing else', () => {
    expect(caddy).toMatch(/@elsewhere not path \/\{\$OBJECT_STORE_BUCKET\}\/\*/);
    expect(caddy).toMatch(/respond @elsewhere 404/);
  });

  it('believes only the proxy, and decides what the service is told', () => {
    expect(caddy).toMatch(/trusted_proxies static \{\$PROXY_ADDRESS\}/);
    expect(caddy).toMatch(/trusted_proxies_strict/);
    expect(caddy).toMatch(/header_up X-Forwarded-Host \{host\}/);
    expect(caddy).toMatch(/header_up X-Forwarded-For \{client_ip\}/);
    expect(services.get('service')).toMatch(/TRUST_PROXY: 10\.213\.72\.2/);
    expect(services.get('keycloak')).toMatch(/--proxy-trusted-addresses=10\.213\.72\.2/);
    expect(services.get('public-proxy')).toMatch(/ipv4_address: 10\.213\.72\.2/);
  });

  it('holds no address of any machine, since this repository is public', () => {
    for (const file of [overlay, caddy, realm, configure, deploy, example]) {
      expect(file).not.toMatch(/\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+/);
    }
  });

  it('asks Keycloak for production mode, mail and two factors for the first administrator', () => {
    expect(services.get('keycloak')).toMatch(/- start\n/);
    expect(services.get('keycloak')).not.toMatch(/start-dev|dev-file/);
    expect(JSON.parse(realm)).toMatchObject({
      registrationAllowed: false,
      resetPasswordAllowed: true,
      bruteForceProtected: true,
    });
    expect(JSON.parse(realm)).not.toHaveProperty('users');
    expect(realm).not.toMatch(/"secret"/);
    expect(configure).toMatch(/CONFIGURE_TOTP/);
    expect(configure).toMatch(/smtpServer/);
    expect(configure).not.toMatch(/ssoSessionMaxLifespan=15/);
  });

  it('never removes a volume when it deploys', () => {
    expect(deploy).not.toMatch(/down\s+[^\n]*-v|--volumes|volume\s+(rm|prune)|system\s+prune/);
    expect(deploy).toMatch(/set -euo pipefail/);
  });
});
