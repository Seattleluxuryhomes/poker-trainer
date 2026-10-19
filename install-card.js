/* install-card.js: one calm card that asks a person to put the app on their phone.
   Pattern copied from Cross Universal (D-619) and Linked Ministries: no memory, no network, no storage.
     Android (Chrome): the browser's beforeinstallprompt event is held and the card's button calls prompt().
       The card says "Added." only when the browser fires appinstalled, never before. Until the browser has
       said the site can be installed there is no card and no promise.
     iPhone and iPad (Safari): there is nothing to call, so the card shows the two real steps with the Share icon drawn.
   Never when the app is already open as an app (display-mode standalone, or navigator.standalone), never on a computer.
   "Not now" closes the card for the rest of this page view only (a variable); the next page view asks again.
   A classic script. It sets window.InstallCard = { mount(slot, options) }.
   options: { name: "App name", icon: "/icon-192.png", colors: { bg, fg, muted, accent, accentText, line } } */
(function () {
  "use strict";
  var ua = navigator.userAgent || "";
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var android = /Android/.test(ua);
  function standalone() {
    try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) { return false; }
  }
  var WORDS = {
    why: "Keep it on your phone, one tap from your home screen.",
    button: "Add to home screen",
    notNow: "Not now",
    waiting: "Waiting for your phone to finish.",
    added: "Added.",
    iosLead: "On an iPhone, it takes two taps.",
    iosOne: "Tap the Share button.",
    iosTwo: "Then tap Add to Home Screen."
  };
  var st = { held: null, waiting: false, added: false, hidden: false };
  var mounted = null;

  if (android && !ios) {
    window.addEventListener("beforeinstallprompt", function (ev) { ev.preventDefault(); st.held = ev; draw(); });
    window.addEventListener("appinstalled", function () { st.held = null; st.waiting = false; st.added = true; draw(); });
  }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c != null) n.append(c); }
    return n;
  }
  function shareIcon() {
    var ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg");
    var a = { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
    for (var k in a) s.setAttribute(k, a[k]);
    s.style.verticalAlign = "-4px";
    ["M12 3v12", "M8 7l4-4 4 4", "M7 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"].forEach(function (d) {
      var p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.append(p);
    });
    return s;
  }
  function away() { if (mounted) mounted.card.remove(); mounted = null; st.hidden = true; }
  function button(label, act, onclick, primary) {
    var c = mounted.colors;
    var b = el("button", { type: "button", "data-act": act });
    b.textContent = label;
    b.style.cssText = "min-height:44px;padding:0 16px;font-size:15px;font-weight:600;font-family:inherit;border-radius:10px;cursor:pointer;" +
      (primary ? "border:0;background:" + c.accent + ";color:" + c.accentText + ";" : "border:1px solid " + c.line + ";background:transparent;color:" + c.fg + ";");
    b.addEventListener("click", onclick);
    return b;
  }
  function para(text, muted) {
    var p = el("p"); p.textContent = text;
    p.style.cssText = "margin:0 0 10px;font-size:15px;line-height:1.5;color:" + (muted ? mounted.colors.muted : "inherit");
    return p;
  }
  function ask() {
    var ev = st.held; if (!ev) return;
    st.held = null; st.waiting = true; draw();
    Promise.resolve().then(function () { return ev.prompt(); }).then(function () { return ev.userChoice; }).then(function (c) {
      if (!c || c.outcome !== "accepted") { st.waiting = false; away(); }
      /* accepted: still not "Added". The browser says so with appinstalled, and only then does the card. */
    }).catch(function () { st.waiting = false; away(); });
  }
  function inside() {
    if (st.added) { var a = para(WORDS.added); a.setAttribute("data-state", "added"); return [a]; }
    if (ios) {
      var li1 = el("li"); li1.append(shareIcon(), " " + WORDS.iosOne);
      var li2 = el("li"); li2.textContent = WORDS.iosTwo;
      var ol = el("ol"); ol.style.cssText = "margin:0 0 10px;padding-left:22px;font-size:15px;line-height:1.7"; ol.append(li1, li2);
      return [para(WORDS.why), para(WORDS.iosLead, true), ol, button(WORDS.notNow, "install-later", away, false)];
    }
    if (st.waiting) { var w = para(WORDS.waiting); w.setAttribute("data-state", "waiting"); return [w]; }
    if (st.held) {
      var row = el("div"); row.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";
      row.append(button(WORDS.button, "install-now", ask, true), button(WORDS.notNow, "install-later", away, false));
      return [para(WORDS.why), row];
    }
    return null; /* an Android browser has not said the site can be installed: no card, no promise */
  }
  function draw() {
    if (!mounted || st.hidden) return;
    var kids = inside();
    if (!kids) { mounted.card.hidden = true; return; }
    var m = mounted, c = m.colors;
    m.card.dataset.install = ios ? "ios" : "android";
    var head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:10px";
    if (m.icon) { var img = el("img", { src: m.icon, alt: "", width: "44", height: "44" }); img.style.cssText = "border-radius:10px;flex:none"; head.append(img); }
    var h = el("h2", { id: "install-title" }); h.textContent = "Put " + m.name + " on your phone";
    h.style.cssText = "margin:0;font-size:17px;line-height:1.3;font-weight:600";
    head.append(h);
    var body = el("div"); body.append.apply(body, kids);
    m.card.replaceChildren(head, body);
    m.card.hidden = false;
  }
  /* Put the card into `slot` when it should show: on a phone, until the app is open as an app. Safe to call again. */
  function mount(slot, opts) {
    opts = opts || {};
    if (!slot || !(ios || android) || standalone()) return;
    if (st.hidden && !st.added) return;
    var colors = Object.assign({ bg: "#ffffff", fg: "#1b1b1b", muted: "#5a5a5a", accent: "#1b1b1b", accentText: "#ffffff", line: "#c9c9c9" }, opts.colors || {});
    var card = el("section", { "aria-labelledby": "install-title", "data-install-card": "" });
    card.hidden = true;
    card.style.cssText = "box-sizing:border-box;margin:16px;padding:16px;border-radius:14px;border:1px solid " + colors.line + ";background:" + colors.bg + ";color:" + colors.fg;
    mounted = { slot: slot, card: card, name: opts.name || document.title, icon: opts.icon, colors: colors };
    slot.replaceChildren(card);
    draw();
  }
  window.InstallCard = { mount: mount, unmount: function () { if (mounted) { mounted.card.remove(); mounted = null; } } };
})();
