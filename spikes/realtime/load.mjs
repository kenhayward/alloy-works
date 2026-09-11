// Throwaway. The realtime spike's load and its checks.
//
//   node load.mjs steps               5,000 viewers across two instances; events at stepped rates;
//                                     then one instance crashes and its viewers reconnect
//   node load.mjs produce RATE SECS   events only, for measuring what NOTIFY costs other writes
//                                     (lock changes and nudges; presence needs connected viewers;
//                                     NO_NOTIFY=1 runs the same transactions without notifying)
//
// Viewers: 5,000, ten to each of 500 documents, each allowed to read eight of the ten spaces the
// components are spread across. Events are the product's mix: 80% presence moves, 15% lock changes,
// 5% notification nudges, each a transaction that changes a row and notifies in the same commit.
//
// Every delivery is checked. The generator knows who should hear each event - everyone in the
// document for presence, only those who may read the component for a lock, only the recipient for a
// nudge - and counts what was missing, duplicated or delivered where it should not have been. After
// each phase, every viewer's picture of locks and presence is compared with the database.
// Runs in Node.
/* global process, console, setTimeout */
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const DB = {
  host: process.env.PGHOST ?? 'rt-pg',
  user: 'postgres',
  password: 'spike',
  database: 'postgres',
};
const INSTANCES = ['http://rt1:8080', 'http://rt2:8080'];
const VIEWERS = 5000;
const DOCS = 500;
const SPACES = 10;
const PER_DOC = 30;

let seed = 11;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const spaceOf = (component) => 1 + (component % SPACES);
const docOf = (component) => 1 + Math.floor((component - 1) / PER_DOC);
const componentsOf = (doc) =>
  Array.from({ length: PER_DOC }, (_, k) => (doc - 1) * PER_DOC + 1 + k);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
const received = new Map(); // event id -> deliveries
const expected = new Map(); // event id -> { count, step, t }
let step = 'warm-up';
const latencies = new Map(); // step -> [ms]
const leaks = new Map(); // step -> count
const duplicates = new Map();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

class Viewer {
  constructor(i) {
    this.viewer = i + 1;
    this.doc = 1 + (i % DOCS);
    const denied = new Set();
    while (denied.size < 2) denied.add(1 + Math.floor(rand() * SPACES));
    this.spaces = new Set(
      Array.from({ length: SPACES }, (_, k) => k + 1).filter((s) => !denied.has(s)),
    );
    this.base = INSTANCES[i % INSTANCES.length];
    this.locks = new Map();
    this.presence = new Map();
    this.seen = new Set();
    this.ready = false;
    this.reconnects = 0;
    this.lastSnapshotAt = 0;
  }

  connect() {
    const url = `${this.base}/events?viewer=${this.viewer}&doc=${this.doc}&spaces=${[...this.spaces].join(',')}`;
    const req = http.get(url, { agent }, (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const f = {};
          for (const line of block.split('\n')) {
            const at = line.indexOf(': ');
            if (at > 0) f[line.slice(0, at)] = line.slice(at + 2);
          }
          if (f.event) this.onEvent(f.id, f.event, f.data);
        }
      });
      res.on('end', () => this.lost());
      res.on('error', () => this.lost());
    });
    req.on('error', () => this.lost());
    this.req = req;
  }

  lost() {
    if (this.dropped) return;
    this.dropped = true;
    this.ready = false;
    this.droppedAt = Date.now();
    // EventSource reconnects after the server's retry; jitter spreads a crowd reconnecting at once.
    setTimeout(
      () => {
        this.dropped = false;
        this.reconnects++;
        this.connect();
      },
      500 + Math.floor(Math.random() * 2000),
    );
  }

  onEvent(id, kind, data) {
    const now = Date.now();
    if (kind === 'snapshot') {
      const s = JSON.parse(data);
      this.locks = new Map(s.locks.map((l) => [l.component_id, l.holder]));
      this.presence = new Map(
        s.presence.map((p) => [p.viewer, { component: p.component_id, mode: p.mode }]),
      );
      this.ready = true;
      this.lastSnapshotAt = now;
      return;
    }
    const e = JSON.parse(data);
    if (this.seen.has(id)) {
      bump(duplicates, step);
    } else {
      this.seen.add(id);
      bump(received, id);
      if (expected.has(id)) {
        if (!latencies.has(step)) latencies.set(step, []);
        latencies.get(step).push(now - e.t);
      }
    }
    if (e.component != null && !this.spaces.has(spaceOf(e.component))) bump(leaks, step);
    if (e.kind === 'inbox' && e.viewer !== this.viewer) bump(leaks, step);
    // Events are applied as state, so a repeat - or an event the snapshot already reflects - is harmless.
    if (kind === 'lock') {
      if (e.holder == null) this.locks.delete(e.component);
      else this.locks.set(e.component, e.holder);
    } else if (kind === 'presence') {
      this.presence.set(e.viewer, { component: e.component, mode: e.mode });
    } else if (kind === 'presence-leave') {
      this.presence.delete(e.viewer);
    }
  }
}

const pool = new pg.Pool({ ...DB, max: 32 });
let seq = 0;
let inFlight = 0;
let behind = 0;
let produced = 0;

let viewersOfDoc = null; // doc -> viewers, built once

async function produceOne(viewers) {
  if (viewers && !viewersOfDoc) {
    viewersOfDoc = new Map();
    for (const v of viewers) {
      if (!viewersOfDoc.has(v.doc)) viewersOfDoc.set(v.doc, []);
      viewersOfDoc.get(v.doc).push(v);
    }
  }
  const r = rand();
  const id = `p-${++seq}`;
  const t = Date.now();
  const c = await pool.connect();
  try {
    await c.query('begin');
    let payload;
    let recipients = 0;
    if (r < 0.8 && viewers) {
      const v = pick(viewers);
      if (!v.ready) return c.query('rollback');
      const component = pick(componentsOf(v.doc));
      const mode = pick(['read', 'review', 'author']);
      const u = await c.query(
        'update presence set component_id = $1, mode = $2, updated_at = now() where viewer = $3',
        [component, mode, v.viewer],
      );
      if (!u.rowCount) return c.query('rollback');
      payload = { id, kind: 'presence', doc: v.doc, component, viewer: v.viewer, mode, t };
      recipients = viewersOfDoc.get(v.doc).filter((x) => x.ready).length;
    } else if (r < 0.95) {
      const component = 1 + Math.floor(rand() * DOCS * PER_DOC);
      const u = await c.query(
        `update lock set holder = case when holder is null then $2::int else null end,
                                 acquired_at = now(), expires_at = now() + interval '15 minutes'
                               where component_id = $1 returning holder`,
        [component, 1 + Math.floor(rand() * VIEWERS)],
      );
      payload = { id, kind: 'lock', doc: docOf(component), component, holder: u.rows[0].holder, t };
      if (viewers)
        recipients = viewersOfDoc
          .get(docOf(component))
          .filter((x) => x.ready && x.spaces.has(spaceOf(component))).length;
    } else {
      const recipient = 1 + Math.floor(rand() * VIEWERS);
      await c.query('insert into inbox (recipient, body) values ($1, $2)', [
        recipient,
        'something happened',
      ]);
      payload = { id, kind: 'inbox', viewer: recipient, t };
      if (viewers) recipients = viewers[recipient - 1].ready ? 1 : 0;
    }
    if (!process.env.NO_NOTIFY)
      await c.query('select pg_notify($1, $2)', ['rt', JSON.stringify(payload)]);
    await c.query('commit');
    produced++;
    if (viewers) expected.set(id, { count: recipients, step, t });
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function produce(rate, seconds, viewers) {
  const until = Date.now() + seconds * 1000;
  const started = produced;
  let credit = 0;
  while (Date.now() < until) {
    credit += rate / 100;
    while (credit >= 1) {
      credit--;
      if (inFlight >= 256) {
        behind++;
        continue;
      }
      inFlight++;
      produceOne(viewers)
        .catch((err) => console.error('produce', err.message))
        .finally(() => inFlight--);
    }
    await sleep(10);
  }
  while (inFlight > 0) await sleep(10);
  return (produced - started) / seconds;
}

function pct(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function tally(name) {
  let want = 0,
    got = 0,
    missing = 0;
  for (const [id, e] of expected) {
    if (e.step !== name) continue;
    const r = received.get(id) ?? 0;
    want += e.count;
    got += r;
    missing += Math.max(0, e.count - r);
  }
  const l = latencies.get(name) ?? [];
  return {
    deliveries_expected: want,
    deliveries_received: got,
    missing,
    duplicates: duplicates.get(name) ?? 0,
    leaks: leaks.get(name) ?? 0,
    latency_ms: { p50: pct(l, 0.5), p95: pct(l, 0.95), p99: pct(l, 0.99), max: pct(l, 1) },
  };
}

async function converged(viewers) {
  // Compare every viewer's picture with the database, as that viewer is allowed to see it.
  const locks = new Map(
    (await pool.query('select component_id, holder from lock where holder is not null')).rows.map(
      (r) => [r.component_id, r.holder],
    ),
  );
  const presence = (await pool.query('select viewer, doc_id, component_id, mode from presence'))
    .rows;
  let wrongLocks = 0,
    wrongPresence = 0,
    notReady = 0;
  for (const v of viewers) {
    if (!v.ready) {
      notReady++;
      continue;
    }
    const want = new Map();
    for (const c of componentsOf(v.doc))
      if (locks.has(c) && v.spaces.has(spaceOf(c))) want.set(c, locks.get(c));
    if (want.size !== v.locks.size || [...want].some(([c, h]) => v.locks.get(c) !== h))
      wrongLocks++;
    const here = presence
      .filter((p) => p.doc_id === v.doc)
      .map((p) => [
        p.viewer,
        p.component_id != null && !v.spaces.has(spaceOf(p.component_id))
          ? { component: null, mode: null }
          : { component: p.component_id, mode: p.mode },
      ]);
    if (
      here.length !== v.presence.size ||
      here.some(([w, s]) => {
        const g = v.presence.get(w);
        return !g || g.component !== s.component || g.mode !== s.mode;
      })
    )
      wrongPresence++;
  }
  return {
    viewers_with_wrong_locks: wrongLocks,
    viewers_with_wrong_presence: wrongPresence,
    not_connected: notReady,
  };
}

async function stats() {
  const out = [];
  for (const base of INSTANCES) {
    out.push(
      await new Promise((resolve) =>
        http
          .get(`${base}/stats`, (res) => {
            let b = '';
            res.on('data', (d) => (b += d));
            res.on('end', () => resolve(JSON.parse(b)));
          })
          .on('error', () => resolve({ base, error: true })),
      ),
    );
  }
  return out;
}

async function steps() {
  await pool.query('update lock set holder = null');
  await pool.query('delete from presence');
  const viewers = Array.from({ length: VIEWERS }, (_, i) => new Viewer(i));
  const t0 = Date.now();
  for (let i = 0; i < viewers.length; i++) {
    viewers[i].connect();
    if (i % 250 === 249) await sleep(250);
  }
  while (viewers.some((v) => !v.ready)) await sleep(100);
  const report = { viewers: VIEWERS, connect_all_ms: Date.now() - t0, steps: {} };
  await sleep(2000);

  for (const rate of [100, 300, 1000, 3000]) {
    step = `${rate}/s`;
    const achieved = await produce(rate, 20, viewers);
    await sleep(3000);
    report.steps[step] = {
      achieved_per_s: Math.round(achieved),
      producer_fell_behind: behind,
      ...tally(step),
    };
    behind = 0;
    console.log(step, JSON.stringify(report.steps[step]));
  }
  report.converged_after_steps = await converged(viewers);
  console.log('converged', JSON.stringify(report.converged_after_steps));

  // One instance crashes mid-traffic; its viewers reconnect to it when it comes back.
  step = 'storm';
  const onRt1 = viewers.filter((v) => v.base === INSTANCES[0]);
  const producing = produce(300, 30, viewers);
  await sleep(5000);
  const crashAt = Date.now();
  http.get(`${INSTANCES[0]}/crash`, () => {}).on('error', () => {});
  await sleep(1000);
  while (onRt1.some((v) => !v.ready || v.lastSnapshotAt < crashAt) && Date.now() - crashAt < 60000)
    await sleep(100);
  const back = onRt1.filter((v) => v.ready && v.lastSnapshotAt >= crashAt);
  const resyncs = back.map((v) => v.lastSnapshotAt - crashAt);
  report.storm = {
    viewers_on_crashed_instance: onRt1.length,
    resynced: back.length,
    resync_ms: { p50: pct(resyncs, 0.5), p95: pct(resyncs, 0.95), max: pct(resyncs, 1) },
  };
  await producing;
  await sleep(3000);
  const storm = tally('storm');
  report.storm.duplicates = storm.duplicates;
  report.storm.leaks = storm.leaks;
  report.storm.latency_ms = storm.latency_ms;
  report.converged_after_storm = await converged(viewers);
  report.instances = await stats();
  console.log('storm', JSON.stringify(report.storm));
  console.log('converged', JSON.stringify(report.converged_after_storm));
  writeFileSync('/app/spike/report.json', JSON.stringify(report, null, 2));
  process.exit(0);
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'produce') {
  const achieved = await produce(Number(a), Number(b), null);
  console.log(
    JSON.stringify({
      asked_per_s: Number(a),
      achieved_per_s: Math.round(achieved),
      fell_behind: behind,
    }),
  );
  process.exit(0);
} else {
  await steps();
}
