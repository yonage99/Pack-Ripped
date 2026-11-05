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
      const n = 7;
      for (let i = 0; i < n; i++) {
        const t = t0 + i * 0.06 + Math.random() * 0.03;
        clink(a, t, 2200 + Math.random() * 1600, 0.09 + Math.random() * 0.05);
      }
    },

    /** Ka-ching: a quick rattle and two bright rising notes. */
    coin() {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + 0.01;
      noise(a, t, 0.06, 0.25, 4000);
      clink(a, t + 0.02, 2600, 0.12);
      tone(a, t + 0.06, 1318.5, 0.18, 0.22, 'square'); // E6
      tone(a, t + 0.06, 2637, 0.18, 0.06, 'sine');
      tone(a, t + 0.15, 1975.5, 0.55, 0.22, 'square'); // B6
      tone(a, t + 0.15, 3951, 0.5, 0.06, 'sine');
    },

    /** Ding, ding, ding, ding, ding: rising bells for a big hit. */
    dings() {
      const a = audio();
      if (!a) return;
      const t0 = a.currentTime + 0.02;
      const notes = [1046.5, 1318.5, 1568, 2093, 2637]; // C6 E6 G6 C7 E7
      notes.forEach((f, i) => {
        const t = t0 + i * 0.16;
        tone(a, t, f, 0.9, 0.2, 'sine');
        tone(a, t, f * 2, 0.6, 0.07, 'sine');
        tone(a, t, f * 3.01, 0.35, 0.03, 'sine');
      });
      // Shimmer at the end
      for (let i = 0; i < 6; i++) clink(a, t0 + 0.85 + i * 0.05, 3200 + i * 300, 0.06);
    },

    /** One soft coin "tink" (cheap card), or two rising tinks (a bit better). */
    tink(two) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + 0.01;
      clink(a, t, 2900, 0.11);
      if (two) clink(a, t + 0.09, 3700, 0.13);
    },

    /** Wake the audio inside a tap (iPhones sometimes pause it between taps). */
    wake() {
      audio();
    },

    /**
     * Every revealed card gets a sound, bigger for better cards.
     * price: market value in dollars (0 when unknown).
     */
    forCard(card, price) {
      const tier = api.tier(card, price);
      if (tier === 'huge') api.dings();
      else if (tier === 'big') api.coin();
      else if (tier === 'nice') api.tink(true);
      else api.tink(false);
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
