(function() {
  "use strict";
  var AM = /[\u1200-\u137F]/;
  var T = {
    en: {
      title: "Data & filters",
      src: "Data source",
      fil: "Filters",
      period: "Period",
      exp: "Export",
      reset: "Reset",
      retry: "Retry",
      saved: "Using saved copy",
      loaded: "Data loaded",
      none: "No data loaded",
      unreach: "QMS is unreachable.",
      tk: "tickets loaded.",
      press: "Press Fetch from QMS.",
      dr: "Date range",
      where: "Where",
      tkt: "Ticket",
      close: "Close"
    },
    am: {
      title: "\u1218\u1228\u1303 \u12A5\u1293 \u121B\u1323\u122A\u12EB",
      src: "\u12E8\u1218\u1228\u1303 \u121D\u1295\u132D",
      fil: "\u121B\u1323\u122A\u12EB",
      period: "\u130A\u12DC",
      exp: "\u120B\u12AD",
      reset: "\u12F3\u130D\u121D \u12A0\u1235\u1300\u121D\u122D",
      retry: "\u12A5\u1295\u12F0\u1308\u1293",
      saved: "\u12E8\u1270\u1240\u1218\u1320 \u1245\u1302 \u12A5\u12E8\u1270\u1320\u1240\u1218 \u1290\u12CD",
      loaded: "\u1218\u1228\u1303 \u1270\u132D\u1297\u120D",
      none: "\u1218\u1228\u1303 \u12A0\u120D\u1270\u132B\u1290\u121D",
      unreach: "QMS \u12A0\u12ED\u12F0\u1228\u1235\u121D\u1362",
      tk: "\u1275\u12AC\u1276\u127D \u1270\u132D\u1290\u12CB\u120D\u1362",
      press: "\xABFetch from QMS\xBB \u12ED\u132B\u1291\u1362",
      dr: "\u12E8\u1240\u1295 \u12AD\u120D\u120D",
      where: "\u1266\u1273",
      tkt: "\u1275\u12AC\u1275",
      close: "\u12DD\u130B"
    }
  };
  var bg = null, flag = null;
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.textContent = html;
    return n;
  }
  function origFetch(p) {
    var box = p.querySelector(".admin-card > div");
    if (!box) return null;
    var bs = box.querySelectorAll(":scope > div > button.admin-btn-primary");
    return bs.length ? bs[0] : null;
  }
  function hide(p) {
    if (p.classList.contains("mb-d-hidden") || p.classList.contains("mb-d-out")) return;
    var b = bg;
    p.classList.add("mb-d-out");
    if (b) b.classList.add("mb-d-out");
    setTimeout(function() {
      p.classList.remove("mb-d-out");
      p.classList.add("mb-d-hidden");
      if (b) {
        b.classList.remove("mb-d-out");
        b.classList.add("mb-d-hidden");
      }
    }, 230);
  }
  function show(p) {
    p.classList.remove("mb-d-hidden");
    if (bg) bg.classList.remove("mb-d-hidden");
  }
  function build(p) {
    p.setAttribute("data-drw", "1");
    p.setAttribute("data-tab", "source");
    var card = p.querySelector(".admin-card");
    if (!card) return;
    var box = card.firstElementChild;
    var of = origFetch(p);
    var am = !!(of && AM.test(of.textContent)) || /[\u1200-\u137F]/.test((p.querySelector(".st-quick") || {}).textContent || "");
    var L = am ? T.am : T.en;
    p._L = L;
    bg = el("div", "mb-drawer-bg");
    bg.addEventListener("click", function() {
      hide(p);
    });
    document.body.appendChild(bg);
    var head = el("div", "mb-d-head");
    head.appendChild(el("h2", "", L.title));
    var x = el("button", "mb-d-x", "\xD7");
    x.type = "button";
    x.setAttribute("aria-label", L.close);
    x.addEventListener("click", function() {
      hide(p);
    });
    head.appendChild(x);
    var ban = el("div", "mb-d-banner");
    var dot = el("i", "mb-d-dot");
    var bt = el("div", "mb-d-bt");
    var b1 = el("b");
    var b2 = el("span");
    bt.appendChild(b1);
    bt.appendChild(b2);
    var rt = el("button", "mb-d-retry", L.retry);
    rt.type = "button";
    rt.addEventListener("click", function() {
      var f = origFetch(p);
      if (f) f.click();
    });
    ban.appendChild(dot);
    ban.appendChild(bt);
    ban.appendChild(rt);
    var tabs = el("div", "mb-d-tabs");
    var t1 = el("button", "on", L.src), t2 = el("button", "", L.fil);
    t1.type = t2.type = "button";
    function sel(k) {
      p.setAttribute("data-tab", k);
      t1.className = k === "source" ? "on" : "";
      t2.className = k === "filters" ? "on" : "";
    }
    t1.addEventListener("click", function() {
      sel("source");
    });
    t2.addEventListener("click", function() {
      sel("filters");
    });
    tabs.appendChild(t1);
    tabs.appendChild(t2);
    var foot = el("div", "mb-d-foot");
    var rs = el("button", "mb-d-reset", L.reset);
    rs.type = "button";
    rs.addEventListener("click", function() {
      var b = p.querySelector(".mb-filters .admin-btn-outline:last-child");
      if (b) b.click();
    });
    var fb = el("button", "mb-d-fetch", "");
    fb.type = "button";
    fb.addEventListener("click", function() {
      var f = origFetch(p);
      if (f && !f.disabled) {
        f.click();
        flag = { busy: false, t: Date.now() };
      }
    });
    foot.appendChild(rs);
    foot.appendChild(fb);
    p.insertBefore(head, p.firstChild);
    p.insertBefore(ban, head.nextSibling);
    p.insertBefore(tabs, ban.nextSibling);
    p.appendChild(foot);
    p._ui = { b1, b2, ban, rt, fb, rs, t2, sel, box };
    if (box) {
      var h = el("div", "mb-d-sec mb-d-sec-p", L.period);
      box.insertBefore(h, box.firstChild);
      var h2 = el("div", "mb-d-sec mb-d-sec-e", L.exp);
      box.appendChild(h2);
    }
  }
  function addFilterHeads(p) {
    var f = p.querySelector(".mb-filters");
    if (!f || f.querySelector(".mb-d-sec")) return;
    var g = f.querySelector(":scope > div:not(.st-print-title)");
    if (!g) return;
    var L = p._L;
    [["mb-d-sec-1", L.dr], ["mb-d-sec-2", L.where], ["mb-d-sec-3", L.tkt]].forEach(function(a) {
      g.insertBefore(el("div", "mb-d-sec " + a[0], a[1]), g.firstChild);
    });
  }
  function refresh(p) {
    var u = p._ui;
    if (!u) return;
    var L = p._L;
    var sum = p.querySelector(".st-source-sum span:last-child");
    var n = sum ? (sum.textContent.match(/[\d,]+/) || ["0"])[0] : "0";
    var cnt = parseInt(n.replace(/,/g, ""), 10) || 0;
    var err = p.querySelector(".auth-msg.err");
    var errTxt = err ? err.textContent.trim() : "";
    var kind, t1, t2;
    if (err) {
      kind = "bad";
      t1 = cnt ? L.saved : L.none;
      t2 = L.unreach + (cnt ? " " + cnt.toLocaleString() + " " + L.tk : errTxt ? " " + errTxt : "");
    } else if (cnt) {
      kind = "ok";
      t1 = L.loaded;
      t2 = cnt.toLocaleString() + " " + L.tk;
    } else {
      kind = "idle";
      t1 = L.none;
      t2 = L.press;
    }
    if (u.b1.textContent !== t1) u.b1.textContent = t1;
    if (u.b2.textContent !== t2) u.b2.textContent = t2;
    if (u.ban.getAttribute("data-k") !== kind) u.ban.setAttribute("data-k", kind);
    u.rt.style.display = kind === "ok" ? "none" : "";
    var f = origFetch(p);
    if (f) {
      if (u.fb.textContent !== f.textContent) u.fb.textContent = f.textContent;
      u.fb.disabled = f.disabled;
    }
    var hasF = !!p.querySelector(".mb-filters");
    u.t2.disabled = !hasF;
    if (!hasF && p.getAttribute("data-tab") === "filters") u.sel("source");
    u.rs.disabled = !hasF;
    if (hasF) addFilterHeads(p);
    if (flag && f) {
      if (f.disabled) flag.busy = true;
      if (flag.busy && !f.disabled || Date.now() - flag.t > 9e4) {
        if (!err && cnt) hide(p);
        flag = null;
      }
    }
  }
  function scan() {
    var p = document.querySelector(".mb-dash .st-source-panel");
    if (!p) {
      if (bg) {
        bg.remove();
        bg = null;
      }
      return;
    }
    if (!p.getAttribute("data-drw")) build(p);
    refresh(p);
  }
  var pend = false;
  new MutationObserver(function() {
    if (pend) return;
    pend = true;
    requestAnimationFrame(function() {
      pend = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
  document.addEventListener("click", function(e) {
    var b = e.target && e.target.closest && e.target.closest(".mb-dash .mb-hb");
    if (!b) return;
    var p = document.querySelector(".mb-dash .st-source-panel");
    if (!p || !p.getAttribute("data-drw")) return;
    e.stopPropagation();
    e.preventDefault();
    if (p.classList.contains("mb-d-hidden")) show(p);
    else hide(p);
  }, true);
  document.addEventListener("keydown", function(e) {
    if (e.key !== "Escape") return;
    var p = document.querySelector(".mb-dash .st-source-panel");
    if (p && !p.classList.contains("mb-d-hidden") && !document.querySelector(".dp-pop")) hide(p);
  });
  document.addEventListener("change", function(e) {
    var sel = e.target;
    if (!sel || sel.tagName !== "SELECT") return;
    var p = sel.closest && sel.closest(".mb-dash .st-source-panel[data-drw]");
    if (!p) return;
    var lab = sel.closest("label");
    var g = lab && lab.parentElement;
    if (!g || [].indexOf.call(g.querySelectorAll(":scope > label"), lab) !== 2) return;
    setTimeout(function() {
      var f = origFetch(p);
      if (f && !f.disabled) {
        f.click();
        flag = { busy: false, t: Date.now() };
      }
    }, 250);
  }, true);
  scan();
})();
