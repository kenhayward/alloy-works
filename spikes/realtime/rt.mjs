// Throwaway. One realtime instance, as the design has it: a Server-Sent Events endpoint per session,
// fed by Postgres LISTEN, filtering every event by what each viewer may read.
//
// The channel carries no authority and no content. A lock is taken by a transaction elsewhere; what
// arrives here is only "component 412 changed", as ids. The instance decides who may hear it from
// its own copy of which space each component is in - never from the event. A viewer who may not read
// the component hears nothing of its lock, and hears of a person working in it only as "in this
// document", with the component and mode removed (COL-003). Dropping that event instead would leave
// the viewer's screen showing the person where they were before, which is the wrong answer COL-004
// forbids.
//
// On connecting, a viewer is sent a snapshot of the current state - locks and presence in their
// document - and then events. A reconnect is just another connect, so nothing needs replaying: state
// converges from the snapshot, and the durable things (locks, the inbox) are rows that can be re-read.
//
// Simplification, stated: the viewer's identity and spaces arrive in the query string. The product
// authenticates the connection as it does a request and re-checks on reconnect (API-016).
// Runs in Node.
/* global process, console, setInterval, setTimeout, URL */
import http from 'node:http';
import pg from 'pg';

const INSTANCE = process.env.INSTANCE ?? 'rt';
const DB = {
  host: process.env.PGHOST ?? 'rt-pg',
  user: 'postgres',
  password: 'spike',
  database: 'postgres',
};
const pool = new pg.Pool({ ...DB, max: 20 });

const componentSpace = new Map(); // the instance's own copy: which space each component is in
const componentsOfDoc = new Map();
const byDoc = new Map(); // doc -> Set of connections
const byViewer = new Map(); // viewer -> connection
const stats = {
  connections: 0,
  delivered: 0,
  filtered: 0,
  notifications: 0,
  slowWrites: 0,
  snapshots: 0,
};

function frame(res, id, kind, data) {
  const ok = res.write(`id: ${id}\nevent: ${kind}\ndata: ${data}\n\n`);
  if (!ok) stats.slowWrites++;
}

// A connection holds its events until its snapshot has been sent. Otherwise an event committed after
// the snapshot's read could reach the viewer first, and the older snapshot would then overwrite it.
function send(conn, id, kind, data) {
  if (conn.pending) conn.pending.push([id, kind, data]);
  else frame(conn.res, id, kind, data);
}

async function notify(client, payload) {
  await client.query('select pg_notify($1, $2)', ['rt', JSON.stringify(payload)]);
}

async function start() {
  const { rows } = await pool.query('select id, doc_id, space_id from component');
  for (const r of rows) {
    componentSpace.set(r.id, r.space_id);
    if (!componentsOfDoc.has(r.doc_id)) componentsOfDoc.set(r.doc_id, []);
    componentsOfDoc.get(r.doc_id).push(r.id);
  }

  // A previous life of this instance may have left presence behind; it is not true any more.
  const c = await pool.connect();
  try {
    await c.query('begin');
    const gone = await c.query(
      'delete from presence where instance = $1 returning viewer, doc_id',
      [INSTANCE],
    );
    for (const g of gone.rows) {
      await notify(c, {
        id: `${INSTANCE}-reset-${g.viewer}-${Date.now()}`,
        kind: 'presence-leave',
        doc: g.doc_id,
        viewer: g.viewer,
        t: Date.now(),
      });
    }
    await c.query('commit');
  } finally {
    c.release();
  }

  const listener = new pg.Client(DB);
  await listener.connect();
  listener.on('notification', (msg) => {
    stats.notifications++;
    const e = JSON.parse(msg.payload);
    if (e.kind === 'inbox') {
      const conn = byViewer.get(e.viewer);
      if (conn) {
        send(conn, e.id, e.kind, msg.payload);
        stats.delivered++;
      }
      return;
    }
    const viewers = byDoc.get(e.doc);
    if (!viewers) return;
    const space = e.component == null ? null : componentSpace.get(e.component);
    let redacted = null;
    for (const conn of viewers) {
      if (space !== null && !conn.spaces.has(space)) {
        stats.filtered++;
        if (e.kind !== 'presence') continue;
        redacted ??= JSON.stringify({ ...e, component: null, mode: null });
        send(conn, e.id, e.kind, redacted);
        stats.delivered++;
        continue;
      }
      send(conn, e.id, e.kind, msg.payload);
      stats.delivered++;
    }
  });
  await listener.query('listen rt');

  // Liveness of instances, not of viewers: a viewer is present while their connection is open. An
  // instance that stops beating has its viewers' presence swept by whichever instance notices.
  setInterval(async () => {
    try {
      await pool.query(
        `insert into instance_heartbeat values ($1, now())
                        on conflict (instance) do update set beat_at = now()`,
        [INSTANCE],
      );
      const c = await pool.connect();
      try {
        await c.query('begin');
        const gone = await c.query(`delete from presence p using instance_heartbeat h
                                     where p.instance = h.instance and h.beat_at < now() - interval '15 seconds'
                                     returning p.viewer, p.doc_id`);
        for (const g of gone.rows) {
          await notify(c, {
            id: `${INSTANCE}-sweep-${g.viewer}-${Date.now()}`,
            kind: 'presence-leave',
            doc: g.doc_id,
            viewer: g.viewer,
            t: Date.now(),
          });
        }
        await c.query('commit');
      } finally {
        c.release();
      }
    } catch (err) {
      console.error('heartbeat', err.message);
    }
  }, 5000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ instance: INSTANCE, ...stats }));
      return;
    }
    if (url.pathname === '/crash') {
      res.end('bye');
      setTimeout(() => process.exit(1), 50);
      return;
    }
    if (url.pathname !== '/events') {
      res.writeHead(404).end();
      return;
    }

    const viewer = Number(url.searchParams.get('viewer'));
    const doc = Number(url.searchParams.get('doc'));
    const spaces = new Set(url.searchParams.get('spaces').split(',').map(Number));
    const conn = { viewer, doc, spaces, res, pending: [] };
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');

    // Register before the snapshot, so nothing that commits after the snapshot's read is missed; the
    // events are held until the snapshot is out, then sent in commit order. One the snapshot already
    // reflects then arrives as well, which is harmless because the client applies state rather than
    // counting events.
    if (!byDoc.has(doc)) byDoc.set(doc, new Set());
    byDoc.get(doc).add(conn);
    byViewer.set(viewer, conn);
    stats.connections++;

    let closed = false;
    req.on('close', async () => {
      closed = true;
      byDoc.get(doc)?.delete(conn);
      if (byViewer.get(viewer) === conn) byViewer.delete(viewer);
      stats.connections--;
      try {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const gone = await c.query(
            'delete from presence where viewer = $1 and instance = $2 returning viewer',
            [viewer, INSTANCE],
          );
          if (gone.rowCount)
            await notify(c, {
              id: `${INSTANCE}-leave-${viewer}-${Date.now()}`,
              kind: 'presence-leave',
              doc,
              viewer,
              t: Date.now(),
            });
          await c.query('commit');
        } finally {
          c.release();
        }
      } catch (err) {
        console.error('leave', err.message);
      }
    });

    try {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(
          `insert into presence (viewer, doc_id, component_id, mode, instance) values ($1, $2, null, 'read', $3)
                       on conflict (viewer) do update set doc_id = $2, component_id = null, mode = 'read', instance = $3, updated_at = now()`,
          [viewer, doc, INSTANCE],
        );
        await notify(c, {
          id: `${INSTANCE}-enter-${viewer}-${Date.now()}`,
          kind: 'presence',
          doc,
          component: null,
          viewer,
          mode: 'read',
          t: Date.now(),
        });
        await c.query('commit');
        const locks = await c.query(
          'select component_id, holder from lock where component_id = any($1) and holder is not null',
          [componentsOfDoc.get(doc) ?? []],
        );
        const present = await c.query(
          'select viewer, component_id, mode from presence where doc_id = $1',
          [doc],
        );
        if (closed) return;
        const visible = (component) =>
          component == null || spaces.has(componentSpace.get(component));
        const snapshot = {
          locks: locks.rows.filter((r) => visible(r.component_id)),
          presence: present.rows.map((r) =>
            visible(r.component_id) ? r : { viewer: r.viewer, component_id: null, mode: null },
          ),
        };
        frame(
          res,
          `${INSTANCE}-snapshot-${viewer}-${Date.now()}`,
          'snapshot',
          JSON.stringify(snapshot),
        );
        for (const held of conn.pending) frame(res, ...held);
        conn.pending = null;
        stats.snapshots++;
      } finally {
        c.release();
      }
    } catch (err) {
      console.error('connect', err.message);
      res.end();
    }
  });
  server.keepAliveTimeout = 0;
  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  server.listen(8080, () => console.log(`${INSTANCE} listening`));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
