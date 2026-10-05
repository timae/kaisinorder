const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./src/db');
const { SIGNATURE, CUSTOM, LARGE_SURCHARGE, signatureById, validateOrder } = require('./src/menu');
const { aggregate } = require('./src/aggregate');
const { buildOrderPdf, formatDate } = require('./src/pdf');

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const KAISIN_EMAIL = 'info@kaisin.ch';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const adminToken = () => crypto.createHmac('sha256', SECRET).update('kaisin-admin-v1').digest('hex');

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const isAdmin = (req) => !!ADMIN_PASSWORD && safeEq(cookies(req).kadmin || '', adminToken());
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return bad(res, 'ADMIN_PASSWORD is not configured on the server.', 503);
  if (!isAdmin(req)) return bad(res, 'Admin login required.', 401);
  next();
}

const ORDER_COLS = 'id, round_id, person, kind, size, signature, custom, note, created_at, updated_at';
const publicRound = (r) => ({
  id: r.id, title: r.title, delivery_date: r.delivery_date, delivery_time: r.delivery_time,
  deadline: r.deadline, status: r.status,
});
const acceptingOrders = (r) => r.status === 'open' && (!r.deadline || new Date(r.deadline) > new Date());

async function getRound(id) {
  const n = Number.parseInt(id, 10);
  if (!Number.isFinite(n)) return null;
  const { rows } = await db.query('SELECT * FROM rounds WHERE id = $1', [n]);
  return rows[0] || null;
}
async function getOrders(roundId) {
  const { rows } = await db.query(`SELECT ${ORDER_COLS} FROM orders WHERE round_id = $1 ORDER BY created_at, id`, [roundId]);
  return rows;
}

function describe(o) {
  if (o.kind === 'signature') return `${signatureById(o.signature)?.name || o.signature} (${o.size})`;
  const c = o.custom;
  return `Custom (${o.size}): ${[c.protein, c.base, ...c.toppings, c.sauce, ...c.finishes].join(', ')}`;
}

function emailText(round, agg) {
  const c = round.contact || {};
  const lines = [];
  lines.push('Hello Kaisin team,', '');
  lines.push(`Please find attached our order for ${formatDate(round.delivery_date)}${round.delivery_time ? ` at ${round.delivery_time}` : ''}.`);
  if (c.deliveryAddress) lines.push(`Delivery address: ${c.deliveryAddress}`);
  lines.push('', `Total: ${agg.totalBowls} bowls (${agg.signatureTotal} signature, ${agg.customTotal} create-your-own)`);
  const sig = SIGNATURE.filter((s) => agg.signature[s.id].regular || agg.signature[s.id].large);
  if (sig.length) {
    lines.push('', 'Signature bowls:');
    for (const s of sig) {
      const n = agg.signature[s.id];
      const parts = [];
      if (n.regular) parts.push(`${n.regular}x regular`);
      if (n.large) parts.push(`${n.large}x large`);
      lines.push(`- ${s.name}: ${parts.join(', ')}`);
    }
  }
  if (agg.customGroups.length) {
    lines.push('', 'Create your own bowls:');
    agg.customGroups.forEach((g, i) => {
      const x = g.custom;
      lines.push(`${i + 1}. ${g.people.join(', ')} – ${g.qty}x ${g.size.toUpperCase()}`);
      lines.push(`   Protein: ${x.protein} | Base: ${x.base} | Toppings: ${x.toppings.join(', ') || '–'} | Sauce: ${x.sauce} | Finish: ${x.finishes.join(', ') || '–'}`);
    });
  }
  lines.push('', 'Thank you!', c.name || '');
  return lines.join('\n');
}

// ---------- public API ----------
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/menu', (req, res) => res.json({ signature: SIGNATURE.map(({ fields, ...s }) => s), custom: CUSTOM, largeSurcharge: LARGE_SURCHARGE }));

app.get('/api/rounds', wrap(async (req, res) => {
  const { rows } = await db.query(`
    SELECT r.*, (SELECT count(*)::int FROM orders o WHERE o.round_id = r.id) AS order_count
    FROM rounds r WHERE r.status = 'open' ORDER BY r.delivery_date, r.id`);
  res.json(rows.map((r) => ({ ...publicRound(r), order_count: r.order_count, accepting: acceptingOrders(r) })));
}));

app.get('/api/rounds/:id', wrap(async (req, res) => {
  const round = await getRound(req.params.id);
  if (!round) return bad(res, 'Lunch round not found.', 404);
  const orders = await getOrders(round.id);
  res.json({ round: { ...publicRound(round), accepting: acceptingOrders(round) }, orders });
}));

app.post('/api/rounds/:id/orders', wrap(async (req, res) => {
  const round = await getRound(req.params.id);
  if (!round) return bad(res, 'Lunch round not found.', 404);
  if (!acceptingOrders(round) && !isAdmin(req)) return bad(res, 'This lunch round is closed for new orders.', 409);
  let o;
  try { o = validateOrder(req.body); } catch (e) { return bad(res, e.message); }
  const token = crypto.randomBytes(18).toString('hex');
  const { rows } = await db.query(
    `INSERT INTO orders (round_id, person, kind, size, signature, custom, note, edit_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${ORDER_COLS}`,
    [round.id, o.person, o.kind, o.size, o.signature, o.custom ? JSON.stringify(o.custom) : null, o.note, token],
  );
  res.status(201).json({ order: rows[0], editToken: token });
}));

async function loadOwnedOrder(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const { rows } = await db.query('SELECT o.*, r.status, r.deadline FROM orders o JOIN rounds r ON r.id = o.round_id WHERE o.id = $1', [id]);
  const row = rows[0];
  if (!row) { bad(res, 'Order not found.', 404); return null; }
  const admin = isAdmin(req);
  if (!admin && !safeEq(req.get('x-edit-token') || '', row.edit_token)) { bad(res, 'You can only change your own order.', 403); return null; }
  if (!admin && !acceptingOrders(row)) { bad(res, 'This lunch round is closed. Ask the organiser to change your order.', 409); return null; }
  return row;
}

app.put('/api/orders/:id', wrap(async (req, res) => {
  const row = await loadOwnedOrder(req, res);
  if (!row) return;
  let o;
  try { o = validateOrder(req.body); } catch (e) { return bad(res, e.message); }
  const { rows } = await db.query(
    `UPDATE orders SET person=$2, kind=$3, size=$4, signature=$5, custom=$6, note=$7, updated_at=now()
     WHERE id=$1 RETURNING ${ORDER_COLS}`,
    [row.id, o.person, o.kind, o.size, o.signature, o.custom ? JSON.stringify(o.custom) : null, o.note],
  );
  res.json({ order: rows[0] });
}));

app.delete('/api/orders/:id', wrap(async (req, res) => {
  const row = await loadOwnedOrder(req, res);
  if (!row) return;
  await db.query('DELETE FROM orders WHERE id = $1', [row.id]);
  res.json({ ok: true });
}));

// ---------- admin API ----------
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req), configured: !!ADMIN_PASSWORD }));

app.post('/api/admin/login', wrap(async (req, res) => {
  if (!ADMIN_PASSWORD) return bad(res, 'ADMIN_PASSWORD is not configured on the server.', 503);
  if (!safeEq(req.body?.password || '', ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800));
    return bad(res, 'Wrong password.', 401);
  }
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `kadmin=${adminToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`);
  res.json({ ok: true });
}));

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'kadmin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/rounds', requireAdmin, wrap(async (req, res) => {
  const { rows } = await db.query(`
    SELECT r.*, (SELECT count(*)::int FROM orders o WHERE o.round_id = r.id) AS order_count
    FROM rounds r ORDER BY r.delivery_date DESC, r.id DESC LIMIT 100`);
  res.json(rows);
}));

function defaultContact() {
  const e = process.env;
  return {
    name: e.DEFAULT_CONTACT_NAME || '', company: e.DEFAULT_COMPANY || '', phone: e.DEFAULT_PHONE || '',
    email: e.DEFAULT_EMAIL || '', deliveryAddress: e.DEFAULT_DELIVERY_ADDRESS || '',
    invoiceAddress: e.DEFAULT_INVOICE_ADDRESS || '', notes: '',
  };
}

function cleanRoundInput(b, partial = false) {
  const out = {};
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  if (!partial || 'title' in b) out.title = str(b.title, 120) || 'Kaisin lunch';
  if (!partial || 'delivery_date' in b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.delivery_date || '')) throw new Error('Please set a delivery date.');
    out.delivery_date = b.delivery_date;
  }
  if (!partial || 'delivery_time' in b) out.delivery_time = str(b.delivery_time, 20);
  if (!partial || 'deadline' in b) {
    out.deadline = b.deadline ? new Date(b.deadline) : null;
    if (out.deadline && Number.isNaN(out.deadline.getTime())) throw new Error('Invalid order deadline.');
  }
  if ('contact' in b) {
    const c = b.contact || {};
    out.contact = JSON.stringify(Object.fromEntries(
      ['name', 'company', 'phone', 'email', 'deliveryAddress', 'invoiceAddress', 'notes'].map((k) => [k, str(c[k], 200)]),
    ));
  }
  if ('extras' in b) {
    const x = b.extras || {};
    out.extras = JSON.stringify({ cutlery: !!x.cutlery, chopsticks: !!x.chopsticks, napkins: !!x.napkins });
  }
  if ('notes' in b) out.notes = str(b.notes, 300);
  if ('notes_custom' in b) out.notes_custom = str(b.notes_custom, 300);
  return out;
}

app.post('/api/admin/rounds', requireAdmin, wrap(async (req, res) => {
  let v;
  try { v = cleanRoundInput(req.body); } catch (e) { return bad(res, e.message); }
  // Re-use contact details & extras from the most recent round so you only type them once.
  const { rows: prev } = await db.query('SELECT contact, extras FROM rounds ORDER BY id DESC LIMIT 1');
  const contact = prev[0] ? { ...prev[0].contact, notes: '' } : defaultContact();
  const extras = prev[0]?.extras || { cutlery: true, chopsticks: false, napkins: true };
  const { rows } = await db.query(
    `INSERT INTO rounds (title, delivery_date, delivery_time, deadline, contact, extras)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [v.title, v.delivery_date, v.delivery_time, v.deadline, JSON.stringify(contact), JSON.stringify(extras)],
  );
  res.status(201).json(rows[0]);
}));

app.get('/api/admin/rounds/:id', requireAdmin, wrap(async (req, res) => {
  const round = await getRound(req.params.id);
  if (!round) return bad(res, 'Round not found.', 404);
  const orders = await getOrders(round.id);
  const agg = aggregate(orders);
  const warnings = [];
  if (agg.totalBowls < 5) warnings.push(`Kaisin only accepts orders of 5 bowls or more (currently ${agg.totalBowls}).`);
  const delivery = new Date(`${String(round.delivery_date).slice(0, 10)}T${/^\d{1,2}:\d{2}$/.test(round.delivery_time) ? round.delivery_time.padStart(5, '0') : '12:00'}:00`);
  if (round.status === 'open' && delivery - Date.now() < 24 * 3600 * 1000) {
    warnings.push('Kaisin needs the order at least 24 hours before delivery.');
  }
  if (agg.customPages > 1) warnings.push(`${agg.customGroups.length} different custom bowls – the PDF gets ${agg.customPages} "Create your own" pages.`);
  res.json({
    round, orders: orders.map((o) => ({ ...o, description: describe(o) })), summary: agg, warnings,
    email: { to: KAISIN_EMAIL, subject: `Order ${round.contact?.company || ''} – ${formatDate(round.delivery_date)}`.replace('  ', ' '), body: emailText(round, agg) },
  });
}));

app.put('/api/admin/rounds/:id', requireAdmin, wrap(async (req, res) => {
  const round = await getRound(req.params.id);
  if (!round) return bad(res, 'Round not found.', 404);
  let v;
  try { v = cleanRoundInput(req.body, true); } catch (e) { return bad(res, e.message); }
  const keys = Object.keys(v);
  if (!keys.length) return res.json(round);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await db.query(`UPDATE rounds SET ${sets} WHERE id = $1 RETURNING *`, [round.id, ...keys.map((k) => v[k])]);
  res.json(rows[0]);
}));

app.post('/api/admin/rounds/:id/finalize', requireAdmin, wrap(async (req, res) => {
  const round = await getRound(req.params.id);
  if (!round) return bad(res, 'Round not found.', 404);
  const orders = await getOrders(round.id);
  if (!orders.length) return bad(res, 'There are no orders in this round yet.');
  const { rows } = await db.query(`UPDATE rounds SET status='finalized', finalized_at=now() WHERE id=$1 RETURNING *`, [round.id]);
  res.json(rows[0]);
}));

app.post('/api/admin/rounds/:id/reopen', requireAdmin, wrap(async (req, res) => {
  const { rows } = await db.query(`UPDATE rounds SET status='open', finalized_at=NULL WHERE id=$1 RETURNING *`, [Number.parseInt(req.params.id, 10)]);
  if (!rows[0]) return bad(res, 'Round not found.', 404);
  res.json(rows[0]);
}));

app.delete('/api/admin/rounds/:id', requireAdmin, wrap(async (req, res) => {
  await db.query('DELETE FROM rounds WHERE id = $1', [Number.parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.get('/api/admin/rounds/:id/pdf', requireAdmin, wrap(async (req, res) => {
  const round = await getRound(req.params.id);
  if (!round) return bad(res, 'Round not found.', 404);
  const orders = await getOrders(round.id);
  const bytes = await buildOrderPdf(round, aggregate(orders));
  const date = String(round.delivery_date).slice(0, 10);
  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="Kaisin-Order-${date}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Admin page + SPA fallback for round links
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

async function start() {
  if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set – the admin page is disabled.');
  for (let attempt = 1; ; attempt++) {
    try { await db.migrate(); break; } catch (e) {
      if (attempt >= 10) throw e;
      console.error(`Database not reachable (attempt ${attempt}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  app.listen(PORT, () => console.log(`Kaisin lunch listening on :${PORT}`));
}

if (require.main === module) {
  start().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { app };
