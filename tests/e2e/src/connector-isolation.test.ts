import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { e2eTargets } from './targets.js';

/**
 * Where the connector can reach, and who can reach it (the D1 plan, D1-I and task 6), asked of the
 * running stack by Docker itself. Each probe is a throwaway `node:24-bookworm-slim` container sharing
 * one compose container's network namespace - so it sees exactly the routes, names and addresses that
 * container sees - since the connector's own image carries no probe. The stack is the compose project
 * ALLOY_E2E_COMPOSE_PROJECT names, which has no default (`targets.ts`), run with `--profile sources`.
 */
const PROJECT = e2eTargets(process.env).composeProject;
const PROBE_IMAGE = 'node:24-bookworm-slim';

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 300_000 }).trim();

interface Inspected {
  readonly Id: string;
  readonly NetworkSettings: {
    readonly Networks: Readonly<Record<string, { readonly IPAddress: string }>>;
    readonly Ports: Readonly<
      Record<string, readonly { HostIp: string; HostPort: string }[] | null>
    >;
  };
}

/** The one running container of a compose service in this project. */
function container(service: string): Inspected {
  const ids = docker(
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${PROJECT}`,
    '--filter',
    `label=com.docker.compose.service=${service}`,
  )
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1) throw new Error(`${PROJECT} runs ${ids.length} ${service} containers`);
  return (JSON.parse(docker('inspect', ids[0]!)) as Inspected[])[0]!;
}

/** A network's IPAM configuration: its subnets, and the gateway each names, if any. */
const ipam = (network: string) =>
  (JSON.parse(docker('network', 'inspect', '--format', '{{json .IPAM.Config}}', network)) as
    { Gateway?: string; Subnet?: string }[] | null) ?? [];

/** The IPv4 addresses containers hold on a network, which the host's bridge therefore does not. */
function held(network: string): Set<string> {
  const containers = JSON.parse(
    docker('network', 'inspect', '--format', '{{json .Containers}}', network),
  ) as Record<string, { IPv4Address: string }> | null;
  return new Set(Object.values(containers ?? {}).map((each) => each.IPv4Address.split('/')[0]!));
}

/**
 * Where a network's bridge would answer for the host: the gateway its configuration names, and the
 * first address of each IPv4 subnet, which is where Docker puts one. An isolated bridge names none and
 * holds neither, which is the point; both are tried whatever it says - but for an address a container
 * holds, which is that container and not the host. Docker gives an isolated network's first address to
 * the first container to join it (Engine 28.0.4 to 29.8.1 alike), the source's when it starts first.
 */
function gateways(network: string): string[] {
  const containers = held(network);
  return ipam(network)
    .flatMap((each) => {
      const first = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/\d+$/.exec(each.Subnet ?? '');
      const firstHost = first
        ? [`${first[1]}.${first[2]}.${first[3]}.${Number(first[4]) + 1}`]
        : [];
      return [...(each.Gateway ? [each.Gateway] : []), ...firstHost];
    })
    .filter((address) => !containers.has(address));
}

/** The engine this runs on, as numbers: `28.0.4` is [28, 0, 4]. */
const engine = () =>
  docker('version', '--format', '{{.Server.Version}}').split(/[.+-]/).slice(0, 3).map(Number);

/**
 * The first Docker Engine that gives an internal bridge no address for the host when asked,
 * `com.docker.network.bridge.gateway_mode_ipv4: isolated` (moby/moby#49262, in 28.0.0). An engine
 * before it refuses the option, so compose cannot make the networks at all.
 */
const MINIMUM_ENGINE = [28, 0, 0] as const;

type Target = { readonly host: string; readonly port: number };
type Outcome = Target & { readonly result: string };

/**
 * Tries each target over TCP from inside `from`'s network namespace, two seconds each, all at once:
 * `connected`, or why not - no name, refused, unreachable, or no answer in time.
 */
function probe(from: Inspected, targets: readonly Target[]): Outcome[] {
  const script = `
    const net = require('node:net');
    const targets = JSON.parse(process.argv[1]);
    const one = ({ host, port }) => new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const done = (result) => { socket.destroy(); resolve({ host, port, result }); };
      socket.setTimeout(2000, () => done('timeout'));
      socket.once('connect', () => done('connected'));
      socket.once('error', (error) => done(error.code ?? 'error'));
    });
    Promise.all(targets.map(one)).then((outcomes) => process.stdout.write(JSON.stringify(outcomes)));
  `;
  const out = docker(
    'run',
    '--rm',
    '--network',
    `container:${from.Id}`,
    PROBE_IMAGE,
    'node',
    '-e',
    script,
    JSON.stringify(targets),
  );
  return JSON.parse(out) as Outcome[];
}

const connected = (outcomes: readonly Outcome[]) =>
  outcomes.filter((each) => each.result === 'connected').map((each) => `${each.host}:${each.port}`);

describe("the connector's networks", () => {
  let connector: Inspected;
  let platform: Record<string, Inspected>;
  /** Each platform container's own listening port, as its compose service runs it. */
  const listening: Record<string, number> = {};
  /**
   * A listener of the test's own, published on every host address - which the stack never does -
   * so the leak the spike found, a port published on all addresses answering a container through the
   * host (Q2), is tried on whatever engine runs this, and its host port.
   */
  const listener = `${PROJECT}-isolation-listener-${process.pid}`;
  let everywhere = 0;

  beforeAll(() => {
    docker('pull', '--quiet', PROBE_IMAGE);
    docker(
      'run',
      '--detach',
      '--rm',
      '--name',
      listener,
      '--publish',
      '8080',
      PROBE_IMAGE,
      'node',
      '-e',
      "require('node:net').createServer((socket) => socket.end()).listen(8080)",
    );
    everywhere = Number(/:(\d+)\s*$/m.exec(docker('port', listener, '8080/tcp'))![1]);
    connector = container('connector');
    platform = Object.fromEntries(
      ['postgres', 'seaweedfs', 'stand-in-idp', 'service', 'worker'].map((service) => [
        service,
        container(service),
      ]),
    );
    listening.postgres = 5432;
    for (const service of ['seaweedfs', 'stand-in-idp', 'service']) {
      // Each is published on the same number it listens on (deploy/README.md).
      const published = Object.values(platform[service]!.NetworkSettings.Ports).flatMap(
        (bindings) => bindings ?? [],
      );
      listening[service] = Number(published[0]!.HostPort);
    }
  }, 300_000);

  afterAll(() => {
    execFileSync('docker', ['rm', '--force', listener], { stdio: 'ignore', timeout: 60_000 });
  });

  it('DAT-056 gives the connector a route to its source and none to the platform: by name, by address or through the host', () => {
    const version = engine();
    const atLeast = (want: readonly number[]) => {
      for (const [at, part] of want.entries()) {
        if ((version[at] ?? 0) !== part) return (version[at] ?? 0) > part;
      }
      return true;
    };
    expect(
      atLeast(MINIMUM_ENGINE),
      `Docker Engine ${version.join('.')} runs this; ${MINIMUM_ENGINE.join('.')} or later gives the connector's networks no address for the host`,
    ).toBe(true);
    // And they name none: the bridge of each holds no address the host answers at.
    for (const network of Object.keys(connector.NetworkSettings.Networks)) {
      expect(
        ipam(network).filter((each) => each.Gateway),
        `${network} names no gateway`,
      ).toEqual([]);
    }

    // Every port the stack publishes to the host, and every address the host might answer at from
    // the connector: each of its networks' gateways, the platform network's, and Docker Desktop's name
    // for the host where it resolves.
    const published = [
      ...new Set(
        Object.values(platform).flatMap((each) =>
          Object.values(each.NetworkSettings.Ports).flatMap((bindings) =>
            (bindings ?? []).map((binding) => Number(binding.HostPort)),
          ),
        ),
      ),
    ];
    expect(published.length).toBeGreaterThan(0);
    const hostAddresses = [
      ...Object.keys(connector.NetworkSettings.Networks).flatMap(gateways),
      ...Object.keys(platform.service!.NetworkSettings.Networks).flatMap(gateways),
      'host.docker.internal',
      // Docker Desktop's own address for the host, which its name stands for; nothing on Linux.
      '192.168.65.254',
    ];
    // The listener is there to be found through the host: from the service, which is on an ordinary
    // network, at least one of these reaches it, so its not answering the connector means something.
    expect(
      connected(
        probe(
          platform.service!,
          hostAddresses.map((host) => ({ host, port: everywhere })),
        ),
      ),
      'the listener answers an ordinary container through the host',
    ).not.toEqual([]);

    // The source's own address on the network it shares with the connector, which may be that
    // network's first address: expected to answer, since it is the source and not the host.
    const sourceAddress =
      container('source-postgres').NetworkSettings.Networks[`${PROJECT}_connector-egress`]
        ?.IPAddress;
    expect(sourceAddress, 'the source is on connector-egress').toBeTruthy();
    const targets: Target[] = [
      // The source, by name and by address.
      { host: 'source-postgres', port: 5432 },
      { host: sourceAddress!, port: 5432 },
      // The platform by its names.
      ...['postgres', 'seaweedfs', 'stand-in-idp', 'service'].map((name) => ({
        host: name,
        port: listening[name]!,
      })),
      // The platform by every address it holds, on its own ports.
      ...Object.values(platform).flatMap((each) =>
        Object.values(each.NetworkSettings.Networks)
          .filter((network) => network.IPAddress !== '')
          .flatMap((network) =>
            Object.values(listening).map((port) => ({ host: network.IPAddress, port })),
          ),
      ),
      // And through the host, on every port the stack publishes, the one published everywhere, and
      // PostgreSQL's own, where a host might run one: CI's stack publishes its database on 5432, the
      // source's port, so a host address a container holds answers there as that container.
      ...hostAddresses.flatMap((host) =>
        [...new Set([...published, everywhere, 5432])].map((port) => ({ host, port })),
      ),
    ];
    const outcomes = probe(connector, targets);
    if (process.env.ALLOY_E2E_SHOW_PROBES) console.info(JSON.stringify(outcomes));
    // The source, and the one peer `connector-private` exists to carry: the service, on its address
    // there and no other. Its API answers only a session or a token, which the connector never holds.
    const privateAddress =
      platform.service!.NetworkSettings.Networks[`${PROJECT}_connector-private`]?.IPAddress;
    expect(privateAddress, 'the service is on connector-private').toBeTruthy();
    expect(connected(outcomes).sort()).toEqual(
      [
        'source-postgres:5432',
        `${sourceAddress}:5432`,
        `service:${listening.service}`,
        `${privateAddress}:${listening.service}`,
      ].sort(),
    );
  }, 120_000);

  it('DAT-089 gives the worker no route to the connector', () => {
    const addresses = Object.values(connector.NetworkSettings.Networks).map(
      (network) => network.IPAddress,
    );
    const outcomes = probe(platform.worker!, [
      { host: 'connector', port: 8090 },
      ...addresses.map((host) => ({ host, port: 8090 })),
    ]);
    expect(connected(outcomes)).toEqual([]);
  }, 120_000);

  it('lets the service reach the connector and never the source', () => {
    const source = container('source-postgres');
    const outcomes = probe(platform.service!, [
      { host: 'connector', port: 8090 },
      { host: 'source-postgres', port: 5432 },
      ...Object.values(source.NetworkSettings.Networks).map((network) => ({
        host: network.IPAddress,
        port: 5432,
      })),
    ]);
    expect(connected(outcomes)).toEqual(['connector:8090']);
  }, 120_000);
});
