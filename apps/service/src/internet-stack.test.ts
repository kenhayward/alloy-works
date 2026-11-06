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
const backup = read('internet/backup.sh');
const drill = read('internet/restore-drill.sh');
const alert = read('internet/alert.sh');
const unit = (name: string): string => read(`internet/${name}`);

/** A service's block in a compose file: its own lines, up to the next service or top-level key. */
function serviceBlocks(file: string): Map<string, string> {
  const services = file.slice(file.indexOf('\nservices:'));
  const end = services.slice(1).search(/\n[a-z]/);
  const body = end === -1 ? services : services.slice(0, end + 1);
  const blocks = new Map<string, string>();
  for (const part of body.split(/\n(?= {2}[a-z-]+:\n)/).slice(1)) {
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

  it('has the store answer on the network the door reaches it by', () => {
    expect(services.get('seaweedfs')).toMatch(/'-s3\.ip\.bind=0\.0\.0\.0'/);
    expect(services.get('seaweedfs')).toMatch(/edge: \{\}/);
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
    for (const file of [overlay, caddy, realm, configure, deploy, example, backup, drill, alert]) {
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

  it('never removes a volume when it deploys, backs up or drills a restore', () => {
    for (const script of [deploy, backup, drill]) {
      expect(script).not.toMatch(/down\s+[^\n]*-v|--volumes|volume\s+(rm|prune)|system\s+prune/);
      expect(script).toMatch(/set -euo pipefail/);
    }
  });

  it('keeps every container to a few rotated log files', () => {
    expect(overlay).toMatch(
      /^x-logs: &logs\n {2}driver: json-file\n {2}options:\n {4}max-size: '\d+m'\n {4}max-file: '\d+'$/m,
    );
    for (const [name, block] of services) {
      if (/scale: 0/.test(block)) continue;
      expect(block, name).toMatch(/\n {4}logging: \*logs/);
    }
    for (const [name, block] of baseServices) {
      if (block.includes(String.fromCharCode(10) + '    profiles:')) continue;
      expect(services.has(name), name).toBe(true);
    }
  });

  it('backs up all four stores, encrypted, and keeps a week, a month and half a year', () => {
    for (const store of ['postgres', 'delivered-postgres', 'keycloak-postgres']) {
      expect(backup, store).toMatch(new RegExp(`dump ${store} [a-z]+$`, 'm'));
    }
    expect(backup).toMatch(/pg_dumpall/);
    expect(backup).toMatch(/seaweedfs/);
    expect(backup).toMatch(/restic backup/);
    expect(backup).toMatch(
      /restic forget[^\n]*--keep-daily 7[^\n]*--keep-weekly 4[^\n]*--keep-monthly 6/,
    );
    expect(example).toMatch(/^RESTIC_REPOSITORY=CHANGE_ME$/m);
    expect(example).toMatch(/^RESTIC_PASSWORD=GENERATE$/m);
  });

  it('drills a restore into containers of its own, with no network and no volume of the stack', () => {
    expect(drill).toMatch(/restic restore/);
    expect(drill).toMatch(/--network none/);
    expect(drill).toMatch(/--rm/);
    expect(drill).not.toMatch(/compose[^\n]* up|-v [a-z-]*-data:/);
  });

  it('mails the operator when a deploy or a backup fails, never putting the password on a command line', () => {
    for (const name of ['alloy-deploy.service', 'alloy-backup.service']) {
      expect(unit(name), name).toMatch(/^OnFailure=alloy-alert@%n\.service$/m);
    }
    expect(unit('alloy-alert@.service')).toMatch(/alert\.sh %i/);
    expect(unit('alloy-backup.timer')).toMatch(/OnCalendar=/);
    expect(alert).toMatch(/--ssl-reqd/);
    expect(alert).toMatch(/-K -/);
    expect(alert).not.toMatch(/--user\s+"?\$/);
    expect(example).toMatch(/^ALERT_EMAIL=CHANGE_ME$/m);
  });

  it('lets one machine read the backups and nothing else, as a user who is not root', () => {
    const rsyncd = read('internet/rsyncd.conf');
    expect(rsyncd).toMatch(/^\s*read only = yes$/m);
    expect(rsyncd).toMatch(/^\s*write only = no$/m);
    expect(rsyncd).toMatch(/^\s*list = no$/m);
    expect(rsyncd).toMatch(/^\s*hosts allow = NAS_ADDRESS$/m);
    expect(rsyncd).toMatch(/^\s*hosts deny = \*$/m);
    expect(rsyncd).toMatch(/^\s*auth users = nas-pull$/m);
    expect(rsyncd).toMatch(/^\s*strict modes = yes$/m);
    expect(rsyncd).toMatch(/^\s*uid = nas-pull$/m);
    expect(rsyncd).not.toMatch(/\b192\.168\.\d+\.\d+/);
    // restic keeps a repository's files group-readable only if the backup's umask lets it.
    expect(backup).toMatch(/umask 027\n[^\n]*\n?restic cat config/);
  });
});
