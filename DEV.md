# LatVeneer site — dev notes

Static site, no build step. Redesigned front page + subpages (Sept 2026):
ivory/sage/oat palette with dark-green accent `#273e1c`, Cabinet Grotesk (Fontshare)
+ Inter Tight (Google Fonts), growth-ring SVG logo, scroll-scrubbed film,
FSC marquee, sample-request modal (mailto-based).

## Run locally

```
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:8123. (In Claude Code, the `.claude/launch.json`
preview config does this automatically.) The PowerShell server exists because
this machine has no python/node; any static file server works — but the site
must be served over HTTP, not opened as `file://`, for the frames to load.

## Pages

- `index.html` — front page: hero, FSC marquee, scroll film (4 chapters:
  Birch / Cut / Sheet / Pallet), specs, mill, contact + map, sample modal.
  Opening it with `#sample` in the URL auto-opens the modal. Styles are inline
  in the file.
- `product.html`, `procurement.html`, `news.html` — share `assets/css/veneer.css`.
  Keep its tokens in sync with index's inline styles if the palette changes.

## The scroll film

The film section scrubs a **WebP frame sequence** (`assets/film/frames/f000.webp`
… `f225.webp`, 226 frames, full 1920×1080, quality 0.85) drawn to a canvas —
NOT the video element. Frame scrubbing is used because seeking H.264 video on
scroll stutters (keyframe decoding); image frames seek instantly.

`assets/film/birch-film.mp4` is the source master (Higgsfield Seedance 2.5,
text-to-video, 15 s 1080p: standing leafy birch in an off-white void → felled
and cross-cut to a realistic bolt → rotary-peeled into one long sheet → cut
and stacked into single-ply veneer sheets).

### Regenerating frames after replacing the mp4

1. Run `serve.ps1` (it has a PUT endpoint for `assets/film/frames/`).
2. Open http://localhost:8123 in a browser and run this in the console:

```js
(async () => {
  const v = document.createElement('video');
  v.src = 'assets/film/birch-film.mp4'; v.muted = true; v.preload = 'auto';
  await new Promise(r => { v.onloadedmetadata = r; });
  const N = 226, D = v.duration - 0.06;
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  const ctx = c.getContext('2d');
  const pad = i => ('00' + i).slice(-3);
  for (let i = 0; i < N; i++) {
    v.currentTime = i * D / (N - 1);
    await new Promise(r => { v.onseeked = r; });
    ctx.drawImage(v, 0, 0, 1920, 1080);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
    await fetch('assets/film/frames/f' + pad(i) + '.webp', { method: 'PUT', body: blob });
    console.log(i + 1, '/', N);
  }
  console.log('done');
})();
```

If the frame count changes, update `var N = 226` in index.html's film script.

### HD landing frames

Each chapter snaps to a hero frame (`var LAND = [0, 70, 165, 218]` in
index.html). Frame 0 (the standing tree) is used as-is from the video — its
Higgsfield upscale came out wrong and was removed. The others
(`var HD_FRAMES = [70, 165, 218]`) have 4K Higgsfield upscales
(bytedance_image_upscale) in `assets/film/hd/fNNN.png`, swapped into the
frame array once decoded so the film settles on a sharp still. If the lists
change, regenerate: upload the frame via Higgsfield media_upload, run
upscale_image (4k), save the result as `assets/film/hd/fNNN.png` (and keep
LAND/HD_FRAMES in sync).

## SEO layer (Sept 2026 audit implementation)

- Canonical scheme: `https://latveneer.lv/` + `/product.html` etc. Every page
  carries canonical + OG/Twitter + JSON-LD (Organization/LocalBusiness +
  WebSite on index, Product on product, BreadcrumbList everywhere, ItemList of
  BlogPosting on news). `robots.txt` declares `sitemap.xml` (update lastmod on
  meaningful edits). `llms.txt` is a plain-text fact sheet — keep in sync when
  specs change.
- Full Latvian mirror under `lv/`: `index.html` (canonical `/lv/`),
  `produkts.html`, `iepirksana.html`, `jaunumi.html` — every page hreflang-
  paired en↔lv with x-default→en (heads + sitemap). An LV/EN pill button sits
  top-right in every header. LV pages use `../`-relative asset paths.
- Shared JS/CSS extracted for the two homepages: `assets/css/home.css` (was
  index's inline styles), `assets/js/film.js` (the whole scroll-film engine —
  configure via `window.FILM_CONFIG = { base, chapters }` before loading) and
  `assets/js/modal.js` (used by ALL pages now, index included).
- The sample form posts to Netlify Forms (`name="sample-request"`,
  data-netlify). Success is only claimed on a 2xx; otherwise an email fallback
  (pre-filled mailto + copy button) appears. serve.ps1 returns 405 for POST, so
  local dev always exercises the fallback path. Subpages share
  `assets/js/modal.js`; index has its own inline copy.
- Optimized images live in `images/opt/` (brochure pages 1440px WebP, photos
  ≤1200px WebP) — generated in-browser via canvas + the serve.ps1 PUT endpoint
  (now accepts `images/` too). Originals are kept alongside; `images/carusel/`
  PNGs and the large Picture*/pic01/img0* originals are no longer referenced.
- The film's full 226-frame pass + 4K stills only load when `#film` nears the
  viewport (IntersectionObserver, rootMargin 150%) and are skipped under
  Save-Data; only the two coarse passes (~36 frames) load eagerly.
- `_headers` (immutable frames, 1w images, security headers), `_redirects`
  (301s for the old build's elements/generic pages), branded `404.html`.
- On Netlify: disable Pretty URLs (or commit to extensionless URLs and update
  every canonical/sitemap/internal link to match), and verify the
  "sample-request" form appears in the Forms dashboard after the first deploy.

## Client edit mode

An invisible button sits after the © line in every footer (tab to it or click
just right of the copyright text). Password: `latveneer2026` — CHANGE IT:
`printf 'newpassword' | sha256sum` and paste the hash into EDIT_HASH in
`assets/js/edit-mode.js`. It is a convenience gate, not security — but edits
only become public when the overrides file is actually published.

In edit mode every text block is click-to-type (dashed outlines; links don't
navigate). Save behavior: on the local dev server it PUTs straight into
`content/overrides.json` (live immediately); on the deployed site it submits
the changes as the Netlify form "content-edits" (owner gets them in the Forms
dashboard/email) AND downloads overrides.json — drop that file into
`content/` and redeploy to publish. Pages apply `content/overrides.json` on
every load; selectors are structural, so if the page markup changes, matching
overrides just stop applying (no errors). JS-driven texts (film chapter
labels) are excluded — edit those in FILM_CONFIG instead.

## Known gaps / needs business input

- assets/film/frames/*.jpg are leftover duplicates of the .webp set (~8 MB) —
  safe to delete before deploying.
- Product page still lacks: grade-definition table (what A/B/C/D/E allow),
  MOQ / lead times / Incoterms, FSC license code (FSC-C######) + certificate
  PDF link. These need real business facts — prime SEO material when available.
- Off-site (Phase 3 of the action plan): Google Business Profile at Ausekļa
  iela 3A, LinkedIn/citations (Lursoft, firmas.lv, 1188.lv, Fordaq, Europages),
  then add their URLs as `sameAs` in index.html's Organization schema.
- The old site's full LV/EN toggle is still not wired up — only the
  procurement page exists in Latvian (`assets/lang/lv.json` holds the rest of
  the translations).
