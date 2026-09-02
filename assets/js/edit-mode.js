/* LatVeneer — inline text editor ("client edit mode").
   How it works:
   · content/overrides.json holds { "<pathname>": { "<css-path>": "<html>" } }
     and is applied to the page on every load (below).
   · An invisible button in the footer opens a password prompt. The password
     is checked against a SHA-256 hash (EDIT_HASH). To change the password:
     run  printf 'newpassword' | sha256sum  and paste the hash here.
     NOTE: this is a convenience gate, not security — edits only reach other
     visitors when the overrides file is actually published (see save flow).
   · In edit mode all text blocks become contenteditable. Save:
       1) tries PUT content/overrides.json — works on the local dev server
          (serve.ps1), where it persists to disk immediately;
       2) otherwise (live Netlify site) submits the changes as a Netlify
          form ("content-edits") to the site owner AND downloads the merged
          overrides.json, which the owner drops into the site and redeploys. */
(function () {
  var EDIT_HASH = "731a260697275a47cc43639d3a0b76150cb1b9a26ab72e89d38902f07269ec14"; /* latveneer2026 */
  var BASE = (window.FILM_CONFIG && window.FILM_CONFIG.base) ||
             (location.pathname.indexOf("/lv/") === 0 ? "../" : "");
  var FILE = BASE + "content/overrides.json";
  var page = location.pathname.replace(/\/index\.html$/, "/") || "/";
  var EDITABLE = "h1, h2, h3, p, li, figcaption, .big, .kicker, .note, " +
    ".marquee .track span, .film-rail button span, .person-card .role, " +
    ".person-card .name, nav.main a:not(.lang-btn), .sheet-menu a, " +
    ".footer-meta a, .btn, .data-table th, .data-table td, " +
    ".contact-grid h3, .contact-grid div, address, .field label";
  var EXCLUDE = "#chapterNum, #chapterWord, #chapterCap, .hp, script, style";

  var overrides = {};
  fetch(FILE, { cache: "no-store" }).then(function (r) {
    return r.ok ? r.json() : {};
  }).then(function (data) {
    overrides = data || {};
    var mine = overrides[page] || {};
    Object.keys(mine).forEach(function (sel) {
      try {
        var el = document.querySelector(sel);
        if (el) { el.innerHTML = mine[sel]; }
      } catch (e) { /* stale selector after a structural change: skip */ }
    });
  }).catch(function () {});

  /* ---------- the invisible door ---------- */
  function sha256(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    });
  }
  var trigger = document.getElementById("editorDoor");
  if (!trigger) { return; }
  trigger.addEventListener("click", function () {
    if (sessionStorage.getItem("lv_editor") === "1") { enable(); return; }
    var pw = window.prompt("Editor password:");
    if (!pw) { return; }
    sha256(pw).then(function (h) {
      if (h === EDIT_HASH) {
        sessionStorage.setItem("lv_editor", "1");
        enable();
      } else {
        window.alert("Wrong password.");
      }
    });
  });

  /* ---------- edit mode ---------- */
  var dirty = {}, active = false, bar;

  function cssPath(el) {
    var parts = [];
    while (el && el !== document.body) {
      var i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) { i++; }
      parts.unshift(el.tagName.toLowerCase() + ":nth-child(" + i + ")");
      el = el.parentElement;
    }
    return "body > " + parts.join(" > ");
  }

  function enable() {
    if (active) { return; }
    active = true;
    document.querySelectorAll(EDITABLE).forEach(function (el) {
      if (el.closest(EXCLUDE)) { return; }
      if (el.closest("[contenteditable]") && el.getAttribute("contenteditable") === null) { return; }
      el.setAttribute("contenteditable", "true");
      el.classList.add("edit-target");
      el.addEventListener("input", function () { dirty[cssPath(el)] = el; setStatus("Unsaved changes…"); });
    });
    /* links must be editable, not followable, while in edit mode */
    document.addEventListener("click", blockNav, true);
    injectBar();
  }
  function blockNav(e) {
    var a = e.target.closest && e.target.closest("a");
    if (a && active) { e.preventDefault(); e.stopPropagation(); }
  }
  function disable() {
    active = false;
    document.querySelectorAll("[contenteditable]").forEach(function (el) {
      el.removeAttribute("contenteditable");
      el.classList.remove("edit-target");
    });
    document.removeEventListener("click", blockNav, true);
    if (bar) { bar.remove(); bar = null; }
  }

  function collect() {
    var mine = overrides[page] = overrides[page] || {};
    Object.keys(dirty).forEach(function (sel) { mine[sel] = dirty[sel].innerHTML; });
    return overrides;
  }

  function save() {
    var data = JSON.stringify(collect(), null, 2);
    setStatus("Saving…");
    /* path 1: local dev server persists it to disk */
    fetch(FILE, { method: "PUT", body: data }).then(function (r) {
      if (!r.ok) { throw new Error("no PUT"); }
      dirty = {};
      setStatus("✓ Saved to the site (local server)");
    }).catch(function () {
      /* path 2: live site — send to the owner + download the file */
      var body = new URLSearchParams({
        "form-name": "content-edits",
        page: page,
        overrides: data
      }).toString();
      fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body
      }).then(function (r) {
        if (!r.ok) { throw new Error("HTTP " + r.status); }
        setStatus("✓ Sent for publishing — also downloading a copy…");
      }).catch(function () {
        setStatus("Could not reach the server — downloading the file instead…");
      }).finally ? null : null;
      /* always hand over the file so nothing is ever lost */
      var blob = new Blob([data], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "overrides.json";
      a.click();
      dirty = {};
    });
  }

  function setStatus(t) {
    var s = document.getElementById("editStatus");
    if (s) { s.textContent = t; }
  }

  function injectBar() {
    bar = document.createElement("div");
    bar.id = "editBar";
    bar.innerHTML =
      '<style>' +
      '#editBar{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:9999;' +
      'background:#232b1d;color:#f5f1e8;border-radius:999px;padding:0.6rem 1rem;display:flex;' +
      'gap:0.8rem;align-items:center;font:500 0.85rem/1 "Inter Tight",system-ui,sans-serif;' +
      'box-shadow:0 10px 30px rgba(35,43,29,0.35)}' +
      '#editBar button{border:0;border-radius:999px;padding:0.45rem 0.9rem;cursor:pointer;' +
      'font:600 0.82rem/1 "Inter Tight",system-ui,sans-serif}' +
      '#editBar .save{background:#cfd8c3;color:#232b1d}' +
      '#editBar .exit{background:transparent;color:#f5f1e8;box-shadow:inset 0 0 0 1.5px rgba(245,241,232,0.5)}' +
      '.edit-target{outline:1.5px dashed rgba(39,62,28,0.5);outline-offset:2px;min-height:1em}' +
      '.edit-target:hover,.edit-target:focus{outline-color:#273e1c;background:rgba(207,216,195,0.18)}' +
      '</style>' +
      '<span id="editStatus">Edit mode — click any text and type</span>' +
      '<button class="save" type="button">Save</button>' +
      '<button class="exit" type="button">Exit</button>';
    document.body.appendChild(bar);
    bar.querySelector(".save").addEventListener("click", save);
    bar.querySelector(".exit").addEventListener("click", function () {
      if (Object.keys(dirty).length && !window.confirm("Exit without saving the latest changes?")) { return; }
      disable();
    });
    window.addEventListener("beforeunload", function (e) {
      if (active && Object.keys(dirty).length) { e.preventDefault(); e.returnValue = ""; }
    });
  }
})();
