/* Pack Ripped: earn points, rip Magic packs, build a collection. */
(function () {
  'use strict';

  const { ODDS, boosterTypeFor, hasCollector, openPack } = window.PackOdds;
  const API = 'https://api.scryfall.com';
  const STORE_KEY = 'packripped:v1';
  const SETS_KEY = 'packripped:sets';
  const POOL_PREFIX = 'packripped:pool2:'; // v2 adds Commander data to cards
  // Sets that were never sold in regular booster packs.
  const NO_BOOSTERS = ['acr', 'clu', 'mat', 'tsb', '4bb'];
  const RARITY_ORDER = { mythic: 4, rare: 3, uncommon: 2, common: 1 };

  const DEFAULT_TASKS = [
    { id: 't1', name: 'Workout 30 minutes', points: 500 },
    { id: 't2', name: 'Drink 8 glasses of water', points: 200 },
    { id: 't3', name: 'Read 20 minutes', points: 300 },
    { id: 't4', name: 'Meditate 10 minutes', points: 200 },
    { id: 't5', name: 'Make your bed', points: 100 },
  ];
  // Ideas offered when adding a goal (tap to use).
  const GOAL_IDEAS = [
    'Workout 30 minutes', 'Read 20 minutes', 'Homework done', 'Learn 30 minutes', 'Pray', 'Practice an instrument',
    'Clean my room', 'Help at home', 'No phone for an hour', 'Go to bed on time', 'Healthy breakfast', 'Drink 8 glasses of water',
    'Call a friend or family member', 'Make your bed', 'Meditate 10 minutes', 'Walk the dog',
  ];
  const GOAL_POINTS = [100, 250, 500, 1000, 2500];
  // Built-in goals given out by versions 13–31; removed below where they were never used.
  const RETIRED_TASKS = { t6: 1000, t7: 1000, t8: 1000, t9: 1000, t10: 1000, t11: 1000, t12: 1000, t13: 5000 };
  const OLD_TASK_POINTS = { t1: 50, t2: 20, t3: 30, t4: 20, t5: 10 };
  const MAX_TASK_POINTS = 5000;

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmt = (n) => Math.floor(n).toLocaleString();
  const money = (n) => '$' + (n || 0).toFixed(2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lsGet = (k) => {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  };
  const lsSet = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  };

  // ---------- state ----------
  const defaultState = () => ({
    points: 100, // first pack is on the house
    lifetimePoints: 100,
    packsOpened: 0,
    packCost: 100,
    collectorCost: 400, // Collector Boosters cost about 4x a regular pack
    stepsPerPoint: 10, // 10 steps = 1 point, so 1,000 steps = 1 pack
    steps: { date: today(), sensor: 0, manual: 0, credited: 0 },
    tasks: DEFAULT_TASKS.map((t) => ({ ...t, doneOn: null })),
    checkin: { last: null, streak: 0 },
    collection: {}, // id -> { n, f, firstAt, card }
    history: [],
    decks: [],
  });

  // Saves from before the rate changed used 100 steps per point. Switch them to 10.
  // steps.credited counts points already paid for today's steps, so keeping it as-is
  // back-pays today's steps at the new rate (minus what was already paid) on next load.
  function migrate(s, saved) {
    if (s.stepsPerPoint === 100) {
      s.stepsPerPoint = 10;
      s.rateBackpay = true;
    }
    // Task update 2: built-in tasks are worth 10x, plus the new daily tasks. Tasks you
    // already finished today get the difference; tasks you edited or added are left alone.
    if (saved && !saved.tasksV2) {
      const t = today();
      let backpay = 0;
      for (const task of s.tasks || []) {
        if (OLD_TASK_POINTS[task.id] && task.points === OLD_TASK_POINTS[task.id]) {
          const pts = task.points * 10;
          if (task.doneOn === t) backpay += pts - task.points;
          task.points = pts;
        }
      }
      const have = new Set((s.tasks || []).map((x) => x.name.trim().toLowerCase()));
      for (const d of DEFAULT_TASKS)
        if (!OLD_TASK_POINTS[d.id] && d.id !== 't13' && !have.has(d.name.toLowerCase()) && !(s.tasks || []).some((x) => x.id === d.id))
          s.tasks.push({ ...d, doneOn: null });
      if (backpay) s.taskBackpay = (s.taskBackpay || 0) + backpay;
    }
    s.tasksV2 = true;
    s.tasksV3 = true;
    // Goals are personal: drop built-in goals from older versions that were never checked off
    // (and still have their original points). Anything you've used or changed stays.
    if (saved && !saved.tasksV4) {
      // If any of them was ever checked off, this person uses them: keep them all.
      const used = (s.tasks || []).some((t) => RETIRED_TASKS[t.id] && t.doneOn);
      if (!used) s.tasks = (s.tasks || []).filter((t) => !(RETIRED_TASKS[t.id] && t.points === RETIRED_TASKS[t.id]));
    }
    s.tasksV4 = true;
    if (!saved) s.needsGoalSetup = true; // brand-new player: offer to pick goals
    return s;
  }

  function addMissingTasks(s, ids) {
    const have = new Set((s.tasks || []).map((x) => x.name.trim().toLowerCase()));
    for (const d of DEFAULT_TASKS)
      if (ids.includes(d.id) && !have.has(d.name.toLowerCase()) && !s.tasks.some((x) => x.id === d.id)) s.tasks.push({ ...d, doneOn: null });
  }

  const savedState = lsGet(STORE_KEY);
  let state = migrate(Object.assign(defaultState(), savedState || {}), savedState);
  const save = () => {
    if (!lsSet(STORE_KEY, state)) toast('Storage is full. Copy a backup!');
    try { window.PR && window.PR.onSave && window.PR.onSave(); } catch {}
  };

  const costFor = (type) => (type === 'collector' ? state.collectorCost : state.packCost);

  function rollDay() {
    if (state.steps.date !== today()) {
      state.steps = { date: today(), sensor: 0, manual: 0, credited: 0 };
      save();
    }
  }

  function addPoints(n, why) {
    if (n <= 0) return;
    state.points += n;
    state.lifetimePoints += n;
    save();
    renderPoints(true);
    if (why) toast(`+${n} ◆ ${why}`);
  }

  // ---------- toast / dialog ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  function dialog(html, onMount) {
    const d = $('#dialog');
    $('#dialogBox').innerHTML = html;
    d.classList.remove('hidden');
    const close = () => d.classList.add('hidden');
    d.onclick = (e) => { if (e.target === d) close(); };
    onMount && onMount(close);
  }

  // ---------- tabs ----------
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => showView(b.dataset.view))
  );
  const scrollPos = {};
  function showView(v) {
    const was = document.querySelector('.view.active');
    if (was) scrollPos[was.id] = window.scrollY;
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'open') loadSets();
    if (v === 'collection') renderCollection();
    if (v === 'earn') renderEarn();
    if (v === 'decks') window.PRDecks && window.PRDecks.render();
    if (v === 'friends') window.PRSocial && window.PRSocial.render();
    if (v === 'packwars') window.PRPackWars && window.PRPackWars.render();
    // Collection comes back where you left it; other tabs start at the top.
    window.scrollTo(0, v === 'collection' ? scrollPos['view-collection'] || 0 : 0);
  }

  // ---------- points ----------
  function renderPoints(bump) {
    $('#pointsVal').textContent = fmt(state.points);
    if (bump) {
      const c = $('#pointsChip');
      c.classList.remove('bump');
      void c.offsetWidth;
      c.classList.add('bump');
    }
    const pc = $('#packCostText');
    if (pc) pc.textContent = `${state.packCost} ◆ per pack`;
  }

  // ---------- steps ----------
  const stepsTotal = () => Math.max(state.steps.sensor, state.steps.manual);

  function creditSteps() {
    rollDay();
    const earned = Math.floor(stepsTotal() / state.stepsPerPoint);
    const due = earned - state.steps.credited;
    if (due > 0) {
      state.steps.credited = earned;
      state.points += due;
      state.lifetimePoints += due;
      save();
      renderPoints(true);
    }
    return due;
  }

  function renderSteps() {
    const total = stepsTotal();
    $('#stepsToday').textContent = fmt(total);
    const per = state.stepsPerPoint;
    const into = total % per;
    $('#stepProgress').style.width = (into / per) * 100 + '%';
    $('#stepRate').textContent = `${per} steps = 1 ◆`;
    const toPack = state.packCost * per;
    $('#stepNext').textContent = `${per - into} steps to next point · ${fmt(toPack)} steps earns a whole pack`;
  }

  // Simple pedometer: peaks in acceleration magnitude.
  const walk = { on: false, lastPeak: 0, avg: 9.8, above: false, wake: null, session: 0 };

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    walk.avg = walk.avg * 0.9 + mag * 0.1; // slow baseline
    const dev = mag - walk.avg;
    const now = performance.now();
    if (!walk.above && dev > 1.4 && now - walk.lastPeak > 280) {
      walk.above = true;
      walk.lastPeak = now;
      rollDay();
      state.steps.sensor += 1;
      walk.session += 1;
      if (walk.session % 10 === 0) save();
      if (creditSteps() > 0) {
        /* points chip bumps */
      }
      renderSteps();
      $('#walkStatus').textContent = `Tracking… ${fmt(walk.session)} steps this walk. Keep the app open.`;
    } else if (walk.above && dev < 0.4) {
      walk.above = false;
    }
  }

  async function toggleWalk() {
    const btn = $('#walkBtn');
    if (walk.on) {
      window.removeEventListener('devicemotion', onMotion);
      walk.on = false;
      try { walk.wake && (await walk.wake.release()); } catch {}
      walk.wake = null;
      save();
      btn.textContent = 'Start walk tracking';
      btn.classList.add('primary');
      $('#walkStatus').textContent = `Walk saved: ${fmt(walk.session)} steps.`;
      walk.session = 0;
      return;
    }
    if (typeof DeviceMotionEvent === 'undefined') {
      $('#walkStatus').textContent = "This browser can't read the motion sensor. Use “Sync from your Health app” below.";
      return;
    }
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          $('#walkStatus').textContent = 'Motion access was denied. You can allow it in Settings › Safari, or sync from Health instead.';
          return;
        }
      } catch {
        $('#walkStatus').textContent = 'Motion access could not be requested here. Sync from your Health app instead.';
        return;
      }
    }
    window.addEventListener('devicemotion', onMotion);
    walk.on = true;
    walk.session = 0;
    try { if ('wakeLock' in navigator) walk.wake = await navigator.wakeLock.request('screen'); } catch {}
    btn.textContent = 'Stop walk tracking';
    btn.classList.remove('primary');
    $('#walkStatus').textContent = 'Tracking… start walking! Keep the app open with your phone in hand or pocket.';
    // If no events arrive, tell the user.
    setTimeout(() => {
      if (walk.on && walk.session === 0 && walk.avg === 9.8) {
        $('#walkStatus').textContent = 'No motion data yet. Your browser may block the sensor. Try syncing from Health.';
      }
    }, 4000);
  }
  $('#walkBtn').addEventListener('click', toggleWalk);

  $('#manualStepsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    rollDay();
    const v = Math.min(200000, Math.max(0, parseInt($('#manualSteps').value, 10) || 0));
    if (v <= stepsTotal()) {
      toast(`Already counted ${fmt(stepsTotal())} steps today`);
      return;
    }
    state.steps.manual = v;
    const due = creditSteps();
    $('#manualSteps').value = '';
    renderSteps();
    toast(due > 0 ? `+${due} ◆ for your steps` : 'Steps synced');
  });

  // ---------- tasks ----------
  let editingTasks = false;
  function renderTasks() {
    const t = today();
    $('#taskList').innerHTML = state.tasks
      .map((task) => {
        const done = task.doneOn === t;
        return `<li class="task ${done ? 'done' : ''}" data-id="${esc(task.id)}">
          <button class="task-check" ${done ? 'disabled' : ''} aria-label="Complete">${done ? '✓' : ''}</button>
          <span class="task-name">${esc(task.name)}${editingTasks ? ' <small class="muted">✎</small>' : ''}</span>
          <span class="task-pts">+${task.points.toLocaleString()}</span>
          ${editingTasks ? '<button class="task-del" aria-label="Delete">✕</button>' : ''}
        </li>`;
      })
      .join('') || '<li class="muted">No tasks yet. Tap Edit to add some.</li>';
    $('#addTaskForm').classList.toggle('hidden', !editingTasks);
    $('#editTasksBtn').textContent = editingTasks ? 'Done' : 'Edit';
  }
  $('#taskList').addEventListener('click', (e) => {
    const li = e.target.closest('.task');
    if (!li) return;
    const task = state.tasks.find((x) => x.id === li.dataset.id);
    if (!task) return;
    if (e.target.closest('.task-del')) {
      state.tasks = state.tasks.filter((x) => x !== task);
      save();
      renderTasks();
      return;
    }
    if (editingTasks && !e.target.closest('.task-check')) return editTask(task);
    if (e.target.closest('.task-check') && task.doneOn !== today()) {
      task.doneOn = today();
      addPoints(task.points, task.name);
      renderTasks();
    }
  });
  function editTask(task) {
    dialog(
      `<h3>Edit task</h3>
      <form id="etForm" class="col">
        <input id="etName" maxlength="60" value="${esc(task.name)}" required>
        <label class="small muted" style="text-align:left">Points (up to ${MAX_TASK_POINTS.toLocaleString()})
          <input id="etPts" type="number" inputmode="numeric" min="1" max="${MAX_TASK_POINTS}" value="${task.points}" required></label>
        <div class="row"><button type="button" class="btn" id="etCancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </form>`,
      (close) => {
        $('#etCancel').onclick = close;
        $('#etForm').onsubmit = (ev) => {
          ev.preventDefault();
          const name = $('#etName').value.trim();
          if (!name) return;
          task.name = name;
          task.points = Math.min(MAX_TASK_POINTS, Math.max(1, parseInt($('#etPts').value, 10) || task.points));
          save();
          close();
          renderTasks();
        };
      }
    );
  }
  function addGoalSheet() {
    let pts = 250;
    dialog(
      `<h3>Add a goal</h3>
      <p class="muted small">Your goals are private: they stay on this phone. Friends never see them.</p>
      <form id="agForm" class="col">
        <input id="agName" placeholder="What do you want to do every day?" maxlength="60" required>
        <div class="chips" id="agIdeas">${GOAL_IDEAS.filter((g) => !state.tasks.some((t) => t.name.toLowerCase() === g.toLowerCase()))
          .map((g) => `<button type="button" class="chip-btn" data-idea="${esc(g)}">${esc(g)}</button>`)
          .join('')}</div>
        <p class="muted small" style="text-align:left;margin:4px 0 0">Points for finishing it</p>
        <div class="chips" id="agPts">${GOAL_POINTS.map((p) => `<button type="button" class="chip-btn ${p === pts ? 'on' : ''}" data-p="${p}">${p.toLocaleString()} ◆</button>`).join('')}
          <input id="agCustom" type="number" inputmode="numeric" min="1" max="${MAX_TASK_POINTS}" placeholder="Other" class="chip-input"></div>
        <div class="row"><button type="button" class="btn" id="agCancel">Cancel</button><button class="btn primary" type="submit">Add goal</button></div>
      </form>`,
      (close) => {
        $('#agCancel').onclick = close;
        document.querySelectorAll('#agIdeas [data-idea]').forEach((b) => (b.onclick = () => ($('#agName').value = b.dataset.idea)));
        document.querySelectorAll('#agPts [data-p]').forEach(
          (b) =>
            (b.onclick = () => {
              pts = Number(b.dataset.p);
              $('#agCustom').value = '';
              document.querySelectorAll('#agPts [data-p]').forEach((x) => x.classList.toggle('on', x === b));
            })
        );
        $('#agCustom').oninput = () => document.querySelectorAll('#agPts [data-p]').forEach((x) => x.classList.remove('on'));
        $('#agForm').onsubmit = (e) => {
          e.preventDefault();
          const name = $('#agName').value.trim();
          if (!name) return;
          const custom = parseInt($('#agCustom').value, 10);
          const points = Math.min(MAX_TASK_POINTS, Math.max(1, custom || pts));
          state.tasks.push({ id: 't' + Date.now(), name, points, doneOn: null });
          save();
          close();
          renderTasks();
          toast(`Added: ${name} (+${points.toLocaleString()} ◆)`);
        };
      }
    );
  }
  $('#addGoalBtn').addEventListener('click', addGoalSheet);

  /** First launch: pick the goals you want (all optional, editable later). */
  function goalSetup() {
    const picked = new Set(['Workout 30 minutes', 'Read 20 minutes', 'Make your bed']);
    const draw = () => {
      $('#dialogBox').querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('on', picked.has(b.dataset.g)));
      $('#gsGo').textContent = picked.size ? `Use ${picked.size} goal${picked.size === 1 ? '' : 's'}` : 'Skip for now';
    };
    dialog(
      `<h3>Pick your daily goals</h3>
      <p class="muted small">Finish them each day to earn ◆ for packs. They're private to you, and you can change them anytime on the Earn tab.</p>
      <div class="chips">${GOAL_IDEAS.map((g) => `<button type="button" class="chip-btn" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>
      <p class="muted small">Don't see yours? Add your own with “+ Add a goal” after this.</p>
      <button class="btn primary wide" id="gsGo">Use goals</button>`,
      (close) => {
        $('#dialogBox').querySelectorAll('[data-g]').forEach(
          (b) =>
            (b.onclick = () => {
              picked.has(b.dataset.g) ? picked.delete(b.dataset.g) : picked.add(b.dataset.g);
              draw();
            })
        );
        $('#gsGo').onclick = () => {
          const pointsFor = (g) => (DEFAULT_TASKS.find((d) => d.name === g) || {}).points || 250;
          state.tasks = [...picked].map((g, i) => ({ id: 'g' + Date.now() + i, name: g, points: pointsFor(g), doneOn: null }));
          delete state.needsGoalSetup;
          save();
          close();
          renderTasks();
        };
        draw();
      }
    );
  }

  $('#editTasksBtn').addEventListener('click', () => {
    editingTasks = !editingTasks;
    renderTasks();
  });
  $('#addTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#newTaskName').value.trim();
    const pts = Math.min(MAX_TASK_POINTS, Math.max(1, parseInt($('#newTaskPts').value, 10) || 10));
    if (!name) return;
    state.tasks.push({ id: 't' + Date.now(), name, points: pts, doneOn: null });
    $('#newTaskName').value = '';
    save();
    renderTasks();
  });

  // ---------- check-in ----------
  function renderCheckin() {
    const c = state.checkin;
    const claimed = c.last === today();
    const btn = $('#checkinBtn');
    btn.disabled = claimed;
    const nextStreak = c.last === yesterday() ? c.streak + 1 : 1;
    const bonus = checkinBonus(claimed ? c.streak : nextStreak);
    btn.textContent = claimed ? 'Claimed today ✓' : `Claim +${bonus} ◆`;
    $('#streakText').textContent =
      (c.streak > 0 && (claimed || c.last === yesterday()) ? `🔥 ${c.streak}-day streak. ` : '') +
      'Bonus grows +5 each day of your streak (max 50).';
  }
  const checkinBonus = (streak) => Math.min(50, 10 + (streak - 1) * 5);
  // ---------- gift codes ----------
  // Only a SHA-256 fingerprint of each code is stored here, so the codes can't be read
  // from the app's files. Each code works once per phone.
  const GIFT_CODES = {
    '80fa5fbee6c8ed968b19d64f60eb6d876b46a02d488c5ea3a3219068b00ebdbe': { id: 'g1', points: 1000 },
  };
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  $('#giftForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#giftCode').value.trim().toUpperCase().replace(/\s+/g, '');
    if (!code) return;
    let gift = null;
    try {
      gift = GIFT_CODES[await sha256(code)];
    } catch {
      return toast("This browser can't check codes");
    }
    if (!gift) return toast("That code isn't valid");
    state.giftsUsed = state.giftsUsed || [];
    if (state.giftsUsed.includes(gift.id)) return toast('You already used that code');
    state.giftsUsed.push(gift.id);
    addPoints(gift.points, 'gift code');
    $('#giftCode').value = '';
    if (window.PRSound) window.PRSound.dings();
  });

  $('#checkinBtn').addEventListener('click', () => {
    const c = state.checkin;
    if (c.last === today()) return;
    c.streak = c.last === yesterday() ? c.streak + 1 : 1;
    c.last = today();
    addPoints(checkinBonus(c.streak), `Day ${c.streak} check-in`);
    renderCheckin();
  });

  function renderEarn() {
    rollDay();
    renderSteps();
    renderTasks();
    renderCheckin();
  }

  // ---------- Scryfall ----------
  let lastReq = 0;
  async function scry(url) {
    const wait = 110 - (Date.now() - lastReq); // stay under Scryfall's rate limit
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok && r.status !== 404) throw new Error('Scryfall error ' + r.status);
    return r.json();
  }

  let sets = null; // Magic sets (Scryfall)
  let pkSets = null; // Pokémon sets (TCGdex)
  let game = (() => {
    try { return localStorage.getItem('packripped:game') || 'magic'; } catch { return 'magic'; }
  })();
  const shownSets = () => (game === 'pokemon' ? pkSets : sets);

  function setGame(g) {
    game = g;
    try { localStorage.setItem('packripped:game', g); } catch {}
    document.querySelectorAll('#gameSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.game === g));
    $('#openPackWars').classList.toggle('hidden', g !== 'magic');
    // Squishies have their own screen instead of a set list.
    const squish = g === 'squishy';
    $('#openRandom').classList.toggle('hidden', squish);
    $('#setPanel').classList.toggle('hidden', squish);
    $('#squishRoot').classList.toggle('hidden', !squish);
    if (squish) return window.PRSquish && window.PRSquish.render();
    $('#randomSub').textContent = g === 'pokemon' ? 'A surprise Pokémon set' : 'A surprise set. 1 in 5 is a Collector Booster!';
    $('#setSearch').value = '';
    loadSets();
  }
  document.querySelectorAll('#gameSwitch button').forEach((b) => (b.onclick = () => setGame(b.dataset.game)));

  async function loadPokemonSets() {
    if (!pkSets) {
      $('#setList').innerHTML = '<p class="muted">Loading Pokémon sets…</p>';
      try {
        pkSets = await window.Pokemon.loadSets();
      } catch {
        $('#setList').innerHTML = `<p class="muted">Couldn't load Pokémon sets. Check your connection and try again.</p>
          <button class="btn" id="retrySets">Retry</button>`;
        $('#retrySets').onclick = loadSets;
        return;
      }
    }
    if (game === 'pokemon') renderSets();
  }

  async function loadSets() {
    renderPoints();
    if (game === 'squishy') return window.PRSquish && window.PRSquish.render();
    if (game === 'pokemon') return loadPokemonSets();
    if (sets) return renderSets();
    const cached = lsGet(SETS_KEY);
    if (cached && Date.now() - cached.at < 86400000) {
      sets = cached.sets;
      return renderSets();
    }
    try {
      const res = await scry(API + '/sets');
      const t = today();
      sets = res.data
        .filter(
          (s) =>
            ['expansion', 'core', 'draft_innovation'].includes(s.set_type) &&
            !s.digital &&
            s.released_at &&
            s.released_at <= t &&
            s.card_count >= 100 &&
            !/jumpstart|mystery|starter|two-player|anthology/i.test(s.name) &&
            !NO_BOOSTERS.includes(s.code)
        )
        .map((s) => ({ code: s.code, name: s.name, released: s.released_at, icon: s.icon_svg_uri, count: s.card_count }));
      lsSet(SETS_KEY, { at: Date.now(), sets });
      renderSets();
    } catch (err) {
      $('#setList').innerHTML = `<p class="muted">Couldn't load sets. Check your connection and try again.</p>
        <button class="btn" id="retrySets">Retry</button>`;
      $('#retrySets').onclick = loadSets;
    }
  }

  function renderSets() {
    const all = shownSets();
    if (!all) return;
    const q = $('#setSearch').value.trim().toLowerCase();
    const list = all.filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.includes(q));
    const canAfford = state.points >= state.packCost;
    $('#setList').innerHTML =
      list
        .map(
          (s) => `<button class="set-item" data-code="${esc(s.code)}">
          <img class="set-icon ${s.game === 'pokemon' ? 'pk' : ''}" src="${esc(s.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span class="set-meta"><b>${esc(s.name)}</b>
          <small>${
            s.game === 'pokemon'
              ? `${esc(s.series)} · Booster Pack`
              : `${esc(s.released.slice(0, 4))} · ${ODDS[boosterTypeFor(s.released)].name}${hasCollector(s.released) ? ' · <span class="cb-badge">Collector</span>' : ''}`
          }</small></span>
          <span class="set-cost ${canAfford ? '' : 'poor'}">${state.packCost} ◆</span>
        </button>`
        )
        .join('') || '<p class="muted">No sets match.</p>';
  }
  $('#setSearch').addEventListener('input', () => shownSets() && renderSets());
  $('#setList').addEventListener('click', (e) => {
    const b = e.target.closest('.set-item');
    if (b) confirmOpen(shownSets().find((s) => s.code === b.dataset.code));
  });

  function slimCard(c) {
    const img = c.image_uris || (c.card_faces && c.card_faces[0].image_uris) || {};
    return {
      id: c.id,
      name: c.name,
      set: c.set,
      setName: c.set_name,
      num: c.collector_number,
      rarity: c.rarity,
      type: c.type_line,
      img: img.normal || img.large || img.small || '',
      usd: parseFloat(c.prices && c.prices.usd) || 0,
      usdFoil: parseFloat(c.prices && c.prices.usd_foil) || 0,
      basic: /Basic Land/.test(c.type_line || ''),
      uri: c.scryfall_uri,
      treat: treatment(c),
      ...window.Commander.cardFlags(c),
    };
  }

  function treatment(c) {
    const fx = c.frame_effects || [];
    if (fx.includes('extendedart')) return 'Extended art';
    if (c.border_color === 'borderless') return 'Borderless';
    if (fx.includes('showcase')) return 'Showcase';
    if (c.full_art && !/Basic Land/.test(c.type_line || '')) return 'Full art';
    return '';
  }

  async function searchAll(q, onCard, onProgress) {
    let url = `${API}/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=set`;
    let n = 0;
    while (url) {
      const res = await scry(url);
      if (res.object === 'error') break;
      res.data.forEach((raw) => onCard(slimCard(raw), raw));
      n += res.data.length;
      onProgress && onProgress(n, res.total_cards);
      url = res.has_more ? res.next_page : null;
    }
  }

  async function loadPool(code, onProgress, withAlt) {
    const cached = lsGet(POOL_PREFIX + code);
    const fresh = cached && Date.now() - cached.at < 7 * 86400000;
    if (fresh && (!withAlt || cached.pool.altLoaded)) return cached.pool;
    let pool;
    if (fresh) pool = cached.pool;
    else {
      const empty = () => ({ common: [], uncommon: [], rare: [], mythic: [], basic: [] });
      const addTo = (p) => (c) => {
        if (c.basic) p.basic.push(c);
        else if (p[c.rarity]) p[c.rarity].push(c);
        else if (c.rarity === 'special' || c.rarity === 'bonus') p.rare.push(c);
      };
      pool = empty();
      await searchAll(`set:${code} is:booster game:paper`, addTo(pool), onProgress);
      if (pool.common.length < 20 || !pool.rare.length) {
        // Scryfall hasn't tagged which cards come in boosters yet (common for the newest
        // sets). Use the set's regular cards instead: numbered cards with the normal frame,
        // leaving out promos and the special-art versions.
        pool = empty();
        const add = addTo(pool);
        await searchAll(`set:${code} game:paper -is:promo -is:serialized`, (c, raw) => {
          const fx = raw.frame_effects || [];
          const special =
            !/^\d+$/.test(raw.collector_number) ||
            fx.includes('showcase') || fx.includes('extendedart') ||
            raw.border_color === 'borderless' ||
            (raw.full_art && !c.basic);
          if (!special) add(c);
        }, onProgress);
      }
      if (pool.common.length < 20 || !pool.rare.length) return null;
    }
    if (withAlt) {
      // Extended-art, borderless and showcase versions found in Collector Boosters.
      pool.altCU = []; pool.altR = []; pool.altM = [];
      await searchAll(
        `set:${code} game:paper -type:basic -is:promo -is:serialized (is:extendedart OR border:borderless OR frame:showcase)`,
        (c) => {
          if (c.rarity === 'mythic') pool.altM.push(c);
          else if (c.rarity === 'rare' || c.rarity === 'special') pool.altR.push(c);
          else if (c.rarity === 'common' || c.rarity === 'uncommon') pool.altCU.push(c);
        },
        (n, t) => onProgress && onProgress(n, t, 'special')
      );
      pool.altLoaded = true;
    }
    // Keep only the 6 most recently used pools to save space.
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(POOL_PREFIX));
      if (keys.length >= 6) {
        keys
          .map((k) => [k, (lsGet(k) || {}).at || 0])
          .sort((a, b) => a[1] - b[1])
          .slice(0, keys.length - 5)
          .forEach(([k]) => localStorage.removeItem(k));
      }
    } catch {}
    lsSet(POOL_PREFIX + code, { at: Date.now(), pool });
    return pool;
  }

  // ---------- opening packs ----------
  function confirmOpen(set, chosen) {
    if (set.game === 'pokemon') return confirmOpenPokemon(set);
    const base = boosterTypeFor(set.released);
    const type = chosen || base;
    const o = ODDS[type];
    const cost = costFor(type);
    const can = state.points >= cost;
    const tabs = hasCollector(set.released)
      ? `<div class="seg">
          <button data-type="${base}" class="${type === base ? 'on' : ''}">${ODDS[base].name}<small>${state.packCost} ◆</small></button>
          <button data-type="collector" class="${type === 'collector' ? 'on' : ''}">Collector Booster<small>${state.collectorCost} ◆</small></button>
        </div>`
      : '';
    dialog(
      `<img class="set-icon big" src="${esc(set.icon)}" alt="">
      <h3>${esc(set.name)}</h3>
      ${tabs}
      <p class="muted">${o.name} · ${o.cards} cards</p>
      <table class="odds">${o.slots.map(([n, d]) => `<tr><td>${n}</td><td>${esc(d)}</td></tr>`).join('')}</table>
      <p class="muted small">${type === 'collector'
        ? "Collector Booster contents differ from set to set. This uses the typical layout, with the set's real extended-art, borderless and showcase cards."
        : "Odds are based on Wizards of the Coast's published pack contents, so they're approximate."}</p>
      <div class="row">
        <button class="btn" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="open" ${can ? '' : 'disabled'}>${
        can ? `Rip it! (${cost} ◆)` : `Need ${cost - state.points} more ◆`
      }</button>
      </div>`,
      (close) => {
        $('#dialogBox').querySelector('[data-act=cancel]').onclick = close;
        $('#dialogBox').querySelectorAll('.seg button').forEach((b) => (b.onclick = () => confirmOpen(set, b.dataset.type)));
        $('#dialogBox').querySelector('[data-act=open]').onclick = () => {
          close();
          ripPack(set, type);
        };
      }
    );
  }

  function confirmOpenPokemon(set) {
    const cost = costFor('pokemon');
    const can = state.points >= cost;
    const slots = window.Pokemon.SLOTS[set.era] || window.Pokemon.SLOTS.sv;
    dialog(
      `${set.logo ? `<img class="pk-logo" src="${esc(set.logo)}" alt="" onerror="this.remove()">` : ''}
      <h3>${esc(set.name)}</h3>
      <p class="muted">${esc(set.series)} · Booster Pack · 10 cards</p>
      <table class="odds">${slots.map(([n, d]) => `<tr><td>${n}</td><td>${esc(d)}</td></tr>`).join('')}</table>
      <p class="muted small">The Pokémon Company doesn't publish pull rates, so these are approximate, based on community pull-rate studies. Card data from TCGdex, prices from TCGplayer.</p>
      <div class="row">
        <button class="btn" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="open" ${can ? '' : 'disabled'}>${can ? `Rip it! (${cost} ◆)` : `Need ${cost - state.points} more ◆`}</button>
      </div>`,
      (close) => {
        $('#dialogBox').querySelector('[data-act=cancel]').onclick = close;
        $('#dialogBox').querySelector('[data-act=open]').onclick = () => {
          close();
          ripPack(set, 'pokemon');
        };
      }
    );
  }

  let ripping = false;
  let ripDone = null; // set when another feature (Pack Wars) wants the pulled cards back
  let ripBlind = false; // Pack Wars: rip it, but don't look at the cards
  let ripRandomPack = false; // the 50-point random pack
  const RANDOM_COST = 50;
  const RANDOM_COLLECTOR_CHANCE = 0.2; // 1 in 5 random packs is a Collector Booster (when the set has them)
  async function ripPack(set, type, onDone, opts) {
    const cost = opts && opts.cost != null ? opts.cost : costFor(type);
    if (ripping || state.points < cost) return;
    ripping = true;
    ripDone = onDone || null;
    ripBlind = !!(opts && opts.blind);
    ripRandomPack = !!(opts && opts.random);
    const ov = $('#packOverlay');
    const stage = $('#packStage');
    ov.classList.remove('hidden');
    stage.innerHTML = `<div class="loading"><div class="spinner"></div><p id="loadMsg">Shuffling ${esc(set.name)}…</p></div>`;
    let pool;
    const pokemon = set.game === 'pokemon';
    try {
      pool = pokemon
        ? await window.Pokemon.loadPool(set, (n, t) => {
            const m = $('#loadMsg');
            if (m) m.textContent = `Loading cards… ${Math.round((n / t) * 100)}%`;
          })
        : await loadPool(set.code, (n, t, what) => {
            const m = $('#loadMsg');
            if (m) m.textContent = `Loading ${what === 'special' ? 'special versions' : 'cards'}… ${n}/${t}`;
          }, type === 'collector');
    } catch (e) {
      pool = null;
    }
    if (!pool && ripRandomPack && (opts.tries || 0) < 4) {
      // That set couldn't be loaded; quietly pick another random one.
      ripping = false;
      return ripRandom((opts.tries || 0) + 1);
    }
    if (!pool) {
      stage.innerHTML = `<div class="loading"><p>Couldn't load cards for this set. Check your connection and try again, or pick another set.</p>
        <button class="btn" id="closeErr">Close</button></div>`;
      $('#closeErr').onclick = () => {
        ov.classList.add('hidden');
        const cb = ripDone;
        ripDone = null;
        if (cb) cb(null);
      };
      ripping = false;
      return;
    }

    const pulls = pokemon ? window.Pokemon.openPack(pool, set.era) : openPack(pool, type);
    if (pokemon) {
      const m = $('#loadMsg');
      if (m) m.textContent = 'Checking prices…';
      await window.Pokemon.fillDetails([...new Set(pulls.map((p) => p.card))], 8000);
    }
    // Pay & record before reveal, so closing the app mid-reveal doesn't lose cards.
    state.points -= cost;
    state.packsOpened += 1;
    const now = Date.now();
    for (const p of pulls) {
      const e = state.collection[p.card.id] || (state.collection[p.card.id] = { n: 0, f: 0, firstAt: now, card: p.card });
      e.card = p.card;
      e.lastAt = now;
      if (p.foil) e.f += 1;
      else e.n += 1;
    }
    const value = pulls.reduce((s, p) => s + cardPrice(p.card, p.foil), 0);
    state.history.unshift({
      at: now,
      set: set.code,
      setName: set.name,
      type,
      game: set.game || 'magic',
      value,
      best: bestPull(pulls).card.name,
      cards: pulls.map((p) => [p.card.id, p.foil ? 1 : 0]),
    });
    state.history = state.history.slice(0, 30);
    save();
    renderPoints(true);

    showPackFront(set, pulls, value, type);
  }

  const cardPrice = (c, foil) => (foil ? c.usdFoil || c.usd : c.usd || c.usdFoil) || 0;
  function bestPull(pulls) {
    return pulls.reduce((best, p) => {
      const sc = (x) => RARITY_ORDER[x.card.rarity] * 1000 + cardPrice(x.card, x.foil);
      return sc(p) > sc(best) ? p : best;
    });
  }

  function showPackFront(set, pulls, value, type) {
    const stage = $('#packStage');
    stage.innerHTML = `
      <div class="pack ${type === 'collector' ? 'collector' : ''} ${type === 'pokemon' ? 'pokemon' : ''}" id="pack">
        <div class="pack-top"></div>
        <div class="pack-body">
          ${set.game === 'pokemon' ? '' : `<img src="${esc(set.icon)}" alt="">`}
          <div class="pack-name">${esc(set.name)}</div>
          <div class="pack-type">${ripRandomPack ? '🎲 Random pack · ' : ''}${ODDS[type].name}</div>
          ${set.game === 'pokemon' && set.logo ? `<img class="pk-logo" src="${esc(set.logo)}" alt="" onerror="this.remove()">` : ''}
        </div>
      </div>
      <p class="hint">${ripBlind ? 'Tap to rip it open. No peeking: the cards go straight into your deck, face down.' : 'Tap the pack to rip it open'}</p>`;
    const pack = $('#pack');
    pack.onclick = async () => {
      pack.onclick = null;
      pack.classList.add('ripping');
      if (window.PRSound) window.PRSound.shake(); // coins rattling as the pack tears
      if (window.PRFx) {
        window.PRFx.flash();
        window.PRFx.burstFrom(pack, { count: type === 'collector' ? 220 : 150, power: type === 'collector' ? 16 : 13 });
      }
      if (navigator.vibrate) navigator.vibrate(30);
      await sleep(650);
      if (ripBlind && ripDone) {
        $('#packOverlay').classList.add('hidden');
        ripping = false;
        const cb = ripDone;
        ripDone = null;
        return cb(pulls);
      }
      revealCards(set, pulls, value, type);
    };
  }

  function revealCards(set, pulls, value, type) {
    const stage = $('#packStage');
    let i = 0;
    stage.innerHTML = `
      <div class="reveal-count" id="revCount"></div>
      <div class="reveal-card-wrap" id="revWrap"></div>
      <p class="hint" id="revHint">Tap to flip</p>
      <div class="row center">
        <button class="btn" id="revAll">Reveal all</button>
      </div>`;
    const wrap = $('#revWrap');

    const showOne = () => {
      const p = pulls[i];
      const ownedBefore = isNewPull(p, pulls, i);
      $('#revCount').textContent = `${i + 1} / ${pulls.length}`;
      wrap.innerHTML = `
        <div class="flip ${p.card.rarity} ${p.foil ? 'is-foil' : ''}">
          <div class="flip-inner">
            <div class="flip-back"><div class="cardback"></div></div>
            <div class="flip-front">
              <img src="${esc(p.card.img)}" alt="${esc(p.card.name)}">
              ${p.foil ? '<div class="foil-sheen"></div>' : ''}
            </div>
          </div>
        </div>
        <div class="pull-info">
          <span class="rarity-dot ${p.card.rarity}"></span>
          <b>${esc(p.card.name)}</b>${p.foil ? ' <span class="foil-tag">FOIL</span>' : ''}
          ${ownedBefore ? '<span class="new-tag">NEW</span>' : ''}
          <div class="muted small">${rarityText(p.card)}${p.card.treat ? ' · ' + esc(p.card.treat) : ''} · ${money(cardPrice(p.card, p.foil))}</div>
        </div>`;
      const flip = wrap.querySelector('.flip');
      // Hold rares/mythics a moment longer for suspense.
      const big = p.card.rarity === 'mythic' || p.card.rarity === 'rare';
      wrap.querySelector('.pull-info').style.visibility = 'hidden';
      requestAnimationFrame(() =>
        setTimeout(() => {
          flip.classList.add('flipped');
          const tierHit = window.PRSound ? window.PRSound.forCard(p.card, cardPrice(p.card, p.foil)) : ''; // coins / ka-ching / dings
          if (window.PRFx && tierHit === 'huge') window.PRFx.goldShower();
          else if (window.PRFx && tierHit === 'big') window.PRFx.burstFrom(flip, { count: 60, colors: ['#ffd84d', '#ffb347', '#ffffff'], power: 10 });
          if (big && navigator.vibrate) navigator.vibrate(p.card.rarity === 'mythic' ? [40, 60, 80] : 40);
          setTimeout(() => (wrap.querySelector('.pull-info').style.visibility = 'visible'), 300);
        }, big ? 450 : 60)
      );
      $('#revHint').textContent = i === pulls.length - 1 ? 'Tap for summary' : 'Tap for next card';
    };

    const next = () => {
      if (window.PRSound) window.PRSound.wake(); // keep audio awake: this runs inside the tap
      i += 1;
      if (i >= pulls.length) showSummary(set, pulls, value, type);
      else showOne();
    };
    wrap.onclick = next;
    $('#revHint').onclick = next;
    $('#revAll').onclick = () => {
      // Skipping ahead: still celebrate the best card you hadn't seen yet.
      const rest = pulls.slice(i + 1);
      if (rest.length && window.PRSound) {
        const best = bestPull(rest);
        window.PRSound.forCard(best.card, cardPrice(best.card, best.foil));
      }
      showSummary(set, pulls, value, type);
    };
    showOne();
  }

  // Was this the first copy of this card we ever got (counting earlier cards in this same pack)?
  function isNewPull(p, pulls, idx) {
    const e = state.collection[p.card.id];
    if (!e) return false;
    const sameInPack = pulls.filter((x) => x.card.id === p.card.id);
    const total = e.n + e.f;
    if (total > sameInPack.length) return false;
    return pulls.findIndex((x) => x.card.id === p.card.id) === idx;
  }

  function showSummary(set, pulls, value, type) {
    const random = ripRandomPack;
    const cost = random ? RANDOM_COST : costFor(type);
    const stage = $('#packStage');
    const best = bestPull(pulls);
    const sorted = pulls.slice().sort(
      (a, b) => RARITY_ORDER[b.card.rarity] - RARITY_ORDER[a.card.rarity] || cardPrice(b.card, b.foil) - cardPrice(a.card, a.foil)
    );
    stage.innerHTML = `
      <div class="summary">
        <h3>${esc(set.name)}</h3>
        <p class="muted small">${ODDS[type].name}</p>
        <p class="muted">Pack value <b class="val">${money(value)}</b> · Best: ${esc(best.card.name)}</p>
        <div class="grid small-grid">
          ${sorted
            .map(
              (p) => `<div class="mini ${p.card.rarity} ${p.foil ? 'is-foil' : ''}" data-id="${esc(p.card.id)}">
              <img src="${esc(thumb(p.card.img))}" alt="${esc(p.card.name)}" loading="lazy">
              ${p.foil ? '<div class="foil-sheen"></div>' : ''}
            </div>`
            )
            .join('')}
        </div>
        <p class="muted small">All ${pulls.length} cards were added to your collection.</p>
        ${
          ripDone
            ? '<div class="row center"><button class="btn primary" id="sumContinue">Build my Pack Wars deck →</button></div>'
            : `<div class="row center">
          <button class="btn" id="sumDone">Done</button>
          <button class="btn primary" id="sumAgain" ${state.points >= cost ? '' : 'disabled'}>
            ${state.points >= cost ? `${random ? 'Another random pack' : 'Rip another'} (${cost} ◆)` : `Need ${cost - state.points} ◆`}
          </button>
        </div>`
        }
      </div>`;
    stage.querySelectorAll('.mini').forEach((m) => (m.onclick = () => showCard(m.dataset.id)));
    if (ripDone) {
      $('#sumContinue').onclick = () => {
        $('#packOverlay').classList.add('hidden');
        ripping = false;
        const cb = ripDone;
        ripDone = null;
        cb(pulls);
      };
      return;
    }
    $('#sumDone').onclick = () => {
      $('#packOverlay').classList.add('hidden');
      ripping = false;
      renderSets();
    };
    $('#sumAgain').onclick = () => {
      ripping = false;
      if (random) ripRandom();
      else ripPack(set, type);
    };
  }

  /** 🎲 A regular pack from a random set, for 50 points. */
  async function ripRandom(tries) {
    if (state.points < RANDOM_COST) return toast(`You need ${RANDOM_COST} ◆ for a random pack`);
    if (game === 'pokemon') {
      if (!pkSets) await loadPokemonSets();
      if (!pkSets || !pkSets.length) return toast("Couldn't load Pokémon sets. Check your connection.");
      const ps = pkSets[Math.floor(Math.random() * pkSets.length)];
      return ripPack(ps, 'pokemon', null, { cost: RANDOM_COST, random: true, tries: tries || 0 });
    }
    if (!sets) await loadSets();
    if (!sets || !sets.length) return toast("Couldn't load the set list. Check your connection.");
    // Roll the pack type first, so 1 in 5 random packs really is a Collector Booster.
    const collector = Math.random() < RANDOM_COLLECTOR_CHANCE;
    const pool = collector ? sets.filter((x) => hasCollector(x.released)) : sets;
    const set = pool[Math.floor(Math.random() * pool.length)];
    const type = collector ? 'collector' : boosterTypeFor(set.released);
    ripPack(set, type, null, { cost: RANDOM_COST, random: true, tries: tries || 0 });
  }
  $('#openRandom').addEventListener('click', () => ripRandom());

  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  /** Smaller image for grids: Scryfall 'small' (~14 KB) / TCGdex 'low' instead of the full-size picture. */
  const thumb = (u) =>
    !u || u.startsWith('data:') ? u || '' : u.replace('/normal/', '/small/').replace('/large/', '/small/').replace(/\/high\.webp$/, '/low.webp');
  const rarityText = (c) => c.rarityLabel || cap(c.rarity);

  // ---------- collection ----------
  function entries() {
    return Object.values(state.collection);
  }

  let folder = 'all';
  let lastGridKey = null;
  document.querySelectorAll('#collFolders button').forEach(
    (b) =>
      (b.onclick = () => {
        folder = b.dataset.folder;
        document.querySelectorAll('#collFolders button').forEach((x) => x.classList.toggle('on', x === b));
        renderCollection();
      })
  );
  const gameOf = (c) => c.game || 'magic';

  function renderCollection() {
    const everything = entries();
    const counts = { all: everything.length, magic: 0, pokemon: 0, squishy: 0 };
    everything.forEach((e) => counts[gameOf(e.card)]++);
    document.querySelectorAll('#collFolders button').forEach((b) => {
      const n = b.querySelector('small');
      if (n) n.textContent = counts[b.dataset.folder];
    });
    const all = folder === 'all' ? everything : everything.filter((e) => gameOf(e.card) === folder);
    const uniq = all.length;
    const total = all.reduce((s, e) => s + e.n + e.f, 0);
    const value = all.reduce((s, e) => s + e.n * cardPrice(e.card, false) + e.f * cardPrice(e.card, true), 0);
    $('#collStats').innerHTML = `
      <div><b>${fmt(total)}</b><small>cards</small></div>
      <div><b>${fmt(uniq)}</b><small>unique</small></div>
      <div><b>${money(value)}</b><small>value</small></div>
      <div><b>${fmt(folder === 'all' ? state.packsOpened : state.history.filter((h) => (h.game || 'magic') === folder).length)}</b><small>${folder === 'all' ? 'packs' : 'recent packs'}</small></div>`;

    // Set filter options
    const setSel = $('#collSet');
    const cur = setSel.value;
    const setsSeen = {};
    all.forEach((e) => (setsSeen[e.card.set] = e.card.setName));
    setSel.innerHTML =
      '<option value="">All sets</option>' +
      Object.entries(setsSeen)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`)
        .join('');
    setSel.value = setsSeen[cur] ? cur : '';

    const fSet = setSel.value;
    const fR = $('#collRarity').value;
    const q = $('#collSearch').value.trim().toLowerCase();
    const sort = $('#collSort').value;
    const val = (e) => Math.max(cardPrice(e.card, false) * (e.n ? 1 : 0), cardPrice(e.card, true) * (e.f ? 1 : 0));
    let list = all.filter(
      (e) => (!fSet || e.card.set === fSet) && (!fR || e.card.rarity === fR) && (!q || e.card.name.toLowerCase().includes(q))
    );
    const sorters = {
      value: (a, b) => val(b) - val(a),
      recent: (a, b) => (b.lastAt || b.firstAt) - (a.lastAt || a.firstAt),
      name: (a, b) => a.card.name.localeCompare(b.card.name),
      count: (a, b) => b.n + b.f - (a.n + a.f),
    };
    list.sort(sorters[sort]);

    const grid = $('#collGrid');
    const key = [folder, all.length, list.length, ...list.slice(0, 300).map((e) => `${e.card.id}:${e.n}:${e.f}`)].join('|');
    if (key === lastGridKey) {
      // Same cards as last time: keep the grid (and its loaded pictures) as is.
    } else if (!all.length) {
      grid.innerHTML = `<div class="empty"><p>No cards yet.</p><p class="muted">You start with 100 ◆, enough for your first pack. Go to <b>Open</b> to rip one!</p></div>`;
    } else if (!list.length) {
      grid.innerHTML = `<div class="empty"><p class="muted">No cards match.</p></div>`;
    } else {
      const shown = list.slice(0, 300);
      grid.innerHTML =
        shown
          .map(
            (e) => `<div class="mini ${e.card.rarity} ${e.f ? 'is-foil' : ''}" data-id="${esc(e.card.id)}">
          <img src="${esc(thumb(e.card.img))}" alt="${esc(e.card.name)}" loading="lazy">
          ${e.f ? '<div class="foil-sheen"></div>' : ''}
          <span class="qty">×${e.n + e.f}</span>
        </div>`
          )
          .join('') + (list.length > shown.length ? `<p class="muted small">Showing 300 of ${list.length}. Filter to see more.</p>` : '');
    }
    lastGridKey = key;

    $('#historyList').innerHTML =
      state.history
        .slice(0, 10)
        .map(
          (h) => `<li><span><b>${esc(h.setName)}</b><small>${h.type === 'collector' ? 'Collector · ' : ''}${new Date(h.at).toLocaleString()}</small></span>
          <span class="right">${money(h.value)}<small>${esc(h.best)}</small></span></li>`
        )
        .join('') || '<li class="muted">No packs opened yet.</li>';
  }
  ['#collSet', '#collRarity', '#collSort'].forEach((s) => $(s).addEventListener('change', renderCollection));
  $('#collSearch').addEventListener('input', renderCollection);
  $('#collGrid').addEventListener('click', (e) => {
    const m = e.target.closest('.mini');
    if (m) showCard(m.dataset.id);
  });

  function showCard(id) {
    const e = state.collection[id];
    if (!e) return;
    const c = e.card;
    const m = $('#cardModal');
    $('#cardModalInner').innerHTML = `
      <div class="detail ${e.f ? 'is-foil' : ''}">
        <img src="${esc(c.img)}" alt="${esc(c.name)}">
        ${e.f ? '<div class="foil-sheen"></div>' : ''}
      </div>
      <h3>${esc(c.name)}</h3>
      <p class="muted">${esc(c.type || '')}</p>
      <p><span class="rarity-dot ${c.rarity}"></span>${rarityText(c)}${c.treat ? ' · ' + esc(c.treat) : ''} · ${esc(c.setName)}${c.num ? ' #' + esc(c.num) : ''}</p>
      <table class="odds">
        <tr><td>Regular</td><td>×${e.n} · ${money(c.usd)} each</td></tr>
        <tr><td>Foil</td><td>×${e.f} · ${money(c.usdFoil)} each</td></tr>
      </table>
      <p class="muted small">${c.game === 'squishy' ? 'Squishies are entered by name only, so they have no prices.' : c.game === 'pokemon' ? 'Prices from TCGplayer (via TCGdex), checked when the pack was opened.' : 'Prices from Scryfall (TCGplayer market), updated when the set was loaded.'}</p>
      <div class="row center">
        ${c.uri ? `<a class="btn" href="${esc(c.uri)}" target="_blank" rel="noopener">View on ${c.game === 'pokemon' ? 'TCGplayer' : 'Scryfall'}</a>` : ''}
        <button class="btn primary" id="closeCard">Close</button>
      </div>`;
    m.classList.remove('hidden');
    const close = () => m.classList.add('hidden');
    $('#closeCard').onclick = close;
    m.onclick = (ev) => { if (ev.target === m) close(); };
  }

  // ---------- backup ----------
  $('#exportBtn').addEventListener('click', async () => {
    const data = JSON.stringify(state);
    try {
      await navigator.clipboard.writeText(data);
      toast('Backup copied. Paste it somewhere safe (Notes, email…)');
    } catch {
      dialog(
        `<h3>Backup</h3><p class="muted small">Copy all of this text and keep it somewhere safe.</p>
        <textarea readonly class="backup">${esc(data)}</textarea>
        <div class="row center"><button class="btn primary" id="bkClose">Close</button></div>`,
        (close) => ($('#bkClose').onclick = close)
      );
    }
  });
  $('#importBtn').addEventListener('click', () => {
    dialog(
      `<h3>Restore backup</h3><p class="muted small">Paste a backup below. This replaces everything on this device.</p>
      <textarea class="backup" id="bkIn" placeholder="Paste backup here"></textarea>
      <div class="row center"><button class="btn" id="bkCancel">Cancel</button><button class="btn primary" id="bkGo">Restore</button></div>`,
      (close) => {
        $('#bkCancel').onclick = close;
        $('#bkGo').onclick = () => {
          try {
            const d = JSON.parse($('#bkIn').value);
            if (typeof d !== 'object' || typeof d.points !== 'number' || typeof d.collection !== 'object') throw 0;
            state = migrate(Object.assign(defaultState(), d), d);
            save();
            close();
            renderPoints();
            renderCollection();
            toast('Backup restored');
          } catch {
            toast("That doesn't look like a Pack Ripped backup");
          }
        };
      }
    );
  });

  // ---------- boot ----------
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      rollDay();
      renderPoints();
      if ($('#view-earn').classList.contains('active')) renderEarn();
    } else save();
  });

  // Drop card pools cached by older versions.
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('packripped:pool:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}

  // Shared helpers for decks.js
  window.PR = {
    get state() { return state; },
    save, scry, esc, toast, dialog, cardPrice, showCard, cap, money, slimCard, API, showView, thumb,
    ripPack, costFor, renderPoints,
    getSets: async () => {
      if (!sets) await loadSets();
      return sets || [];
    },
  };

  renderPoints();
  const soundBtn = $('#soundBtn');
  const paintSound = () => (soundBtn.textContent = window.PRSound && window.PRSound.enabled ? '🔊' : '🔇');
  soundBtn.onclick = () => {
    if (!window.PRSound) return;
    const on = window.PRSound.toggle();
    paintSound();
    toast(on ? 'Sounds on' : 'Sounds off');
  };
  window.addEventListener('load', paintSound);
  // Restore the last chosen card game once every script (Pokémon, Squishies) has loaded.
  window.addEventListener('load', () => game !== 'magic' && setGame(game));
  if (state.taskBackpay) {
    const n = state.taskBackpay;
    delete state.taskBackpay;
    addPoints(n);
    setTimeout(() => toast(`+${n} ◆: tasks you finished today now count at their new value`), 900);
  }
  if (state.rateBackpay) {
    delete state.rateBackpay;
    const paid = creditSteps();
    save();
    if (paid > 0) setTimeout(() => toast(`+${paid} ◆: today's steps re-counted at the new rate (10 steps = 1 ◆)`), 500);
  }
  renderEarn();
  if (state.needsGoalSetup) setTimeout(goalSetup, 1200);
  if (!lsGet(STORE_KEY)) {
    save();
    setTimeout(() => toast('Welcome! Here are 100 ◆ for your first pack.'), 400);
  }

  // Updates: check for a new version on every launch and when the app comes back to the
  // front. When a new version takes over, reload once so it shows up right away.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      save();
      location.reload();
    });
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  }
})();
