/* LatVeneer — shared sample-request modal (subpages). Mirrors index.html's inline handler. */
(function () {
  var backdrop = document.getElementById("modalBackdrop");
  var modal = document.getElementById("modal");
  var form = document.getElementById("sampleForm");
  if (!backdrop || !modal || !form) { return; }
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modal.classList.remove("sent");
    modal.classList.remove("fallback");
    backdrop.classList.add("open");
    document.getElementById("fName").focus();
  }
  function close() {
    backdrop.classList.remove("open");
    if (lastFocus) { lastFocus.focus(); }
  }
  document.querySelectorAll("[data-open-modal]").forEach(function (b) {
    b.addEventListener("click", open);
  });
  document.querySelectorAll("[data-close-modal]").forEach(function (b) {
    b.addEventListener("click", close);
  });
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) { close(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && backdrop.classList.contains("open")) { close(); }
  });
  if (location.hash === "#sample") { open(); }

  var lastBody = "";
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = new FormData(form);
    lastBody =
      "Name: " + d.get("name") + "\n" +
      "Company: " + (d.get("company") || "-") + "\n" +
      "Email: " + d.get("email") + "\n" +
      "Sheet size: " + (d.get("size") || "-") + "\n" +
      "Thickness: " + (d.get("thickness") || "-") + "\n\n" +
      (d.get("notes") || "");
    document.getElementById("mailFallback").href =
      "mailto:info@latveneer.lv" +
      "?subject=" + encodeURIComponent("Sample request — " + (d.get("company") || d.get("name"))) +
      "&body=" + encodeURIComponent(lastBody);
    /* real submit (Netlify Forms). Only claim success on a 2xx; anything else
       keeps the form and offers the email fallback instead. */
    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(d).toString()
    }).then(function (r) {
      if (!r.ok) { throw new Error("HTTP " + r.status); }
      modal.classList.remove("fallback");
      modal.classList.add("sent");
    }).catch(function () {
      modal.classList.add("fallback");
    });
  });
  document.getElementById("copyRequest").addEventListener("click", function () {
    var text = "Sample request\n\n" + lastBody + "\n\nSend to: info@latveneer.lv";
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { document.getElementById("copyRequest").textContent = "copied ✓"; })
      .catch(function () { window.prompt("Copy your request:", text); });
  });
})();
