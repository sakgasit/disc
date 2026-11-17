// Artifact adapter: routes in the #hash, data in the artifact's shared database.
(() => {
  const PAGE_URL = "__PAGE_URL__";
  const CODE_RE = /^[A-Z0-9]{6}$/;
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  window.DISC_ENV = {
    canPrint: false,
    canShare: false,
    route: {
      read() {
        const h = decodeURIComponent(location.hash.slice(1));
        const i = h.indexOf("-");
        if (i < 0) return { kind: "", val: "" };
        return { kind: h.slice(0, i), val: h.slice(i + 1) };
      },
      write(kind, val) {
        try { history.replaceState(null, "", kind ? `#${kind}-${val}` : location.pathname + location.search); } catch (e) {}
      }
    },
    link: (kind, val) => `${PAGE_URL}#${kind}-${val}`
  };

  let db = null, myId = null, owner = false;
  const waitForClaude = async () => {
    for (let i = 0; i < 30 && !(window.claude && window.claude.use); i++) await new Promise(r => setTimeout(r, 100));
    return window.claude && window.claude.use ? window.claude : null;
  };
  const readyP = (async () => {
    try {
      const claude = await waitForClaude();
      if (!claude) return false;
      db = await claude.use("db");
      const user = await claude.use("user");
      if (user) {
        try { myId = await user.id(); } catch (e) {}
        try { owner = !!(await user.isOwner()); } catch (e) {}
      }
    } catch (e) { db = null; }
    return !!db;
  })();

  const fail = e => {
    const err = new Error(e && e.message || "db");
    err.code = e && e.code === "invalid_argument" ? "perm" : e && e.code === "quota_exceeded" ? "full" : "net";
    return err;
  };
  const cleanNick = s => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
  const validScores = s => s && ["D", "I", "S", "C"].every(k => Number.isInteger(s[k]) && s[k] >= 0 && s[k] <= 100);

  window.DISC_BACKEND = {
    ready: () => readyP,

    async createClass(rawName) {
      const name = String(rawName).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
      try {
        for (let i = 0; i < 8; i++) {
          const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join("");
          const ref = db.doc("classes/" + code);
          if ((await ref.get()).exists) continue;
          await ref.set({ name, created: Date.now(), creator: myId || "", showNames: true });
          return { code, name };
        }
      } catch (e) { throw fail(e); }
      throw fail(null);
    },

    async getClass(code) {
      if (!CODE_RE.test(code)) return null;
      const s = await db.doc("classes/" + code).get();
      return s.exists ? { name: String(s.data().name || code) } : null;
    },

    subscribe(code, onData, onErr) {
      let meta, metaKnown = false, members = null, done = false;
      const timer = setTimeout(() => { if (!metaKnown || members === null) onErr("net"); }, 10000);
      const emit = () => {
        if (!metaKnown || members === null || done) return;
        if (!meta) return onErr("notFound");
        onData({
          name: String(meta.name || code),
          showNames: meta.showNames !== false,
          isAdmin: owner || (!!myId && meta.creator === myId),
          members
        });
      };
      const u1 = db.doc("classes/" + code).onSnapshot(s => {
        if (!s.exists && s.metadata.fromCache) return; // wait for the server's answer
        metaKnown = true; meta = s.exists ? s.data() : null;
        if (!s.metadata.fromCache) clearTimeout(timer);
        emit();
      }, () => onErr("net"));
      const u2 = db.collection(`classes/${code}/members`).onSnapshot(s => {
        members = s.docs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }))
          .filter(m => validScores(m.scores) && cleanNick(m.nick))
          .map(m => ({ id: m.id, nick: cleanNick(m.nick), scores: m.scores, at: m.at || 0 }))
          .sort((a, b) => a.at - b.at);
        emit();
      }, () => onErr("net"));
      return () => { done = true; clearTimeout(timer); u1(); u2(); };
    },

    async join(code, m, scores) {
      try {
        await db.doc(`classes/${code}/members/${m.id}`).set({ nick: cleanNick(m.nick), scores, at: Date.now() });
      } catch (e) { throw fail(e); }
    },

    async remove(code, id) {
      try { await db.doc(`classes/${code}/members/${id}`).delete(); } catch (e) { throw fail(e); }
    },

    async setShowNames(code, showNames) {
      try { await db.doc("classes/" + code).update({ showNames: !!showNames }); } catch (e) { throw fail(e); }
    }
  };

  window.DISC_ENV.onRouteChange = fn => window.addEventListener("hashchange", fn);
})();
