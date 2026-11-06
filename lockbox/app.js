// Lockbox: lock money away with someone you trust and earn it back by hitting goals.
// Everything is stored on this device only (localStorage). The app never moves money;
// it keeps the record of what you put in, what you've earned back and what's still owed.
'use strict';

const STORE_KEY = 'lockbox-v1';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// ---------- storage ----------
function blankState() {
  return { version: 1, currency: 'USD', pots: [] };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.pots)) return s;
  } catch (e) { /* fall through */ }
  return blankState();
}
let state = load();
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();

function money(cents) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency || 'USD' }).format((cents || 0) / 100);
}
function toCents(v) {
  const n = Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(ms) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtLeft(ms) {
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.ceil((ms % HOUR) / 60000);
  if (d >= 1) return `${d}d ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}
// A deadline date means "through the end of that day", local time.
function deadlineMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d + 1).getTime();
}
function todayStr(offsetDays = 0) {
  const d = new Date(now() + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function hashPin(pin, salt) {
  const text = `${salt}:${pin}`;
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return 'sha256:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for non-secure contexts (plain http on a local network).
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv:' + h.toString(16);
}
// Returns who the PIN belongs to ('referee' / 'backup') or null.
async function checkPin(pot, pin) {
  if (!pin) return null;
  const h = await hashPin(pin, pot.salt);
  if (pot.pinHash && h === pot.pinHash) return pot.referee || 'Referee';
  if (pot.backupPinHash && h === pot.backupPinHash) return pot.backup || 'Backup referee';
  return null;
}
const needsPin = (pot) => !!(pot.pinHash || pot.backupPinHash);

function log(pot, text) { pot.log.unshift({ at: now(), text }); }

// ---------- money math ----------
function totals(pot) {
  const sum = (f) => pot.goals.filter(f).reduce((a, g) => a + g.amountC, 0);
  const assigned = sum(() => true);
  const earned = sum((g) => g.status === 'approved' || g.status === 'paid');
  const goalsReceived = sum((g) => g.status === 'paid');
  const goalsOwed = sum((g) => g.status === 'approved');
  const rel = pot.release;
  const relOwed = rel && !rel.receivedAt ? rel.amountC : 0;
  const relReceived = rel && rel.receivedAt ? rel.amountC : 0;
  const penalty = rel ? rel.penaltyC : 0;
  const locked = rel ? 0 : pot.amountC - earned;
  return {
    assigned, unassigned: pot.amountC - assigned, earned, locked, penalty,
    owed: goalsOwed + relOwed, received: goalsReceived + relReceived,
  };
}
const isReleased = (pot) => !!pot.release;
const isClosed = (pot) => { const t = totals(pot); return isReleased(pot) && t.owed === 0; };

// Apply the time-based safety rules. Returns true if anything changed.
function tick(pot) {
  let changed = false;
  if (isReleased(pot)) return false;
  // 1. Referee didn't answer a claim in time: it's approved automatically.
  for (const g of pot.goals) {
    if (g.status === 'claimed' && now() - g.claimedAt >= pot.autoDays * DAY) {
      g.status = 'approved'; g.approvedAt = g.claimedAt + pot.autoDays * DAY; g.approvedBy = 'auto-approved (no response)';
      log(pot, `"${g.title}" auto-approved after ${pot.autoDays} days without a response. ${money(g.amountC)} is owed back.`);
      changed = true;
    }
  }
  // 2. Final deadline passed: everything still locked comes back, no conditions.
  if (now() >= deadlineMs(pot.deadline)) {
    release(pot, 'deadline', deadlineMs(pot.deadline) - 1, 0);
    changed = true;
  // 3. Emergency withdrawal cooling-off period is over.
  } else if (pot.emergency && now() >= pot.emergency.unlocksAt) {
    const t = totals(pot);
    const penalty = Math.round((t.locked * (pot.penaltyPct || 0)) / 100);
    release(pot, 'emergency', pot.emergency.unlocksAt, penalty);
    changed = true;
  }
  return changed;
}
function release(pot, reason, at, penaltyC) {
  const t = totals(pot);
  pot.release = { reason, at, amountC: t.locked - penaltyC, penaltyC, receivedAt: null };
  pot.emergency = null;
  const why = { deadline: 'Final deadline reached', emergency: 'Emergency withdrawal unlocked', referee: 'Referee released the pot early' }[reason];
  let msg = `${why}. ${money(t.locked - penaltyC)} still locked is now owed back to you.`;
  if (penaltyC) msg += ` ${money(penaltyC)} penalty goes to ${pot.penaltyTo || 'your chosen charity'}.`;
  log(pot, msg);
}
function tickAll() {
  let changed = false;
  for (const p of state.pots) changed = tick(p) || changed;
  if (changed) save();
}

// ---------- UI plumbing ----------
const view = $('#view');
const modal = $('#modal');
const modalForm = $('#modalForm');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// Opens a dialog. `onSubmit(form)` returns an error string to keep it open, or nothing to close.
function openModal(html, onSubmit) {
  modalForm.innerHTML = html + '<div class="err" id="modalErr"></div>';
  modal.showModal();
  const first = modalForm.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 50);
  modalForm.onsubmit = async (e) => {
    const btn = e.submitter;
    e.preventDefault();
    const err = await onSubmit(modalForm, btn && btn.value);
    if (err) { $('#modalErr').textContent = err; return; }
    modal.close(); save(); render();
  };
}
const cancelBtn = '<button type="button" class="btn ghost" onclick="this.closest(\'dialog\').close()">Cancel</button>';

function pinField(pot, label = 'Referee PIN') {
  if (!needsPin(pot)) {
    return `<div class="notice gold">Honor system: no PIN is set, so you're confirming this on your word.</div>`;
  }
  const who = [pot.referee, pot.backup && pot.backupPinHash ? pot.backup : null].filter(Boolean).join(' or ');
  return `<label>${label}${who ? ` (${esc(who)} types it)` : ''}</label>
    <input name="pin" type="password" inputmode="numeric" autocomplete="off" required>`;
}
async function verify(pot, form) {
  if (!needsPin(pot)) return { who: 'you (honor system)' };
  const who = await checkPin(pot, form.pin.value.trim());
  return who ? { who } : { err: 'Wrong PIN.' };
}

// ---------- routing ----------
function route() {
  const [, page, id] = (location.hash || '#/').split('/');
  return { page: page || '', id };
}
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', render);
$('#backBtn').onclick = () => go('#/');
$('#menuBtn').onclick = () => go('#/settings');

let lastHash = null;
function render() {
  tickAll();
  const { page, id } = route();
  $('#backBtn').hidden = page === '';
  if (location.hash !== lastHash) { window.scrollTo(0, 0); lastHash = location.hash; }
  if (page === 'new') return renderNew();
  if (page === 'settings') return renderSettings();
  if (page === 'pot') {
    const pot = state.pots.find((p) => p.id === id);
    if (pot) return renderPot(pot);
  }
  renderHome();
}

// ---------- home ----------
function renderHome() {
  $('#title').textContent = '🔒 Lockbox';
  const pots = state.pots;
  if (!pots.length) {
    view.innerHTML = `
      <div class="empty">
        <div class="big">🔒</div>
        <h2>Lock money away. Earn it back.</h2>
        <p class="muted">Give money to someone you trust (or park it in a separate account),
        set goals worth part of it, and get it back as you hit them.</p>
        <a class="btn primary" href="#/new">Create your first Lockbox</a>
      </div>`;
    return;
  }
  const all = pots.reduce((a, p) => { const t = totals(p); a.locked += t.locked; a.owed += t.owed; a.received += t.received; return a; }, { locked: 0, owed: 0, received: 0 });
  view.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${money(all.locked)}</b><span>Still locked</span></div>
      <div class="stat gold"><b>${money(all.owed)}</b><span>Owed to you</span></div>
      <div class="stat green"><b>${money(all.received)}</b><span>Got back</span></div>
    </div>
    ${pots.map(potCard).join('')}
    <a class="btn primary block" href="#/new">+ New Lockbox</a>`;
}
function potCard(p) {
  const t = totals(p);
  const pct = (c) => (p.amountC ? (100 * c) / p.amountC : 0);
  const done = p.goals.filter((g) => g.status === 'approved' || g.status === 'paid').length;
  const pending = p.goals.filter((g) => g.status === 'claimed').length;
  let status;
  if (isClosed(p)) status = '<span class="tag paid">Complete</span>';
  else if (isReleased(p)) status = '<span class="tag approved">Released</span>';
  else if (p.emergency) status = '<span class="tag warn">Emergency pending</span>';
  else if (pending) status = `<span class="tag claimed">${pending} awaiting approval</span>`;
  else status = `<span class="tag">Ends ${fmtDate(deadlineMs(p.deadline) - 1)}</span>`;
  return `
    <a class="card pot-link" href="#/pot/${p.id}">
      <div class="row between"><h2 class="grow">${esc(p.name)}</h2><b>${money(p.amountC)}</b></div>
      <div class="bar"><i class="got" style="width:${pct(t.received)}%"></i><i class="owed" style="width:${pct(t.owed)}%"></i></div>
      <div class="row between" style="margin-top:8px">
        <span class="muted">${done}/${p.goals.length} goals · ${money(t.received + t.owed)} ${isReleased(p) ? "back or owed" : "earned"}</span>${status}
      </div>
    </a>`;
}

// ---------- new pot ----------
function renderNew() {
  $('#title').textContent = 'New Lockbox';
  view.innerHTML = `
    <form id="newForm" class="card">
      <label>What's this Lockbox for?</label>
      <input name="name" placeholder="e.g. Get fit by summer" required maxlength="60">

      <label>How much are you locking away?</label>
      <input name="amount" inputmode="decimal" placeholder="500" required>

      <label>Who's holding the money?</label>
      <select name="holder">
        <option value="referee">A trusted person (referee) holds it</option>
        <option value="self">I put it in a separate account (honor system)</option>
      </select>

      <div id="refFields">
        <label>Referee's name</label>
        <input name="referee" placeholder="e.g. Sam" maxlength="40">
        <label>Referee's PIN</label>
        <input name="pin" type="password" inputmode="numeric" autocomplete="new-password" placeholder="Referee types this, not you">
        <div class="hint">Hand your phone to the referee to set this. They'll type it to approve goals.
          Leave blank to use the honor system.</div>

        <label>Backup referee (optional)</label>
        <input name="backup" placeholder="Someone who can step in" maxlength="40">
        <label>Backup referee's PIN (optional)</label>
        <input name="backupPin" type="password" inputmode="numeric" autocomplete="new-password">
      </div>

      <h3 style="margin-top:18px">Safety net</h3>
      <label>Final deadline: everything still locked comes back after this date</label>
      <input name="deadline" type="date" required min="${todayStr(1)}" value="${todayStr(90)}">

      <label>If the referee doesn't respond to a claim, auto-approve it after</label>
      <select name="autoDays">
        <option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option>
      </select>

      <label>Emergency withdrawal waiting period</label>
      <select name="coolHours">
        <option value="24">24 hours</option><option value="72" selected>72 hours</option><option value="168">7 days</option>
      </select>

      <label>Emergency withdrawal penalty (optional)</label>
      <div class="row">
        <select name="penaltyPct" style="max-width:120px">
          <option value="0">None</option><option value="5">5%</option><option value="10">10%</option><option value="25">25%</option>
        </select>
        <input name="penaltyTo" placeholder="Goes to… (e.g. a charity)" maxlength="60">
      </div>
      <div class="hint">If you pull out early, this share of what's still locked goes here instead of back to you.</div>

      <div class="err" id="newErr"></div>
      <button class="btn primary block" style="margin-top:14px">Create Lockbox</button>
    </form>`;
  const f = $('#newForm');
  const syncHolder = () => { $('#refFields').hidden = f.holder.value === 'self'; };
  f.holder.onchange = syncHolder; syncHolder();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const amountC = toCents(f.amount.value);
    if (!amountC) { $('#newErr').textContent = 'Enter an amount.'; return; }
    const isRef = f.holder.value === 'referee';
    if (isRef && f.backupPin.value && !f.pin.value) { $('#newErr').textContent = 'Set the main referee PIN first.'; return; }
    const salt = uid();
    const pot = {
      id: uid(), name: f.name.value.trim(), amountC, holder: f.holder.value,
      referee: isRef ? f.referee.value.trim() : '', backup: isRef ? f.backup.value.trim() : '',
      salt,
      pinHash: isRef && f.pin.value.trim() ? await hashPin(f.pin.value.trim(), salt) : null,
      backupPinHash: isRef && f.backupPin.value.trim() ? await hashPin(f.backupPin.value.trim(), salt) : null,
      deadline: f.deadline.value, autoDays: +f.autoDays.value, coolHours: +f.coolHours.value,
      penaltyPct: +f.penaltyPct.value, penaltyTo: f.penaltyTo.value.trim(),
      createdAt: now(), goals: [], emergency: null, release: null, log: [],
    };
    const holder = isRef ? `with ${pot.referee || 'your referee'}` : 'in a separate account';
    log(pot, `Locked ${money(amountC)} ${holder}. Final deadline ${fmtDate(deadlineMs(pot.deadline) - 1)}.`);
    state.pots.unshift(pot);
    save();
    go(`#/pot/${pot.id}`);
    toast('Lockbox created. Now add some goals.');
  };
}

// ---------- pot detail ----------
function renderPot(pot) {
  $('#title').textContent = pot.name;
  const t = totals(pot);
  const released = isReleased(pot);
  const pct = (c) => (pot.amountC ? (100 * c) / pot.amountC : 0);
  const holderName = pot.holder === 'referee' ? (pot.referee || 'your referee') : 'your separate account';
  const end = deadlineMs(pot.deadline);

  let banner = '';
  if (released) {
    const r = pot.release;
    if (r.amountC === 0 && !r.receivedAt) r.receivedAt = r.at; // nothing was left to return
    if (r.receivedAt) banner = `<div class="notice green">✅ Pot released and paid back on ${fmtDate(r.receivedAt)}.</div>`;
    else banner = `<div class="notice gold">🔓 Released on ${fmtDate(r.at)}. <b>${money(r.amountC)}</b> should come back to you from ${esc(holderName)}.
      <div class="actions"><button class="btn primary sm" data-act="relReceived">I got it back</button></div></div>`;
  } else if (pot.emergency) {
    banner = `<div class="notice red">🚨 Emergency withdrawal requested. Everything still locked unlocks in <b>${fmtLeft(pot.emergency.unlocksAt - now())}</b>
      (${fmtDateTime(pot.emergency.unlocksAt)})${pot.penaltyPct ? `, minus a ${pot.penaltyPct}% penalty` : ''}.
      <div class="actions"><button class="btn sm" data-act="cancelEmergency">Cancel request</button>
      ${pot.holder === 'referee' ? '<button class="btn sm" data-act="refRelease">Referee: release now</button>' : ''}</div></div>`;
  }
  if (t.unassigned > 0 && !released) {
    banner += `<div class="notice gold">${money(t.unassigned)} isn't tied to a goal yet. Add goals for it, or it comes back at the deadline.</div>`;
  }

  view.innerHTML = `
    ${banner}
    <div class="card">
      <div class="row between"><span class="muted">Locked with ${esc(holderName)}</span><b>${money(pot.amountC)}</b></div>
      <div class="stats">
        <div class="stat"><b>${money(t.locked)}</b><span>Still locked</span></div>
        <div class="stat gold"><b>${money(t.owed)}</b><span>Owed to you</span></div>
        <div class="stat green"><b>${money(t.received)}</b><span>Got back</span></div>
      </div>
      <div class="bar"><i class="got" style="width:${pct(t.received)}%"></i><i class="owed" style="width:${pct(t.owed)}%"></i></div>
      <p class="muted small" style="margin:8px 0 0">
        ${released ? 'Released' : `Final deadline ${fmtDate(end - 1)} (${fmtLeft(end - now())} left)`}
        · Auto-approve after ${pot.autoDays}d · ${needsPin(pot) ? 'Referee PIN on' : 'Honor system'}
        ${t.penalty ? ` · ${money(t.penalty)} penalty to ${esc(pot.penaltyTo || 'charity')}` : ''}
      </p>
    </div>

    <div class="card">
      <h3>Goals</h3>
      ${pot.goals.length ? pot.goals.map((g) => goalRow(pot, g)).join('') : '<p class="muted">No goals yet.</p>'}
      ${!released && t.unassigned > 0 ? '<button class="btn primary block" data-act="addGoal" style="margin-top:8px">+ Add goal</button>' : ''}
    </div>

    ${!released ? `
    <div class="card">
      <h3>Safety</h3>
      <div class="actions">
        <button class="btn sm ghost" data-act="extend">Extend deadline</button>
        ${!pot.emergency ? '<button class="btn sm danger" data-act="emergency">Emergency withdrawal</button>' : ''}
      </div>
    </div>` : ''}

    <div class="card">
      <h3>History</h3>
      <ul class="log">${pot.log.map((l) => `<li><time>${fmtDateTime(l.at)}</time>${esc(l.text)}</li>`).join('')}</ul>
    </div>
    <button class="btn danger block" data-act="deletePot">Delete this Lockbox</button>`;

  view.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const g = pot.goals.find((x) => x.id === b.dataset.goal);
    actions[b.dataset.act](pot, g);
  };
}

function goalRow(pot, g) {
  const released = isReleased(pot);
  const tag = {
    open: '', claimed: '<span class="tag claimed">Awaiting approval</span>',
    approved: '<span class="tag approved">Approved · owed to you</span>', paid: '<span class="tag paid">Paid back</span>',
  }[g.status];
  let btns = '';
  const gid = `data-goal="${g.id}"`;
  if (g.status === 'open' && !released) btns = `<button class="btn primary sm" data-act="claim" ${gid}>I did it</button>
    <button class="btn ghost sm" data-act="removeGoal" ${gid}>Remove</button>`;
  if (g.status === 'claimed' && !released) btns = `<button class="btn green sm" data-act="review" ${gid}>Referee: review</button>
    <button class="btn ghost sm" data-act="unclaim" ${gid}>Take back claim</button>`;
  if (g.status === 'approved') btns = `<button class="btn primary sm" data-act="received" ${gid}>${pot.holder === 'self' ? 'I moved it back' : 'I got it back'}</button>`;
  let meta = '';
  if (g.status === 'claimed') meta = `Claimed ${fmtDateTime(g.claimedAt)} · auto-approves in ${fmtLeft(g.claimedAt + pot.autoDays * DAY - now())}`;
  if (g.status === 'approved' || g.status === 'paid') meta = `Approved by ${esc(g.approvedBy)} ${fmtDate(g.approvedAt)}`;
  if (g.status === 'open' && released) meta = 'Pot released before this was done';
  return `
    <div class="goal ${g.status === 'paid' ? 'done' : ''}">
      <div class="row between"><span class="title grow">${esc(g.title)}</span><span class="amt">${money(g.amountC)}</span></div>
      ${g.proof ? `<div class="muted small">Proof: ${esc(g.proof)}</div>` : ''}
      ${meta ? `<div class="muted small">${meta}</div>` : ''}
      <div class="row wrap" style="margin-top:6px;gap:8px">${tag}${btns}</div>
    </div>`;
}

const actions = {
  addGoal(pot) {
    const left = totals(pot).unassigned;
    openModal(`
      <h2>Add a goal</h2>
      <label>Goal</label><input name="title" required maxlength="80" placeholder="e.g. Run 50 miles total">
      <label>Worth (up to ${money(left)})</label><input name="amount" inputmode="decimal" required value="${(left / 100).toFixed(2)}">
      <div class="actions">${cancelBtn}<button class="btn primary">Add</button></div>`,
    (f) => {
      const c = toCents(f.amount.value);
      if (!c) return 'Enter an amount.';
      if (c > totals(pot).unassigned) return `Only ${money(totals(pot).unassigned)} is left to assign.`;
      pot.goals.push({ id: uid(), title: f.title.value.trim(), amountC: c, status: 'open', proof: '' });
      log(pot, `Added goal "${f.title.value.trim()}" worth ${money(c)}.`);
    });
  },
  removeGoal(pot, g) {
    openModal(`<h2>Remove "${esc(g.title)}"?</h2>
      <p class="muted">Its ${money(g.amountC)} stays locked and goes back to "not tied to a goal". You can add a new goal for it.</p>
      <div class="actions">${cancelBtn}<button class="btn danger">Remove</button></div>`,
    () => { pot.goals = pot.goals.filter((x) => x !== g); log(pot, `Removed goal "${g.title}".`); });
  },
  claim(pot, g) {
    openModal(`<h2>Claim "${esc(g.title)}"</h2>
      <label>Proof or note for the referee (optional)</label>
      <textarea name="proof" maxlength="300" placeholder="e.g. Strava screenshot sent to Sam"></textarea>
      <p class="muted small">${pot.holder === 'referee' && needsPin(pot)
        ? `${esc(pot.referee || 'Your referee')} approves it with their PIN. If they don't respond within ${pot.autoDays} days, it's approved automatically.`
        : 'Next, confirm it on the honor system.'}</p>
      <div class="actions">${cancelBtn}<button class="btn primary">Claim it</button></div>`,
    (f) => {
      g.status = 'claimed'; g.claimedAt = now(); g.proof = f.proof.value.trim();
      log(pot, `Claimed "${g.title}" (${money(g.amountC)}).`);
    });
  },
  unclaim(pot, g) {
    g.status = 'open'; g.claimedAt = null;
    log(pot, `Took back the claim on "${g.title}".`);
    save(); render();
  },
  review(pot, g) {
    openModal(`<h2>Review "${esc(g.title)}"</h2>
      <p>Worth <b>${money(g.amountC)}</b>.${g.proof ? `<br><span class="muted">Proof: ${esc(g.proof)}</span>` : ''}</p>
      ${pinField(pot)}
      <div class="actions">${cancelBtn}<button class="btn green" value="approve">Approve</button><button class="btn danger" value="reject">Not yet</button></div>`,
    async (f, choice) => {
      const v = await verify(pot, f);
      if (v.err) return v.err;
      if (choice === 'reject') {
        g.status = 'open'; g.claimedAt = null;
        log(pot, `${v.who} sent "${g.title}" back: not done yet.`);
        return;
      }
      g.status = 'approved'; g.approvedAt = now(); g.approvedBy = v.who;
      log(pot, `${v.who} approved "${g.title}". ${money(g.amountC)} is owed back to you.`);
      setTimeout(() => toast(`🎉 ${money(g.amountC)} earned back!`), 50);
    });
  },
  received(pot, g) {
    openModal(`<h2>Got ${money(g.amountC)} back?</h2>
      <p class="muted">Only mark this once the money is actually back with you.</p>
      <div class="actions">${cancelBtn}<button class="btn primary">Yes, I have it</button></div>`,
    () => { g.status = 'paid'; g.paidAt = now(); log(pot, `Received ${money(g.amountC)} for "${g.title}".`); });
  },
  relReceived(pot) {
    openModal(`<h2>Got ${money(pot.release.amountC)} back?</h2>
      <p class="muted">Only mark this once the money is actually back with you.</p>
      <div class="actions">${cancelBtn}<button class="btn primary">Yes, I have it</button></div>`,
    () => { pot.release.receivedAt = now(); log(pot, `Received the released ${money(pot.release.amountC)}.`); });
  },
  extend(pot) {
    openModal(`<h2>Extend the deadline</h2>
      <p class="muted">You can push the deadline later at any time. Making it earlier isn't allowed, so there's no shortcut to the money.</p>
      <label>New final deadline</label>
      <input name="deadline" type="date" required min="${pot.deadline}" value="${pot.deadline}">
      <div class="actions">${cancelBtn}<button class="btn primary">Save</button></div>`,
    (f) => {
      if (f.deadline.value <= pot.deadline) return 'Pick a later date.';
      pot.deadline = f.deadline.value;
      log(pot, `Deadline extended to ${fmtDate(deadlineMs(pot.deadline) - 1)}.`);
    });
  },
  emergency(pot) {
    const t = totals(pot);
    const penalty = Math.round((t.locked * (pot.penaltyPct || 0)) / 100);
    openModal(`<h2>🚨 Emergency withdrawal</h2>
      <p>This unlocks the <b>${money(t.locked)}</b> still locked after a <b>${pot.coolHours}-hour</b> wait. You can cancel during the wait.</p>
      ${penalty ? `<p class="notice red">${pot.penaltyPct}% penalty: ${money(penalty)} goes to ${esc(pot.penaltyTo || 'your chosen charity')}, and ${money(t.locked - penalty)} comes back to you.</p>` : ''}
      ${t.owed ? `<p class="muted small">The ${money(t.owed)} you've already earned is still owed to you either way.</p>` : ''}
      <label>What's the emergency?</label>
      <textarea name="reason" required maxlength="300"></textarea>
      <div class="actions">${cancelBtn}<button class="btn danger">Start ${pot.coolHours}h countdown</button></div>`,
    (f) => {
      pot.emergency = { requestedAt: now(), unlocksAt: now() + pot.coolHours * HOUR, reason: f.reason.value.trim() };
      log(pot, `Emergency withdrawal requested: "${pot.emergency.reason}". Unlocks ${fmtDateTime(pot.emergency.unlocksAt)}.`);
    });
  },
  cancelEmergency(pot) {
    pot.emergency = null;
    log(pot, 'Emergency withdrawal cancelled. Money stays locked.');
    save(); render(); toast('Cancelled. Nice save.');
  },
  refRelease(pot) {
    openModal(`<h2>Release now?</h2>
      <p>The referee can skip the waiting period and release the ${money(totals(pot).locked)} still locked right away (no penalty).</p>
      ${pinField(pot)}
      <div class="actions">${cancelBtn}<button class="btn danger">Release</button></div>`,
    async (f) => {
      const v = await verify(pot, f);
      if (v.err) return v.err;
      release(pot, 'referee', now(), 0);
      log(pot, `Released early by ${v.who}.`);
    });
  },
  deletePot(pot) {
    const t = totals(pot);
    const risky = !isClosed(pot) && (t.locked || t.owed);
    openModal(`<h2>Delete "${esc(pot.name)}"?</h2>
      ${risky ? `<p class="notice red">${money(t.locked + t.owed)} is still locked or owed. Deleting the record doesn't move any money, but you'll lose track of it.</p>` : ''}
      ${risky && needsPin(pot) ? pinField(pot) : '<label>Type DELETE to confirm</label><input name="confirm" required autocomplete="off">'}
      <div class="actions">${cancelBtn}<button class="btn danger">Delete</button></div>`,
    async (f) => {
      if (risky && needsPin(pot)) { const v = await verify(pot, f); if (v.err) return v.err; }
      else if (f.confirm.value.trim().toUpperCase() !== 'DELETE') return 'Type DELETE to confirm.';
      state.pots = state.pots.filter((p) => p !== pot);
      setTimeout(() => go('#/'), 0);
    });
  },
};

// ---------- settings ----------
function renderSettings() {
  $('#title').textContent = 'Settings';
  view.innerHTML = `
    <div class="card">
      <h3>Currency</h3>
      <select id="currency">
        ${['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'MXN', 'JPY', 'INR'].map((c) => `<option ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="card">
      <h3>Backup</h3>
      <p class="muted">Your Lockboxes live only on this device. Save a backup file now and then, especially before clearing your browser or switching phones.</p>
      <div class="actions">
        <button class="btn primary" id="exportBtn">Save backup</button>
        <label class="btn" style="margin:0;color:var(--text);font-size:16px">Restore backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
      </div>
    </div>
    <div class="card">
      <h3>How the safety net works</h3>
      <ul class="muted" style="padding-left:18px;margin:0">
        <li><b>Final deadline:</b> whatever's still locked comes back after it, no matter what.</li>
        <li><b>Referee no-show:</b> a claim with no response is approved automatically after the days you chose.</li>
        <li><b>Backup referee:</b> can approve with their own PIN if the main referee is unavailable.</li>
        <li><b>Emergency withdrawal:</b> unlocks everything after a waiting period you can cancel, with an optional penalty.</li>
        <li><b>The app never holds money.</b> It's the shared record of what's owed. The actual money moves between you and your referee.</li>
      </ul>
    </div>`;
  $('#currency').onchange = (e) => { state.currency = e.target.value; save(); toast('Saved'); };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `lockbox-backup-${todayStr()}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.pots)) throw new Error('bad');
      if (!confirm(`Replace what's on this device with the backup (${data.pots.length} Lockboxes)?`)) return;
      state = data; save(); toast('Backup restored'); go('#/');
    } catch (err) { toast("That file isn't a Lockbox backup."); }
  };
}

// ---------- start ----------
render();
// Re-check timers (auto-approve, deadline, emergency unlock) every minute while open.
setInterval(() => { if (!modal.open) render(); }, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !modal.open) render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
