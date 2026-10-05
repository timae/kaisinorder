(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'on') Object.entries(v).forEach(([e, f]) => n.addEventListener(e, f));
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((k) => k != null && n.append(k instanceof Node ? k : document.createTextNode(k)));
    return n;
  };
  const tc = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  const chf = (n) => `CHF ${n.toFixed(2)}`;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  let menu; let round; let orders = [];
  let mine = store.get('kaisin.mine', {}); // orderId -> edit token
  let editingId = null;
  const emptyCustom = () => ({ protein: null, base: null, toppings: [], sauce: null, finishes: [] });
  const sel = { kind: 'signature', signature: null, size: 'regular', custom: emptyCustom() };

  function toast(msg) {
    const t = el('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtDeadline = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // ---------- rendering ----------
  function renderSignature() {
    const grid = $('#sigGrid');
    grid.replaceChildren(...menu.signature.map((s) => el('button', {
      type: 'button', class: 'bowl', 'aria-pressed': String(sel.kind === 'signature' && sel.signature === s.id),
      on: { click: () => { sel.signature = s.id; renderSignature(); renderBar(); } },
    },
    el('span', { class: 'name' }, s.name),
    el('span', { class: 'ing' }, [s.protein, s.base, ...s.toppings, s.sauce, ...s.finish].join(' · ')),
    el('span', { class: 'price' }, `${chf(s.price.regular)} regular · ${chf(s.price.large)} large`))));
  }

  function chipGroup(id, options, { multi = 0, key, price } = {}) {
    const box = $(id);
    const value = sel.custom[key];
    box.replaceChildren(...options.map((opt) => {
      const name = typeof opt === 'string' ? opt : opt.name;
      const on = multi ? value.includes(name) : value === name;
      return el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(on),
        disabled: Boolean(multi && !on && value.length >= multi),
        on: { click: () => {
          if (multi) sel.custom[key] = on ? value.filter((v) => v !== name) : [...value, name];
          else sel.custom[key] = name;
          renderCustom(); renderBar();
        } },
      }, tc(name), price ? el('small', {}, price(opt)) : null);
    }));
  }

  function renderCustom() {
    const C = menu.custom;
    const extra = sel.size === 'large' ? menu.largeSurcharge : 0;
    chipGroup('#c-protein', C.proteins, { key: 'protein', price: (p) => (p.price + extra).toFixed(2) });
    chipGroup('#c-base', C.bases, { key: 'base' });
    chipGroup('#c-toppings', C.toppings, { key: 'toppings', multi: C.maxToppings });
    chipGroup('#c-sauce', C.sauces, { key: 'sauce' });
    chipGroup('#c-finishes', C.finishes, { key: 'finishes', multi: C.maxFinishes });
    $('#h-toppings').textContent = `${sel.custom.toppings.length} of ${C.maxToppings}`;
    $('#h-finishes').textContent = `${sel.custom.finishes.length} of ${C.maxFinishes}`;
  }

  function currentPrice() {
    if (sel.kind === 'signature') {
      const s = menu.signature.find((x) => x.id === sel.signature);
      return s ? s.price[sel.size] : null;
    }
    const p = menu.custom.proteins.find((x) => x.name === sel.custom.protein);
    return p ? p.price + (sel.size === 'large' ? menu.largeSurcharge : 0) : null;
  }

  function missing() {
    if (sel.kind === 'signature') return sel.signature ? null : 'Choose a signature bowl';
    const c = sel.custom;
    if (!c.protein) return 'Choose a protein';
    if (!c.base) return 'Choose a base';
    if (!c.sauce) return 'Choose a sauce';
    return null;
  }

  function renderBar() {
    const bar = $('#bar');
    bar.hidden = !round || !round.accepting;
    const m = missing();
    let what;
    if (sel.kind === 'signature') {
      const s = menu.signature.find((x) => x.id === sel.signature);
      what = s ? `${s.name} · ${tc(sel.size)}` : 'Choose a bowl';
    } else {
      const c = sel.custom;
      const parts = [c.protein, c.base, ...c.toppings, c.sauce, ...c.finishes].filter(Boolean).map(tc);
      what = parts.length ? `Custom ${tc(sel.size)}: ${parts.join(', ')}` : 'Build your bowl';
    }
    $('#barWhat').textContent = what;
    const p = currentPrice();
    $('#barPrice').textContent = m || (p != null ? `approx. ${chf(p)}` : '');
    $('#submit').textContent = editingId ? 'Save changes' : 'Place order';
    $('#cancelEdit').hidden = !editingId;
  }

  function setKind(kind) {
    sel.kind = kind;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === kind)));
    $('#tab-signature').hidden = kind !== 'signature';
    $('#tab-custom').hidden = kind !== 'custom';
    renderSignature(); renderCustom(); renderBar();
  }

  function setSize(size) {
    sel.size = size;
    document.querySelectorAll('#size button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
    renderCustom(); renderBar();
  }

  function describe(o) {
    if (o.kind === 'signature') {
      const s = menu.signature.find((x) => x.id === o.signature);
      return `${s ? s.name : o.signature} · ${tc(o.size)}`;
    }
    const c = o.custom;
    return `Custom ${tc(o.size)}: ${[c.protein, c.base, ...c.toppings, c.sauce, ...c.finishes].map(tc).join(', ')}`;
  }

  function renderOrders() {
    $('#count').textContent = orders.length;
    const list = $('#orders');
    if (!orders.length) { list.replaceChildren(el('li', { class: 'empty' }, 'No orders yet. Be the first!')); return; }
    list.replaceChildren(...orders.map((o) => {
      const own = !!mine[o.id];
      return el('li', {},
        el('div', { class: 'who' }, o.person, own ? el('span', { class: 'mine' }, 'YOU') : null),
        el('div', { class: 'desc' }, describe(o), o.note ? el('div', {}, `Note: ${o.note}`) : null),
        own && round.accepting ? el('div', { class: 'row' },
          el('button', { type: 'button', class: 'ghost', on: { click: () => startEdit(o) } }, 'Edit'),
          el('button', { type: 'button', class: 'ghost danger', on: { click: () => removeOrder(o) } }, 'Remove')) : null);
    }));
  }

  // ---------- actions ----------
  function startEdit(o) {
    editingId = o.id;
    $('#person').value = o.person;
    $('#note').value = o.note || '';
    setSize(o.size);
    if (o.kind === 'signature') { sel.signature = o.signature; setKind('signature'); } else {
      sel.custom = { ...o.custom, toppings: [...o.custom.toppings], finishes: [...o.custom.finishes] };
      setKind('custom');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    editingId = null;
    sel.signature = null;
    sel.custom = emptyCustom();
    $('#note').value = '';
    renderSignature(); renderCustom(); renderBar();
  }

  async function submit() {
    const person = $('#person').value.trim();
    if (!person) { $('#person').focus(); toast('Please enter your name'); return; }
    const m = missing();
    if (m) { toast(m); return; }
    store.set('kaisin.name', person);
    const body = JSON.stringify({ person, size: sel.size, kind: sel.kind, signature: sel.signature, custom: sel.custom, note: $('#note').value });
    $('#submit').disabled = true;
    try {
      if (editingId) {
        await api(`/api/orders/${editingId}`, { method: 'PUT', body, headers: { 'X-Edit-Token': mine[editingId] } });
        toast('Order updated');
      } else {
        const r = await api(`/api/rounds/${round.id}/orders`, { method: 'POST', body });
        mine[r.order.id] = r.editToken;
        store.set('kaisin.mine', mine);
        toast('Order placed – enjoy your lunch!');
      }
      resetForm();
      await loadRound(round.id);
    } catch (e) { toast(e.message); } finally { $('#submit').disabled = false; }
  }

  async function removeOrder(o) {
    if (!confirm(`Remove ${o.person}'s order?`)) return;
    try {
      await api(`/api/orders/${o.id}`, { method: 'DELETE', headers: { 'X-Edit-Token': mine[o.id] } });
      delete mine[o.id];
      store.set('kaisin.mine', mine);
      if (editingId === o.id) resetForm();
      await loadRound(round.id);
    } catch (e) { toast(e.message); }
  }

  // ---------- loading ----------
  async function loadRound(id) {
    const data = await api(`/api/rounds/${id}`);
    round = data.round; orders = data.orders;
    const bits = [`${round.title} – ${fmtDate(round.delivery_date)}${round.delivery_time ? `, ${round.delivery_time}` : ''}`];
    if (round.deadline && round.accepting) bits.push(`order by ${fmtDeadline(round.deadline)}`);
    $('#roundInfo').textContent = bits.join(' · ');
    $('#main').hidden = false;
    $('#closed').hidden = round.accepting;
    $('#orderCard').hidden = !round.accepting;
    renderOrders(); renderBar();
  }

  async function init() {
    menu = await api('/api/menu');
    $('#person').value = store.get('kaisin.name', '');
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.tab)));
    document.querySelectorAll('#size button').forEach((b) => b.addEventListener('click', () => setSize(b.dataset.size)));
    $('#submit').addEventListener('click', submit);
    $('#cancelEdit').addEventListener('click', resetForm);
    setKind('signature');

    const wanted = new URLSearchParams(location.search).get('round');
    if (wanted) return loadRound(wanted);
    const rounds = await api('/api/rounds');
    if (!rounds.length) { $('#roundInfo').textContent = ''; $('#none').hidden = false; return; }
    if (rounds.length === 1) return loadRound(rounds[0].id);
    $('#roundInfo').textContent = 'Several lunches are open.';
    $('#picker').hidden = false;
    $('#pickerList').replaceChildren(...rounds.map((r) => el('a', { href: `/?round=${r.id}` },
      `${r.title} – ${fmtDate(r.delivery_date)}`, el('small', {}, `${r.order_count} orders`))));
  }

  init().catch((e) => { $('#roundInfo').textContent = e.message; });
})();
