(() => {
  const o = (t) => !!t.querySelector('a[href="/admin/super"]'), r = () => {
    document.querySelectorAll(".admin-nav").forEach((t) => {
      const n = t.querySelector("[data-live-link]");
      if (!o(t)) {
        n && n.remove();
        return;
      }
      if (n) return;
      const e = document.createElement("a");
      e.className = "admin-nav-item", e.href = "/live.html", e.target = "_blank", e.rel = "noopener", e.setAttribute("data-live-link", "1"), e.style.textDecoration = "none", e.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg><span>Live MESOB data</span>', t.appendChild(e);
    });
  };
  new MutationObserver(r).observe(document.documentElement, { childList: true, subtree: true }), r();
})();
