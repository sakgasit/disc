// Netlify adapter: routes in the query string, data via /api/class (Netlify Functions + Blobs).
(() => {
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const base = () => `${location.origin}${location.pathname}`;

  window.DISC_ENV = {
    canPrint: true,
    canShare: true,
    route: {
      read() {
        const p = new URLSearchParams(location.search);
        for (const kind of ["board", "join", "r"]) if (p.get(kind)) return { kind, val: p.get(kind) };
        return { kind: "", val: "" };
      },
      write(kind, val) { history.replaceState(null, "", kind ? `${location.pathname}?${kind}=${val}` : location.pathname); }
    },
    link: (kind, val) => `${base()}?${kind}=${val}`
  };

  async function api(path, opt = {}) {
    const r = await fetch("/api/class" + path, {
      ...opt, headers: { "content-type": "application/json", ...(opt.headers || {}) }
    });
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      const err = new Error(d.error || "http");
      err.status = r.status;
      err.code = r.status === 404 ? "notFound" : d.error === "full" ? "full" : "net";
      throw err;
    }
    return d;
  }
  const adminHeader = code => {
    const k = ls.get("disc-admin-" + code)?.key;
    return k ? { "x-admin-key": k } : {};
  };

  window.DISC_BACKEND = {
    ready: async () => true,
    async createClass(name) {
      const d = await api("", { method: "POST", body: JSON.stringify({ name }) });
      ls.set("disc-admin-" + d.code, { key: d.adminKey, name: d.name });
      return { code: d.code, name: d.name };
    },
    async getClass(code) {
      try { const d = await api("/" + code); return { name: d.name }; }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    subscribe(code, onData, onErr) {
      let stop = false;
      const tick = async () => {
        try {
          const d = await api("/" + code, { headers: adminHeader(code) });
          if (!stop) onData({ name: d.name, members: d.members, isAdmin: !!d.isAdmin, showNames: d.showNames !== false });
        } catch (e) {
          if (!stop) onErr(e.status === 404 ? "notFound" : "net");
        }
      };
      tick();
      const timer = setInterval(() => { if (!document.hidden) tick(); }, 8000);
      return () => { stop = true; clearInterval(timer); };
    },
    async join(code, m, scores) {
      await api(`/${code}/join`, { method: "POST", body: JSON.stringify({ id: m.id, token: m.token, nick: m.nick, scores }) });
    },
    async remove(code, id) {
      await api(`/${code}/member/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminHeader(code) });
    },
    async setShowNames(code, showNames) {
      await api(`/${code}`, { method: "PATCH", headers: adminHeader(code), body: JSON.stringify({ showNames }) });
    }
  };
})();
