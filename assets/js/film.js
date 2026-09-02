/* LatVeneer — scroll film engine (shared by / and /lv/).
   Configure BEFORE loading this script:
   window.FILM_CONFIG = {
     base: "",                    // path prefix to the site root ("" or "../")
     chapters: [{word, cap} ×4]   // localized chapter labels
   } */
(function () {
  var CFG = window.FILM_CONFIG || {};
  var BASE = CFG.base || "";
  var stage = document.querySelector(".film-scroll");
  var canvas = document.getElementById("filmCanvas");
  /* opaque + desynchronized: cheaper compositing, lower draw latency */
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  var word = document.getElementById("chapterWord");
  var num = document.getElementById("chapterNum");
  var cap = document.getElementById("chapterCap");
  var progress = document.getElementById("filmProgress");
  var rail = document.getElementById("filmRail");
  var chapters = CFG.chapters || [
    { word: "Birch", cap: "Once upon a time, in a Latvian forest." },
    { word: "Cut", cap: "Now shorter, and much more useful." },
    { word: "Sheet", cap: "It learns to be paper-thin." },
    { word: "Pallet", cap: "Neatly stacked. Ready to travel." }
  ];
  var N = 226;
  /* hero frames: each chapter's snap point lands exactly on one of
     these. Frame 0 (the standing tree) is used as-is from the video;
     the others have 4K Higgsfield upscales in assets/film/hd/ */
  var LAND = [0, 70, 165, 218];
  var HD_FRAMES = [70, 165, 218];
  /* the first 5% of the section's scroll span is a plateau that shows
     frame 0 exactly — entering from above can overshoot into it freely
     with no pull-back, and the tree still reads as "the keyframe" */
  var PLAT = 0.05;
  var frames = new Array(N), ready = new Array(N).fill(false);
  var target = 0, smoothed = 0, activeIdx = -1, lastDrawn = -1;

  function pad(i) { return ("00" + i).slice(-3); }

  /* progressive load: coarse passes eagerly so scrubbing works early;
     the full frame pass + 4K stills wait until the film nears the
     viewport, and are skipped entirely for Save-Data visitors */
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var order = [];
  [32, 8].forEach(function (step) {
    for (var i = 0; i < N; i += step) {
      if (order.indexOf(i) === -1) order.push(i);
    }
  });
  var qi = 0, inflight = 0;
  function pump() {
    while (inflight < 6 && qi < order.length) {
      (function (i) {
        inflight++;
        var img = new Image();
        img.decoding = "async";
        var fin = function () { ready[i] = true; inflight--; lastDrawn = -1; pump(); };
        /* decode() here so the first drawImage never pays a sync decode */
        img.onload = function () { img.decode ? img.decode().then(fin, fin) : fin(); };
        img.onerror = function () { inflight--; pump(); };
        img.src = BASE + "assets/film/frames/f" + pad(i) + ".webp";
        frames[i] = img;
      })(order[qi++]);
    }
  }
  pump();

  /* swap each landing frame for its 4K upscale once decoded: the film
     settles on a razor-sharp still at every chapter */
  function loadHd() {
    HD_FRAMES.forEach(function (i) {
      var hd = new Image();
      hd.decoding = "async";
      /* if an upscale is missing, fall back to the normal webp frame */
      hd.onerror = function () {
        if (order.indexOf(i) === -1) { order.push(i); pump(); }
      };
      function swap() {
        /* pre-scale ONCE to ~1.25× the display resolution: keeps the
           sharpness win but makes every subsequent draw as cheap as a
           normal frame (no 4K resample per animation frame) */
        var targetW = Math.min(hd.naturalWidth, Math.round(Math.max(canvas.width, 1920) * 1.25));
        var s = targetW / hd.naturalWidth;
        var c = document.createElement("canvas");
        c.width = targetW;
        c.height = Math.round(hd.naturalHeight * s);
        var cx = c.getContext("2d");
        cx.imageSmoothingQuality = "high";
        cx.drawImage(hd, 0, 0, c.width, c.height);
        frames[i] = c; ready[i] = true; lastDrawn = -1;
      }
      hd.onload = function () { hd.decode ? hd.decode().then(swap, swap) : swap(); };
      hd.src = BASE + "assets/film/hd/f" + pad(i) + ".png";
    });
  }

  var fullQueued = false;
  function queueFull() {
    if (fullQueued || saveData) return;
    fullQueued = true;
    for (var i = 0; i < N; i++) {
      /* NEVER queue the HD frames here: their 4K upscales own those
         slots, and the 1080p webp must not race in and overwrite them */
      if (HD_FRAMES.indexOf(i) === -1 && order.indexOf(i) === -1) order.push(i);
    }
    pump();
    loadHd();
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        if (entries[e].isIntersecting) { io.disconnect(); queueFull(); break; }
      }
    }, { rootMargin: "150% 0px" });
    io.observe(stage);
  } else {
    queueFull();
  }

  function readyBelow(x) {
    for (var i = Math.min(N - 1, Math.floor(x)); i >= 0; i--) { if (ready[i]) return i; }
    return -1;
  }
  function readyAbove(x) {
    for (var i = Math.max(0, Math.ceil(x)); i < N; i++) { if (ready[i]) return i; }
    return -1;
  }

  /* keep the browser's decode cache warm just ahead of the scrub position,
     so frames evicted from the cache never decode synchronously on draw */
  var lastWarm = 0, prevPos = 0;
  function warm(now) {
    if (now - lastWarm < 120) return;
    lastWarm = now;
    var dir = smoothed >= prevPos ? 1 : -1;
    prevPos = smoothed;
    for (var d = 0; d <= 10; d++) {
      var i = Math.round(smoothed) + d * dir;
      if (i >= 0 && i < N && ready[i] && frames[i].decode) {
        frames[i].decode().catch(function () {});
      }
    }
  }

  function drawImg(img, alpha) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var cw = canvas.width, ch = canvas.height;
    var s = Math.max(cw / iw, ch / ih);
    var w = iw * s, h = ih * s;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    ctx.globalAlpha = 1;
  }

  function render() {
    /* sub-frame position: cross-fade the nearest ready frame below and
       above instead of stepping whole frames — also bridges gaps while
       the progressive load is still filling in. Quantized so settled
       scrubs stop redrawing. */
    var x = Math.max(0, Math.min(N - 1, smoothed));
    var lo = readyBelow(x), hi = readyAbove(x);
    if (lo === -1 && hi === -1) return;
    if (lo === -1) lo = hi;
    if (hi === -1) hi = lo;
    var f = hi === lo ? 0 : (x - lo) / (hi - lo);
    /* cross-fade only between ADJACENT frames; while the sequence is
       still sparse, snap to the nearest loaded frame — a clean step
       reads better than ghosting two distant frames over each other */
    if (hi - lo > 1) {
      if (f >= 0.5) { lo = hi; }
      f = 0;
    }
    var key = lo + "/" + hi + "/" + Math.round(f * 64);
    if (key === lastDrawn) return;
    drawImg(frames[lo], 1);
    if (f > 0) drawImg(frames[hi], f);
    lastDrawn = key;
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr) || 1;
    canvas.height = Math.round(canvas.clientHeight * dpr) || 1;
    ctx.imageSmoothingQuality = "high"; /* reset by the resize */
    lastDrawn = -1;
    render();
  }
  window.addEventListener("resize", resize, { passive: true });

  function progressOf() {
    var rect = stage.getBoundingClientRect();
    var range = rect.height - window.innerHeight;
    return Math.min(1, Math.max(0, -rect.top / range));
  }

  /* progress bar + chapter labels driven from the SMOOTHED position,
     so everything on screen moves as one fluid piece */
  function updateHud(p) {
    progress.style.transform = "scaleX(" + p + ")";
    var idx = Math.min(3, Math.floor(p * 4));
    if (idx !== activeIdx) {
      activeIdx = idx;
      word.textContent = chapters[idx].word;
      cap.textContent = chapters[idx].cap;
      num.textContent = "0" + (idx + 1) + " / 04";
      rail.querySelectorAll("button").forEach(function (b, i) {
        b.classList.toggle("active", i === idx);
      });
    }
  }

  /* scroll position IS the film position — after the entry plateau, and
     clamped so leaving the section holds the pallet still (f218): the
     film never shows ragged lead-out frames */
  function mapFrame(p) {
    var f = p <= PLAT ? 0 : ((p - PLAT) / (1 - PLAT)) * (N - 1);
    return Math.max(LAND[0], Math.min(LAND[LAND.length - 1], f));
  }

  var lastTick = performance.now(), first = true;
  function tick(now) {
    var dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    target = progressOf();
    if (first) { smoothed = mapFrame(target); first = false; }
    /* track the scroll tightly while a chapter glide drives it (the
       glide is already smooth); floatier during free scrolling */
    var k = gliding ? 16 : 6;
    var goal = mapFrame(target);
    smoothed += (goal - smoothed) * (1 - Math.exp(-k * dt));
    /* land EXACTLY on the frame once close: at rest the canvas shows the
       pure 4K still instead of a 99% blend over its neighbour */
    if (Math.abs(goal - smoothed) < 0.02) { smoothed = goal; }
    updateHud(smoothed / (N - 1));
    /* entering from below: capture onto the pallet keyframe the instant
       the film fills the screen. From above no capture is needed — the
       entry plateau already shows the tree keyframe throughout, so the
       first scroll is never pulled backwards. */
    var isEng = engaged();
    if (isEng && !wasEngaged && !gliding && !reduceMotion && target >= 0.5) {
      launch(CENTERS.length - 1);
      lastAdvance = now;
    }
    wasEngaged = isEng;
    restGuard(now);
    warm(now);
    render();
    requestAnimationFrame(tick);
  }
  resize();
  requestAnimationFrame(tick);
  window.__fs = {
    get t() { return target; },
    get frame() { return smoothed; },
    get gliding() { return gliding; },
    kind: function (i) { var f = frames[i]; return f ? f.tagName : null; }
  };

  /* ---- keyframe-only scrolling ----
     Inside the film there are exactly four resting places — the four
     keyframes. ANY gesture, big or small, glides one keyframe in that
     direction (chaining while you keep scrolling). If the scroll ever
     comes to rest anywhere else (scrollbar drag, momentum, entering the
     section), it is pulled to the nearest keyframe. Past either end the
     page releases to normal scrolling. */
  /* scroll positions of the keyframes: inverse of mapFrame's plateau map */
  var CENTERS = LAND.map(function (i) { return PLAT + (i / (N - 1)) * (1 - PLAT); });
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var gliding = false, settleUntil = 0, wasEngaged = false;

  var W0 = 10;      /* spring natural frequency, rad/s (higher = snappier) */
  var VMAX = 3600;  /* px/s velocity cap */
  var sp = { pos: 0, vel: 0, targetY: 0, targetIdx: 0, deadline: 0 };

  function engaged() {
    var r = stage.getBoundingClientRect();
    return r.top <= 0 && r.bottom >= window.innerHeight - 1;
  }
  function centerY(p) {
    return stage.offsetTop + p * (stage.offsetHeight - window.innerHeight);
  }
  var lastSpringT = 0;
  function springStep(now) {
    if (!gliding) { return; }
    var dt = Math.min(0.033, (now - lastSpringT) / 1000) || 0.016;
    lastSpringT = now;
    /* semi-implicit Euler, critically damped: a = -k·x - c·v */
    var x = sp.pos - sp.targetY;
    sp.vel += (-(W0 * W0) * x - 2 * W0 * sp.vel) * dt;
    if (sp.vel > VMAX) { sp.vel = VMAX; } else if (sp.vel < -VMAX) { sp.vel = -VMAX; }
    sp.pos += sp.vel * dt;
    /* behavior:"instant" is load-bearing: with CSS scroll-behavior:smooth,
       a plain scrollTo would start a browser-eased scroll every frame
       and fight the spring */
    window.scrollTo({ top: sp.pos, left: 0, behavior: "instant" });
    if ((Math.abs(sp.pos - sp.targetY) < 1.5 && Math.abs(sp.vel) < 25) || now > sp.deadline) {
      window.scrollTo({ top: sp.targetY, left: 0, behavior: "instant" });
      gliding = false;
      settleUntil = performance.now() + 150;
    } else {
      requestAnimationFrame(springStep);
    }
  }
  function launch(idx) {
    var wasGliding = gliding;
    sp.targetIdx = idx;
    sp.targetY = centerY(CENTERS[idx]);
    if (!wasGliding) { sp.pos = window.scrollY; }
    var dist = Math.abs(sp.targetY - sp.pos);
    var dir = sp.targetY >= sp.pos ? 1 : -1;
    /* uniform feel regardless of gesture size; gentle for short pulls */
    var v0 = dir * Math.min(1400, 120 + dist * 2.2);
    if (!wasGliding || (sp.vel > 0) !== (v0 > 0)) { sp.vel = v0; }
    sp.deadline = performance.now() + 4000;
    if (!wasGliding) {
      gliding = true;
      lastSpringT = performance.now();
      requestAnimationFrame(springStep);
    }
  }
  function nextCenter(dir) {
    var p = progressOf();
    /* at (or before) a chapter already? then the gesture means the
       NEXT one over — the entry plateau counts as chapter 0 */
    for (var c = 0; c < CENTERS.length; c++) {
      if (Math.abs(p - CENTERS[c]) < 0.02 || (c === 0 && p < CENTERS[0])) {
        var n = c + dir;
        return (n < 0 || n >= CENTERS.length) ? -1 : n;
      }
    }
    /* between chapters: first one strictly beyond, in that direction */
    if (dir > 0) {
      for (var i = 0; i < CENTERS.length; i++) { if (CENTERS[i] > p + 0.01) return i; }
    } else {
      for (var j = CENTERS.length - 1; j >= 0; j--) { if (CENTERS[j] < p - 0.01) return j; }
    }
    return -1; /* no further chapter: release to native scroll */
  }
  var lastAdvance = 0;
  function advance(dir, e) {
    if (reduceMotion || !engaged()) return;
    var now = performance.now();
    if (gliding) {
      var nidx = sp.targetIdx + dir;
      if (nidx < 0 || nidx >= CENTERS.length) {
        /* outward past the ends: hand back to native scrolling as soon
           as the glide has essentially arrived — continuous scrolling
           must never pile up against a wall */
        if (Math.abs(window.scrollY - sp.targetY) < 160) {
          /* release RIGHT HERE — no snap back to the keyframe, no
             reverse hop: this very event scrolls out natively */
          gliding = false;
          settleUntil = 0;
          return;
        }
        /* still mid-flight: swallow the event, and hurry the spring as
           fast as it can go WITHOUT overshooting the keyframe (an
           overshoot would spring back = visible jiggle on exit) */
        e.preventDefault();
        var rem = sp.targetY - sp.pos;
        sp.vel = (rem > 0 ? 1 : -1) * Math.min(2600, Math.abs(rem) * W0 * 0.9);
        return;
      }
      /* one advance per gesture; continued scrolling chains chapters */
      if (now - lastAdvance < 260) { e.preventDefault(); return; }
      e.preventDefault();
      lastAdvance = now;
      launch(nidx);
      return;
    }
    var idx = nextCenter(dir);
    if (idx === -1) { return; } /* outward at rest: always native, instantly */
    if (now - lastAdvance < 260 || now < settleUntil) { e.preventDefault(); return; }
    e.preventDefault();
    lastAdvance = now;
    launch(idx);
  }
  window.addEventListener("wheel", function (e) {
    advance(e.deltaY > 0 ? 1 : -1, e);
  }, { passive: false });

  var touchY = null;
  window.addEventListener("touchstart", function (e) {
    touchY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    if (reduceMotion || touchY === null || !engaged()) return;
    var dy = touchY - e.touches[0].clientY;
    if (Math.abs(dy) < 24) { if (gliding) { e.preventDefault(); } return; }
    touchY = e.touches[0].clientY; /* re-arm: a long swipe can chain */
    advance(dy > 0 ? 1 : -1, e);
  }, { passive: false });

  /* rest guard: if the scroll stops BETWEEN keyframes (scrollbar drag,
     momentum, entering the section), pull it to the nearest one. The
     bands past the first/last keyframe are exempt — the canvas already
     clamps to the edge stills there, and pulling would trap anyone
     pausing on their way out of the section. */
  var lastScrollY = -1, lastMoveT = 0;
  function restGuard(now) {
    if (reduceMotion) { return; }
    var y = window.scrollY;
    if (y !== lastScrollY) { lastScrollY = y; lastMoveT = now; return; }
    /* 220ms of true stillness before pulling: slow wheel notches during
       an exit must not be mistaken for coming to rest */
    if (gliding || now - lastMoveT < 220 || now < settleUntil || !engaged()) { return; }
    if (target <= CENTERS[0] || target >= CENTERS[CENTERS.length - 1]) { return; }
    var best = 0, bd = 1e9;
    for (var i = 0; i < CENTERS.length; i++) {
      var d = Math.abs(target - CENTERS[i]);
      if (d < bd) { bd = d; best = i; }
    }
    if (bd * (stage.offsetHeight - window.innerHeight) > 4) { launch(best); }
  }

  rail.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    launch(+btn.dataset.jump);
  });
})();
