(function() {
  "use strict";
  var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var NUM = /\d[\d,]*(?:\.\d+)?/g;
  var states = new WeakMap();
  var ease = function(t) {
    return 1 - Math.pow(1 - t, 3);
  };
  function nums(str) {
    return (str.match(NUM) || []).map(function(x) {
      return parseFloat(x.replace(/,/g, ""));
    });
  }
  function like(tok, v) {
    var dec = (tok.split(".")[1] || "").length, t = dec ? v.toFixed(dec) : String(Math.round(v));
    if (tok.indexOf(",") > -1) {
      var p = t.split(".");
      p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      t = p.join(".");
    }
    return t;
  }
  function render(template, vals) {
    var i = 0;
    return template.replace(NUM, function(tok) {
      var v = vals[i++];
      return like(tok, v == null ? 0 : v);
    });
  }
  function animate(node, st, target, fromText, flash) {
    cancelAnimationFrame(st.raf);
    var to = nums(target), from = nums(fromText || "");
    if (!to.length) {
      st.last = target;
      return;
    }
    var t0 = performance.now(), dur = 900;
    st.target = target;
    function frame(now) {
      if (node.nodeValue !== st.last) {
        var ext = node.nodeValue, shown = st.last;
        st.last = ext;
        if (/\d/.test(ext)) animate(node, st, ext, shown, false);
        else st.raf = 0;
        return;
      }
      var p = Math.min(1, (now - t0) / dur), e = ease(p);
      var vals = to.map(function(v, i) {
        var f = from[i] == null ? 0 : from[i];
        return f + (v - f) * e;
      });
      var txt = p >= 1 ? target : render(target, vals);
      if (node.nodeValue !== txt) {
        st.last = txt;
        node.nodeValue = txt;
      }
      if (p < 1) st.raf = requestAnimationFrame(frame);
      else st.raf = 0;
    }
    st.raf = requestAnimationFrame(frame);
    if (flash && node.parentNode) {
      var el = node.parentNode;
      el.removeAttribute("data-flash");
      void el.offsetWidth;
      el.setAttribute("data-flash", "1");
      setTimeout(function() {
        el.removeAttribute("data-flash");
      }, 950);
    }
  }
  function scan() {
    var els = document.querySelectorAll(".mb-dash .mb-scalar-v");
    for (var i = 0; i < els.length; i++) {
      var el = els[i], node = el.firstChild;
      if (!node || node.nodeType !== 3 || el.childNodes.length !== 1) continue;
      var cur = node.nodeValue, st = states.get(node);
      if (!st) {
        st = { last: cur, target: cur, raf: 0 };
        states.set(node, st);
        if (!REDUCED && /\d/.test(cur)) animate(node, st, cur, "", false);
      } else if (cur !== st.last) {
        var shown = st.last;
        st.last = cur;
        if (REDUCED || !/\d/.test(cur)) {
          st.target = cur;
          continue;
        }
        animate(node, st, cur, shown, !st.raf);
      }
    }
    var paths = document.querySelectorAll(".mb-dash .mb-linewrap svg path[fill=none]:not([data-draw])");
    for (var j = 0; j < paths.length; j++) {
      paths[j].setAttribute("pathLength", "1");
      if (!REDUCED) paths[j].setAttribute("data-draw", "1");
    }
  }
  var pending = false;
  new MutationObserver(function() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function() {
      pending = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (!REDUCED) {
    var raf = 0, last = null;
    document.addEventListener("pointermove", function(e) {
      if (e.pointerType === "touch") return;
      var t = e.target && e.target.closest && e.target.closest(".mb-dash .mb-scalar, .mb-dash .mb-card");
      last = t ? { t, x: e.clientX, y: e.clientY } : null;
      if (raf) return;
      raf = requestAnimationFrame(function() {
        raf = 0;
        if (!last) return;
        var r = last.t.getBoundingClientRect(), px = (last.x - r.left) / r.width, py = (last.y - r.top) / r.height;
        last.t.style.setProperty("--mx", last.x - r.left + "px");
        last.t.style.setProperty("--my", last.y - r.top + "px");
        if (last.t.classList.contains("mb-scalar")) {
          last.t.style.setProperty("--ry", ((px - 0.5) * 12).toFixed(2) + "deg");
          last.t.style.setProperty("--rx", ((0.5 - py) * 10).toFixed(2) + "deg");
        }
      });
    }, { passive: true });
    document.addEventListener("pointerout", function(e) {
      var t = e.target && e.target.closest && e.target.closest(".mb-dash .mb-scalar");
      if (t && !t.contains(e.relatedTarget)) {
        t.style.setProperty("--rx", "0deg");
        t.style.setProperty("--ry", "0deg");
      }
    }, { passive: true });
    document.addEventListener("pointerdown", function(e) {
      var b = e.target && e.target.closest && e.target.closest(".admin-btn, .st-chip, .mb-hb, .mb-d-fetch, .mb-d-reset, .mb-d-retry, .mb-d-tabs button");
      if (!b || b.disabled) return;
      b.setAttribute("data-rip", "1");
      var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement("span");
      s.className = "mb-rip";
      s.style.cssText = "width:" + d + "px;height:" + d + "px;left:" + (e.clientX - r.left - d / 2) + "px;top:" + (e.clientY - r.top - d / 2) + "px";
      b.appendChild(s);
      setTimeout(function() {
        if (s.parentNode) s.parentNode.removeChild(s);
      }, 700);
    }, { passive: true });
  }
  scan();
})();
