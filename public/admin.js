(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tc = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  const chf = (n) => `CHF ${Number(n).toFixed(2)}`;
  const fmtDate = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

  let menu; let rounds = []; let current = null; let detail = null;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error(data.error || 'Login required'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---------- auth ----------
  function showLogin(msg) {
    $('#login').hidden = false; $('#app').hidden = true; $('#logout').hidden = true;
    if (msg) { $('#loginErr').textContent = msg; $('#loginErr').hidden = false; }
  }
  async function showApp() {
    $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
    menu = await api('/api/menu');
    await loadRounds();
    const id = Number(new URLSearchParams(location.search).get('round')) || rounds[0]?.id;
    if (id) await openRound(id);
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginErr').hidden = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
      $('#password').value = '';
      await showApp();
    } catch (err) { showLogin(err.message); }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); showLogin(); });

  // ---------- rounds ----------
  async function loadRounds() {
    rounds = await api('/api/admin/rounds');
    const nav = $('#rounds');
    if (!rounds.length) { nav.innerHTML = '<p class="hint" style="margin:0">No rounds yet.</p>'; return; }
    nav.innerHTML = rounds.map((r) => `
      <a href="?round=${r.id}" data-id="${r.id}" class="${current === r.id ? 'active' : ''}">
        <strong>${esc(fmtDate(r.delivery_date))}</strong> ${r.status === 'finalized' ? '<span class="badge final">finalized</span>' : '<span class="badge open">open</span>'}
        <small>${esc(r.title)} · ${r.order_count} orders</small>
      </a>`).join('');
    nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openRound(Number(a.dataset.id)); }));
  }

  $('#newRound').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/admin/rounds', { method: 'POST', body: JSON.stringify({
        title: $('#nr-title').value || 'Team lunch', delivery_date: $('#nr-date').value,
        delivery_time: $('#nr-time').value, deadline: fromLocalInput($('#nr-deadline').value),
      }) });
      e.target.reset(); $('#nr-time').value = '12:00';
      await loadRounds();
      await openRound(r.id);
      toast('Round opened – share the link with your team');
    } catch (err) { toast(err.message); }
  });

  async function openRound(id) {
    current = id;
    history.replaceState(null, '', `?round=${id}`);
    document.querySelectorAll('#rounds a').forEach((a) => a.classList.toggle('active', Number(a.dataset.id) === id));
    detail = await api(`/api/admin/rounds/${id}`);
    renderDetail();
  }

  // ---------- detail ----------
  function renderDetail() {
    const { round, orders, summary, warnings, email } = detail;
    const finalized = round.status === 'finalized';
    const share = `${location.origin}/?round=${round.id}`;
    const c = round.contact || {};
    const x = round.extras || {};
    const sigRows = menu.signature.filter((s) => summary.signature[s.id].regular || summary.signature[s.id].large)
      .map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${summary.signature[s.id].regular || ''}</td><td class="num">${summary.signature[s.id].large || ''}</td><td class="hint">${esc(summary.signature[s.id].people.join(', '))}</td></tr>`).join('');
    const cyoRows = summary.customGroups.map((g, i) => `<tr><td class="num">${i + 1}</td><td>${esc(g.people.join(', '))}</td><td>${tc(g.size)}</td>
      <td>${esc([g.custom.protein, g.custom.base, ...g.custom.toppings, g.custom.sauce, ...g.custom.finishes].map(tc).join(', '))}</td><td class="num">${g.qty}</td></tr>`).join('');
    const field = (id, label, value, cls = '') => `<div class="${cls}"><label class="field" for="${id}">${label}</label><input type="text" id="${id}" value="${esc(value)}" ${finalized ? 'disabled' : ''}></div>`;
    const dis = finalized ? 'disabled' : '';

    $('#detail').innerHTML = `
      <section class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <h2 style="margin:0">${esc(round.title)} – ${esc(fmtDate(round.delivery_date))}${round.delivery_time ? `, ${esc(round.delivery_time)}` : ''}</h2>
            <span class="badge ${finalized ? 'final' : 'open'}">${finalized ? 'Finalized' : 'Open for orders'}</span>
            ${round.deadline ? `<span class="hint">Order deadline ${esc(new Date(round.deadline).toLocaleString())}</span>` : ''}
          </div>
        </div>
        <div class="row" style="margin-top:14px">
          <input type="text" readonly value="${esc(share)}" class="grow" id="shareUrl">
          <button type="button" id="copyShare">Copy link</button>
        </div>
      </section>

      ${warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}

      <section class="card">
        <div class="stats">
          <div><div class="stat">${summary.totalBowls}</div><span>bowls total</span></div>
          <div><div class="stat">${summary.signatureTotal}</div><span>signature</span></div>
          <div><div class="stat">${summary.customTotal}</div><span>create your own</span></div>
          <div><div class="stat">${chf(summary.estTotal)}</div><span>estimated total</span></div>
        </div>
        ${sigRows ? `<h3>Signature bowls (page 1)</h3><div class="table-scroll"><table><thead><tr><th>Bowl</th><th class="num">Regular</th><th class="num">Large</th><th>Who</th></tr></thead><tbody>${sigRows}</tbody></table></div>` : ''}
        ${cyoRows ? `<h3>Create your own (page 2) <span class="hint">identical bowls are merged</span></h3><div class="table-scroll"><table><thead><tr><th class="num">#</th><th>Bowl name</th><th>Size</th><th>Ingredients</th><th class="num">Qty</th></tr></thead><tbody>${cyoRows}</tbody></table></div>` : ''}
      </section>

      <section class="card">
        <h2>Orders <span class="badge">${orders.length}</span></h2>
        ${orders.length ? `<div class="table-scroll"><table><thead><tr><th>Name</th><th>Order</th><th>Note</th><th></th></tr></thead><tbody>
          ${orders.map((o) => `<tr><td><strong>${esc(o.person)}</strong></td><td>${esc(o.description)}</td><td>${esc(o.note)}</td>
            <td class="num"><button type="button" class="ghost danger" data-del="${o.id}">Remove</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">No orders yet. Share the link above.</p>'}
      </section>

      <section class="card">
        <h2>Order form details</h2>
        <h3>Delivery</h3>
        <div class="form-grid">
          ${field('f-title', 'Title', round.title)}
          <div><label class="field" for="f-date">Delivery date</label><input type="date" id="f-date" value="${esc(String(round.delivery_date).slice(0, 10))}" ${dis}></div>
          <div><label class="field" for="f-time">Delivery time</label><input type="time" id="f-time" value="${esc(round.delivery_time)}" ${dis}></div>
          <div><label class="field" for="f-deadline">Order deadline</label><input type="datetime-local" id="f-deadline" value="${esc(toLocalInput(round.deadline))}" ${dis}></div>
        </div>
        <h3>Contact information (page 3)</h3>
        <div class="form-grid">
          ${field('c-name', 'Name', c.name)}
          ${field('c-company', 'Company', c.company)}
          ${field('c-phone', 'Phone number', c.phone)}
          ${field('c-email', 'Email address', c.email)}
          ${field('c-deliveryAddress', 'Delivery address', c.deliveryAddress, 'full')}
          ${field('c-invoiceAddress', 'Invoice address', c.invoiceAddress, 'full')}
          ${field('c-notes', 'Notes (contact page)', c.notes, 'full')}
        </div>
        <h3>Extras (page 1)</h3>
        <div class="checks">
          ${['cutlery', 'chopsticks', 'napkins'].map((k) => `<label><input type="checkbox" id="x-${k}" ${x[k] ? 'checked' : ''} ${dis}> ${tc(k)}</label>`).join('')}
        </div>
        <h3>Notes on the form</h3>
        <div class="form-grid">
          ${field('n-notes', 'Signature bowls page', round.notes, 'full')}
          <div class="full">
            <label class="field" for="n-notes_custom">Create-your-own page ${orders.some((o) => o.note) && !finalized ? '<button type="button" class="ghost" id="useNotes" style="padding:0 4px">insert order notes</button>' : ''}</label>
            <input type="text" id="n-notes_custom" value="${esc(round.notes_custom)}" ${dis}>
          </div>
        </div>
        <div class="row" style="margin-top:20px">
          ${finalized ? `
            <a class="btn primary" href="/api/admin/rounds/${round.id}/pdf?download=1">Download PDF</a>
            <a class="btn" href="/api/admin/rounds/${round.id}/pdf" target="_blank" rel="noopener">View PDF</a>
            <button type="button" id="reopen">Reopen round</button>
          ` : `
            <button type="button" id="save">Save</button>
            <button type="button" id="preview">Preview PDF</button>
            <button type="button" class="primary" id="finalize">Finalize order</button>
          `}
          <span class="grow"></span>
          <button type="button" class="ghost danger" id="deleteRound">Delete round</button>
        </div>
      </section>

      ${finalized ? `
      <section class="card">
        <h2>Send to Kaisin</h2>
        <p class="hint" style="margin:0 0 10px">Download the PDF, then open the email draft and attach it. Kaisin asks for the create-your-own bowls to be listed in the email too, so they're included below.</p>
        <pre class="email" id="emailBody">${esc(email.body)}</pre>
        <div class="row">
          <a class="btn primary" id="mailto" href="mailto:${esc(email.to)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}">Open email draft</a>
          <button type="button" id="copyEmail">Copy email text</button>
          <span class="hint">To: ${esc(email.to)}</span>
        </div>
      </section>` : ''}
    `;

    $('#copyShare').addEventListener('click', () => copy(share, 'Link copied'));
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteOrder(Number(b.dataset.del))));
    $('#deleteRound').addEventListener('click', deleteRound);
    if (finalized) {
      $('#reopen').addEventListener('click', reopen);
      $('#copyEmail').addEventListener('click', () => copy(email.body, 'Email text copied'));
    } else {
      $('#save').addEventListener('click', async () => { await save(); toast('Saved'); });
      $('#preview').addEventListener('click', async () => { await save(); window.open(`/api/admin/rounds/${round.id}/pdf`, '_blank'); });
      $('#finalize').addEventListener('click', finalize);
      $('#useNotes')?.addEventListener('click', () => {
        $('#n-notes_custom').value = orders.filter((o) => o.note).map((o) => `${o.person}: ${o.note}`).join('; ');
      });
    }
  }

  function copy(text, msg) {
    navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Copy failed – select and copy manually'));
  }

  function formPayload() {
    const v = (id) => $(`#${id}`).value;
    return {
      title: v('f-title'), delivery_date: v('f-date'), delivery_time: v('f-time'), deadline: fromLocalInput(v('f-deadline')),
      contact: Object.fromEntries(['name', 'company', 'phone', 'email', 'deliveryAddress', 'invoiceAddress', 'notes'].map((k) => [k, v(`c-${k}`)])),
      extras: Object.fromEntries(['cutlery', 'chopsticks', 'napkins'].map((k) => [k, $(`#x-${k}`).checked])),
      notes: v('n-notes'), notes_custom: v('n-notes_custom'),
    };
  }

  async function save() {
    try {
      await api(`/api/admin/rounds/${current}`, { method: 'PUT', body: JSON.stringify(formPayload()) });
      await loadRounds();
      detail = await api(`/api/admin/rounds/${current}`);
      renderDetail();
    } catch (e) { toast(e.message); throw e; }
  }

  async function finalize() {
    const p = formPayload();
    const missingContact = ['name', 'phone', 'email', 'deliveryAddress'].filter((k) => !p.contact[k].trim());
    if (missingContact.length) { toast('Please fill in name, phone, email and delivery address'); return; }
    await save();
    const msgs = detail.warnings.length ? `\n\nHeads up:\n- ${detail.warnings.join('\n- ')}` : '';
    if (!confirm(`Finalize this order? People won't be able to change their orders anymore.${msgs}`)) return;
    try {
      await api(`/api/admin/rounds/${current}/finalize`, { method: 'POST' });
      await loadRounds();
      await openRound(current);
      window.location.href = `/api/admin/rounds/${current}/pdf?download=1`;
    } catch (e) { toast(e.message); }
  }

  async function reopen() {
    try { await api(`/api/admin/rounds/${current}/reopen`, { method: 'POST' }); await loadRounds(); await openRound(current); } catch (e) { toast(e.message); }
  }

  async function deleteOrder(id) {
    const o = detail.orders.find((x) => x.id === id);
    if (!confirm(`Remove ${o.person}'s order?`)) return;
    try { await api(`/api/orders/${id}`, { method: 'DELETE' }); await loadRounds(); await openRound(current); } catch (e) { toast(e.message); }
  }

  async function deleteRound() {
    if (!confirm('Delete this round and all its orders? This cannot be undone.')) return;
    try {
      await api(`/api/admin/rounds/${current}`, { method: 'DELETE' });
      current = null; history.replaceState(null, '', '/admin');
      $('#detail').innerHTML = '<div class="card empty">Select or create a lunch round.</div>';
      await loadRounds();
    } catch (e) { toast(e.message); }
  }

  // ---------- boot ----------
  fetch('/api/admin/me').then((r) => r.json()).then((me) => {
    if (!me.configured) return showLogin('ADMIN_PASSWORD is not set on the server. Set it with nctl and redeploy.');
    return me.admin ? showApp() : showLogin();
  }).catch((e) => showLogin(e.message));
})();
