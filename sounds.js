/*
 * Pack Ripped sound effects, made on the fly with Web Audio (no sound files).
 *  - shake(): a few coins rattling, when a pack or blind bag is ripped
 *  - coin():  a bright "ka-ching", for a good card
 *  - dings(): ding-ding-ding-ding-ding, for a big hit
 * Phones only allow sound after a tap, and iPhones stay silent while the ring/silent
 * switch is set to silent.
 */
(function (root) {
  'use strict';

  const KEY = 'packripped:sound';
  let ctx = null;
  let on = (() => {
    try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
  })();

  function audio() {
    if (!on) return null;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  // Unlock audio on the first tap anywhere (needed on iPhone).
  const unlock = () => {
    const a = audio();
    if (a) {
      const b = a.createBuffer(1, 1, 22050);
      const s = a.createBufferSource();
      s.buffer = b;
      s.connect(a.destination);
      s.start(0);
    }
    window.removeEventListener('touchend', unlock);
    window.removeEventListener('click', unlock);
  };
  window.addEventListener('touchend', unlock);
  window.addEventListener('click', unlock);

  /** One metallic tone with a quick attack and a ringing decay. */
  function tone(a, t, freq, dur, vol, type) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A short burst of filtered noise: the "chk" of coins hitting each other. */
  function noise(a, t, dur, vol, freq) {
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq || 5000;
    f.Q.value = 1.2;
    const g = a.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  }

  /** A soft bell: pure tone with a gentle attack and a long, smooth fade. */
  function bell(a, t, freq, dur, vol) {
    const o = a.createOscillator();
    const o2 = a.createOscillator();
    const g = a.createGain();
    const g2 = a.createGain();
    o.type = 'sine';
    o2.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o2.frequency.setValueAtTime(freq * 2, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(vol * 0.15, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.5);
    o.connect(g).connect(a.destination);
    o2.connect(g2).connect(a.destination);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  /** A coin clink: two inharmonic partials, like thin metal. */
  function clink(a, t, base, vol) {
    tone(a, t, base, 0.12, vol, 'triangle');
    tone(a, t, base * 2.76, 0.08, vol * 0.5, 'sine');
    noise(a, t, 0.03, vol * 0.6, base * 1.5);
  }

  const api = {
    get enabled() { return on; },
    toggle() {
      on = !on;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
      if (on) api.coin();
      return on;
    },

    /** A few coins shaking. */
    shake() {
      const a = audio();
      if (!a) return;
      const t0 = a.currentTime + 0.01;
      // A light rattle: 4 quiet coins.
      for (let i = 0; i < 4; i++) {
        const t = t0 + i * 0.07 + Math.random() * 0.03;
        clink(a, t, 2400 + Math.random() * 1200, 0.05 + Math.random() * 0.02);
      }
    },

    /** Ka-ching: a quick rattle and two bright rising notes. */
    coin() {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + 0.01;
      noise(a, t, 0.06, 0.25, 4000);
      clink(a, t + 0.02, 2600, 0.12);
      tone(a, t + 0.06, 1318.5, 0.18, 0.3, 'square'); // E6
      tone(a, t + 0.06, 2637, 0.18, 0.06, 'sine');
      tone(a, t + 0.15, 1975.5, 0.55, 0.3, 'square'); // B6
      tone(a, t + 0.15, 3951, 0.5, 0.06, 'sine');
    },

    /** Ding, ding, ding, ding, ding: rising bells for a big hit. */
    dings() {
      const a = audio();
      if (!a) return;
      const t0 = a.currentTime + 0.02;
      // Ding, ding, ding: three soft bells (G5, C6, E6), gentle start, long fade.
      [784, 1046.5, 1318.5].forEach((f, i) => {
        const t = t0 + i * 0.22;
        bell(a, t, f, 1.1, 0.13);
      });
    },

    /**
     * A few coins dropped on a table: each coin lands, then bounces twice, quieter each
     * time. Cheap cards drop 2 coins, slightly better cards drop 3.
     */
    drop(coins) {
      const a = audio();
      if (!a) return;
      const t0 = a.currentTime + 0.01;
      for (let c = 0; c < coins; c++) {
        const start = t0 + c * 0.085 + Math.random() * 0.03;
        const pitch = 1700 + Math.random() * 900;
        // land, bounce, bounce: gaps shrink and volume drops like a real coin settling
        [[0, 0.19], [0.11, 0.1], [0.18, 0.055]].forEach(([dt, vol]) => {
          const t = start + dt;
          tone(a, t, pitch, 0.22, vol, 'triangle');
          tone(a, t, pitch * 2.4, 0.12, vol * 0.45, 'sine');
          noise(a, t, 0.04, vol * 0.9, pitch * 1.3);
        });
      }
    },

    /** Kept for older callers: one or two coins. */
    tink(two) {
      api.drop(two ? 3 : 2);
    },

    /** Wake the audio inside a tap (iPhones sometimes pause it between taps). */
    wake() {
      audio();
    },

    /**
     * Every revealed card gets a sound, bigger for better cards.
     * price: market value in dollars (0 when unknown).
     */
    /** A tiny metal "ching": one short, soft, high ring. bright = a touch fuller. */
    ching(bright) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + 0.01;
      const f = bright ? 3520 : 3135; // A7 / G7
      tone(a, t, f, bright ? 0.22 : 0.16, bright ? 0.07 : 0.05, 'sine');
      tone(a, t, f * 2.76, 0.07, bright ? 0.022 : 0.015, 'sine'); // faint metallic overtone
    },

    forCard(card, price) {
      const tier = api.tier(card, price);
      if (tier === 'huge') api.dings();
      else if (tier === 'big') api.coin();
      else if (tier === 'nice') api.ching(true);
      else api.ching(false);
      return tier;
    },

    tier(card, price) {
      if (!card) return 'small';
      if (card.game === 'squishy') return card.rarity === 'mythic' ? 'huge' : card.rarity === 'rare' ? 'big' : 'small';
      if (price >= 20) return 'huge';
      if (price >= 2 || card.rarity === 'mythic') return 'big';
      if (price >= 0.75 || card.rarity === 'rare' || card.rarity === 'uncommon') return 'nice';
      return 'small';
    },
  };

  root.PRSound = api;
})(typeof self !== 'undefined' ? self : this);
