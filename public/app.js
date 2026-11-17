(() => {
  "use strict";
  // ENV and BACKEND are provided by a small adapter script loaded before this one:
  //   public/backend.js  -> Netlify (Functions + Blobs)
  //   artifact build     -> Claude artifact database
  const ENV = window.DISC_ENV;
  const BK = window.DISC_BACKEND;

  const $ = s => document.querySelector(s);
  const view = $("#view");
  const STORE = "disc-result-v1";
  const TOTAL = 28;
  const ORDER = ["D", "I", "S", "C"];
  const keyOf = i => ORDER[i % 4];
  const CODE_RE = /^[A-Z0-9]{6}$/;

  // ---------- helpers ----------
  const mem = {};
  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v == null ? (mem[k] ?? null) : JSON.parse(v); } catch (e) { return mem[k] ?? null; } },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""));

  let lang = LS.get("disc-lang") || ((navigator.language || "").toLowerCase().startsWith("th") ? "th" : "en");
  if (!I18N[lang]) lang = "en";
  const L = () => I18N[lang];
  const P = () => L().profiles;
  const t = (k, v = {}) => (L().ui[k] ?? I18N.en.ui[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? "");
  const rank = sc => ORDER.slice().sort((a, b) => sc[b] - sc[a] || ORDER.indexOf(a) - ORDER.indexOf(b));

  const S = { idx: 0, answers: [], cls: null, render: null, actions: {}, unsub: null, nav: 0,
              lock: false, submit: null, boards: {}, classes: {}, boardErr: null, confirmId: null };

  function go(fn) {
    if (S.unsub) { S.unsub(); S.unsub = null; }
    S.nav++; S.confirmId = null;
    S.render = fn; fn(); window.scrollTo(0, 0);
  }
  const bind = map => { S.actions = map; };
  view.addEventListener("click", e => {
    const el = e.target.closest("[data-a]");
    if (!el || !view.contains(el)) return;
    const f = S.actions[el.dataset.a];
    if (f) f(el);
  });

  const memberRec = code => LS.get("disc-member-" + code);
  function ensureMember(code, nick) {
    const m = memberRec(code) || { id: rid(), token: rid() };
    m.nick = nick; LS.set("disc-member-" + code, m); return m;
  }
  const myClasses = () => (LS.get("disc-my-classes") || []).filter(c => CODE_RE.test(c.code));
  function rememberClass(code, name) {
    LS.set("disc-my-classes", [{ code, name }, ...myClasses().filter(c => c.code !== code)].slice(0, 12));
  }

  function setLang(l, rerender = true) {
    lang = l; LS.set("disc-lang", l);
    document.documentElement.lang = l;
    document.title = t("title");
    document.querySelectorAll("[data-lang]").forEach(b => b.classList.toggle("on", b.dataset.lang === l));
    $("#foot").textContent = t("footer");
    if (rerender && S.render) {
      const keep = [...view.querySelectorAll("input[id]:not([readonly])")].map(i => [i.id, i.value]);
      S.render();
      keep.forEach(([id, v]) => { const i = document.getElementById(id); if (i) i.value = v; });
    }
  }

  const msgCard = (msg, extra = "") => `
    <section class="card"><p class="err">${msg}</p>
      <div class="row">${extra}<button class="btn ghost" data-a="home">${t("home")}</button></div></section>`;
  const loadingCard = () => `<section class="card"><p class="muted" style="margin:0">${t("loading")}</p></section>`;

  async function needBackend() {
    const nav = S.nav;
    const ok = await BK.ready();
    if (S.nav !== nav) return false;
    if (!ok) { view.innerHTML = msgCard(t("errUnavailable")); bind({ home: () => go(intro) }); }
    return ok;
  }

  // ---------- intro ----------
  function intro() {
    ENV.route.write("");
    const mine = myClasses();
    view.innerHTML = `
      <section class="card">
        <h1>${t("introTitle")}</h1>
        <p class="muted">${t("introText")}</p>
        <div class="quad">${["D", "I", "C", "S"].map(k => `
          <div style="background:var(--${k})"><strong>${k}</strong>${P()[k].name}<br><small>${P()[k].short}</small></div>`).join("")}
        </div>
        <div class="row">
          <button class="btn" data-a="start">${t("start")}</button>
          ${LS.get(STORE) ? `<button class="btn ghost" data-a="last">${t("resume")}</button>` : ""}
        </div>
      </section>
      <section class="card">
        <h2>👩‍🏫 ${t("classTitle")}</h2>
        <p class="muted">${t("classText")}</p>
        <div class="row">
          <button class="btn" data-a="create">${t("createClass")}</button>
          <button class="btn ghost" data-a="join">${t("joinClass")}</button>
        </div>
        ${mine.length ? `<p class="lbl">${t("yourClasses")}</p><div class="chips">${mine.map(c =>
          `<button class="chip" data-a="open" data-code="${c.code}">${esc(c.name || c.code)} · ${c.code}</button>`).join("")}</div>` : ""}
      </section>`;
    bind({
      start: () => { S.cls = null; startQuiz(); },
      last: () => go(() => results(LS.get(STORE))),
      create: () => go(createView),
      join: () => go(() => joinView(null)),
      open: el => go(() => board(el.dataset.code))
    });
  }

  // ---------- quiz ----------
  function startQuiz() {
    S.idx = 0; S.answers = new Array(TOTAL).fill(null); S.lock = false;
    go(quiz);
  }
  function quiz() {
    const n = S.idx, pct = Math.round(n / TOTAL * 100);
    view.innerHTML = `
      <section class="card">
        ${S.cls ? `<div class="badge">${t("classBadge", { c: esc(S.cls.name), n: esc(S.cls.nick) })}</div>` : ""}
        <div class="row between">
          <span class="qcount">${t("qOf", { n: n + 1, t: TOTAL })}</span><span class="qcount">${pct}%</span>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
        <div class="qtext">${L().q[n]}</div>
        <div class="scale">${L().scale.map((l, i) =>
          `<button data-a="pick" data-v="${i + 1}" class="${S.answers[n] === i + 1 ? "sel" : ""}"><span class="dot"></span>${l}</button>`).join("")}
        </div>
        <div class="row between" style="margin-top:24px">
          <button class="btn ghost" data-a="back">${t("back")}</button>
          <span class="muted small hide-mobile">${t("keysTip")}</span>
        </div>
      </section>`;
    bind({
      pick: el => choose(+el.dataset.v),
      back: () => {
        if (S.idx > 0) { S.idx--; quiz(); }
        else go(S.cls ? () => joinView(S.cls.code) : intro);
      }
    });
  }
  function choose(v) {
    if (S.lock) return;
    S.lock = true;
    S.answers[S.idx] = v;
    view.querySelectorAll("[data-v]").forEach(b => b.classList.toggle("sel", +b.dataset.v === v));
    setTimeout(() => {
      S.lock = false;
      if (S.idx < TOTAL - 1) { S.idx++; quiz(); } else finish();
    }, 180);
  }
  document.addEventListener("keydown", e => {
    if (S.render !== quiz || e.target.tagName === "INPUT") return;
    if (e.key >= "1" && e.key <= "5") choose(+e.key);
    if (e.key === "ArrowLeft") S.actions.back();
  });

  function finish() {
    const raw = { D: 0, I: 0, S: 0, C: 0 };
    S.answers.forEach((v, i) => { raw[keyOf(i)] += v; });
    const sc = {};
    ORDER.forEach(k => { sc[k] = Math.round((raw[k] - 7) / 28 * 100); }); // 7 items × 1–5 → 0–100
    LS.set(STORE, sc);
    if (S.cls) {
      const cls = S.cls;
      go(() => results(sc, cls));
      submit(sc, cls);
    } else {
      ENV.route.write("");
      go(() => results(sc));
    }
  }
  async function submit(sc, cls) {
    S.submit = "saving"; updateStatus(cls);
    try {
      await BK.join(cls.code, memberRec(cls.code), sc);
      S.submit = "saved";
    } catch (e) {
      S.submit = e.code === "full" ? "full" : e.code === "perm" ? "perm" : "error";
    }
    updateStatus(cls);
  }
  function statusHTML(cls) {
    const boardBtn = `<button class="btn small" data-a="board">${t("viewBoard")}</button>`;
    if (S.submit === "saving") return `<p>⏳ ${t("saving")}</p>`;
    if (S.submit === "saved") return `<p>✅ ${t("saved", { c: esc(cls.name) })}</p>${boardBtn}`;
    if (S.submit === "full") return `<p>⚠️ ${t("errFull")}</p>${boardBtn}`;
    if (S.submit === "perm") return `<p>⚠️ ${t("errPerm")}</p>${boardBtn}`;
    return `<p>⚠️ ${t("errSave")}</p><div class="row"><button class="btn small" data-a="retry">${t("retry")}</button>${boardBtn}</div>`;
  }
  function updateStatus(cls) { const el = $("#clsStatus"); if (el) el.innerHTML = statusHTML(cls); }

  // ---------- results ----------
  function results(sc, cls = null, shared = false) {
    if (!sc) return go(intro);
    const [p1, p2] = rank(sc);
    const prof = P()[p1];
    const close = sc[p1] - sc[p2] <= 12;
    const total = ORDER.reduce((a, k) => a + sc[k], 0) || 1;
    const share = k => Math.round(sc[k] / total * 100);
    const list = arr => `<ul>${arr.map(x => `<li>${x}</li>`).join("")}</ul>`;

    view.innerHTML = `
      ${cls ? `<section class="card status noprint" id="clsStatus">${statusHTML(cls)}</section>` : ""}
      <div class="hero" style="background:var(--${p1})">
        <div class="tag">${shared ? t("sharedResult") + " · " : ""}${cls ? esc(cls.nick) + " · " : ""}${t("primary")}</div>
        <h1>${p1} — ${prof.nick}</h1>
        <p style="margin:0;opacity:.95">${prof.summary}</p>
      </div>

      <section class="card">
        <h2>${t("scoresTitle")}</h2>
        <p class="muted">${t("scoresSub")}</p>
        <div class="grid2" style="align-items:center">
          <div class="bars">${ORDER.map(k => `
            <div class="bar">
              <label><span>${k} · ${P()[k].name}</span><span>${sc[k]}</span></label>
              <div class="track"><div class="fill" data-w="${sc[k]}" style="background:var(--${k})"></div></div>
            </div>`).join("")}
          </div>
          ${wheel(sc)}
        </div>
      </section>

      <section class="card">
        <h2>${t("blend")}: ${p1}${p2} <span class="pill" style="background:var(--${p2})">${t("secondary")} ${p2}</span></h2>
        <p>${L().blends[p1 + p2]}</p>
        <p class="muted" style="margin:0">${close ? t("closeMsg", { a: p1, b: p2 }) : t("clearMsg", { a: p1, b: p2, p: share(p1) })}</p>
      </section>

      <div class="grid2">
        <section class="card"><h3 style="margin-top:0">${t("strengths")}</h3>${list(prof.strengths)}</section>
        <section class="card"><h3 style="margin-top:0">${t("watch")}</h3>${list(prof.blind)}</section>
        <section class="card"><h3 style="margin-top:0">${t("motiv")}</h3>${list(prof.motiv)}</section>
        <section class="card"><h3 style="margin-top:0">${t("comm")}</h3>${list(prof.comm)}</section>
      </div>

      <section class="card">
        <h3 style="margin-top:0">${t("stress")}</h3>
        <p>${prof.stress}</p>
        <h3>${t("careers", { k: p1 })}</h3>
        <p style="margin:0">${prof.careers}</p>
      </section>

      <section class="card">
        <h2>${t("others")}</h2>
        ${rank(sc).slice(1).map(k => `
          <h3><span class="pill" style="background:var(--${k})">${k}</span> ${P()[k].nick} · ${sc[k]}</h3>
          <p class="muted" style="margin:0">${P()[k].summary}</p>`).join("")}
      </section>

      <div class="row noprint">
        <button class="btn" data-a="share">${t("share")}</button>
        ${ENV.canPrint ? `<button class="btn ghost" data-a="print">${t("print")}</button>` : ""}
        <button class="btn ghost" data-a="retake">${t("retake")}</button>
      </div>
      <p class="muted noprint small" id="shareMsg"></p>`;

    requestAnimationFrame(() => setTimeout(() => {
      view.querySelectorAll(".fill").forEach(f => { f.style.width = f.dataset.w + "%"; });
    }, 60));

    bind({
      board: () => go(() => board(cls.code)),
      retry: () => submit(sc, cls),
      print: () => window.print(),
      retake: () => { S.cls = cls || null; startQuiz(); },
      share: async () => {
        const url = ENV.link("r", `${sc.D}-${sc.I}-${sc.S}-${sc.C}`);
        const text = t("shareText", { s: p1 + p2, n: prof.nick });
        try {
          if (ENV.canShare && navigator.share) { await navigator.share({ title: "DISC", text, url }); return; }
          await navigator.clipboard.writeText(url);
          $("#shareMsg").textContent = t("copied");
        } catch (e) { if (e.name !== "AbortError") $("#shareMsg").textContent = url; }
      }
    });
  }

  function wheel(sc) {
    const cx = 140, cy = 140, R = 120;
    // classic layout: D top-left, I top-right, S bottom-right, C bottom-left
    const angles = { D: [180, 270], I: [270, 360], S: [0, 90], C: [90, 180] };
    const pt = (a, r) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    let s = `<svg class="wheel" viewBox="0 0 280 280" role="img" aria-label="DISC">`;
    ORDER.forEach(k => {
      const [a0, a1] = angles[k];
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
      s += `<path d="M${cx},${cy} L${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} Z" style="fill:var(--${k});opacity:.15"/>`;
      const r = 20 + (R - 20) * sc[k] / 100;
      const [u0, v0] = pt(a0, r), [u1, v1] = pt(a1, r);
      s += `<path d="M${cx},${cy} L${u0},${v0} A${r},${r} 0 0 1 ${u1},${v1} Z" style="fill:var(--${k});opacity:.9"/>`;
      const [lx, ly] = pt((a0 + a1) / 2, R - 18);
      s += `<text x="${lx}" y="${ly + 6}" text-anchor="middle" font-size="18" font-weight="800" fill="currentColor">${k}</text>`;
    });
    return s + `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="currentColor" stroke-opacity=".15"/></svg>`;
  }

  // ---------- create class ----------
  async function createView() {
    ENV.route.write("");
    if (!(await needBackend())) return;
    view.innerHTML = `
      <section class="card">
        <h2>${t("createTitle")}</h2>
        <p class="muted">${t("createText")}</p>
        <label class="lbl" for="cname">${t("className")}</label>
        <input id="cname" class="input" maxlength="60" autocomplete="off" placeholder="${esc(t("classNamePh"))}">
        <p class="err" id="err"></p>
        <div class="row">
          <button class="btn" data-a="create">${t("create")}</button>
          <button class="btn ghost" data-a="home">${t("cancel")}</button>
        </div>
      </section>`;
    const inp = $("#cname");
    const doCreate = async () => {
      const name = inp.value.trim();
      if (!name) { $("#err").textContent = t("errName"); return; }
      const btn = view.querySelector('[data-a="create"]'); btn.disabled = true;
      try {
        const d = await BK.createClass(name);
        rememberClass(d.code, d.name);
        go(() => board(d.code));
      } catch (e) {
        if ($("#err")) { $("#err").textContent = e.code === "perm" ? t("errPerm") : t("errNet"); btn.disabled = false; }
      }
    };
    inp.onkeydown = e => { if (e.key === "Enter") doCreate(); };
    bind({ create: doCreate, home: () => go(intro) });
  }

  // ---------- join class ----------
  async function joinView(code) {
    if (!code) {
      ENV.route.write("");
      view.innerHTML = `
        <section class="card">
          <h2>${t("joinTitle")}</h2>
          <p class="muted">${t("joinText")}</p>
          <label class="lbl" for="ccode">${t("codeLabel")}</label>
          <input id="ccode" class="input" maxlength="6" autocomplete="off" autocapitalize="characters"
                 style="text-transform:uppercase;letter-spacing:3px;font-weight:700" placeholder="ABC123">
          <p class="err" id="err"></p>
          <div class="row">
            <button class="btn" data-a="next">${t("next")}</button>
            <button class="btn ghost" data-a="home">${t("cancel")}</button>
          </div>
        </section>`;
      const inp = $("#ccode");
      const next = () => {
        const c = inp.value.trim().toUpperCase();
        if (!CODE_RE.test(c)) { $("#err").textContent = t("errCode"); return; }
        go(() => joinView(c));
      };
      inp.onkeydown = e => { if (e.key === "Enter") next(); };
      bind({ next, home: () => go(intro) });
      return;
    }

    ENV.route.write("join", code);
    const nav = S.nav;
    if (!S.classes[code]) {
      view.innerHTML = loadingCard(); bind({});
      if (!(await needBackend())) return;
      let info = null, failed = false;
      try { info = await BK.getClass(code); } catch (e) { failed = true; }
      if (S.nav !== nav) return;
      if (!info) {
        view.innerHTML = msgCard(failed ? t("errNet") : t("errNotFound"), `<button class="btn" data-a="again">${t("joinTitle")}</button>`);
        bind({ again: () => go(() => joinView(null)), home: () => go(intro) });
        return;
      }
      S.classes[code] = info;
    }

    const info = S.classes[code];
    const prev = memberRec(code)?.nick || "";
    view.innerHTML = `
      <section class="card">
        <p class="qcount" style="margin:0">${t("youJoin")}</p>
        <h1 style="margin:4px 0">${esc(info.name)}</h1>
        <p class="muted">${t("codeLabel")}: <b>${code}</b></p>
        <label class="lbl" for="nick">${t("nickLabel")}</label>
        <input id="nick" class="input" maxlength="20" autocomplete="nickname" placeholder="${esc(t("nickPh"))}" value="${esc(prev)}">
        <p class="hint">${t("nickHint")}</p>
        ${prev ? `<p class="hint"><button class="linkbtn" data-a="other">${t("notYou", { n: esc(prev) })}</button></p>` : ""}
        <p class="err" id="err"></p>
        <div class="row">
          <button class="btn" data-a="go">${t("startClass")}</button>
          <button class="btn ghost" data-a="board">${t("viewBoard")}</button>
        </div>
      </section>`;
    const inp = $("#nick");
    const start = () => {
      const nick = inp.value.trim().slice(0, 20);
      if (!nick) { $("#err").textContent = t("errNick"); inp.focus(); return; }
      ensureMember(code, nick);
      S.cls = { code, name: info.name, nick };
      startQuiz();
    };
    inp.onkeydown = e => { if (e.key === "Enter") start(); };
    bind({
      go: start,
      board: () => go(() => board(code)),
      // lets a shared device (or a teacher testing) join as a new person
      other: () => { LS.set("disc-member-" + code, null); joinView(code); }
    });
  }

  // ---------- class board ----------
  async function board(code) {
    ENV.route.write("board", code);
    S.boardErr = null;
    const draw = () => drawBoard(code);
    S.render = draw;
    draw();
    const nav = S.nav;
    if (!(await needBackend()) || S.nav !== nav) return;
    if (S.unsub) S.unsub();
    S.unsub = BK.subscribe(code,
      d => {
        if (S.nav !== nav) return;
        const changed = JSON.stringify(d) !== JSON.stringify(S.boards[code]);
        S.boards[code] = d; S.classes[code] = { name: d.name }; S.boardErr = null;
        if (d.isAdmin) rememberClass(code, d.name);
        if (changed) draw();
      },
      err => {
        if (S.nav !== nav) return;
        S.boardErr = err;
        if (err === "notFound") delete S.boards[code];
        if (!S.boards[code]) draw();
      });
  }

  const pos = sc => [((sc.I + sc.S) - (sc.D + sc.C)) / 2, ((sc.D + sc.I) - (sc.S + sc.C)) / 2];
  const hash = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h >>> 0; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  function mapSVG(ms, me, avg, showNames) {
    const W = 400, c = 200, k = 1.7;
    const quad = (x, y, key) => `<rect x="${x}" y="${y}" width="200" height="200" style="fill:var(--${key});opacity:.13"/>`;
    const big = (x, y, key, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="40" font-weight="800" style="fill:var(--${key});opacity:.55">${key}</text>`;
    let o = `<svg class="map" viewBox="0 0 ${W} ${W}" role="img" aria-label="${esc(t("map"))}">`;
    o += quad(0, 0, "D") + quad(200, 0, "I") + quad(200, 200, "S") + quad(0, 200, "C");
    o += big(14, 72, "D", "start") + big(386, 72, "I", "end") + big(386, 376, "S", "end") + big(14, 376, "C", "start");
    o += `<path d="M200 0V400M0 200H400" stroke="currentColor" stroke-opacity=".18"/>`;
    o += `<text class="ax" x="200" y="16" text-anchor="middle">${esc(t("axTop"))}</text>`;
    o += `<text class="ax" x="200" y="393" text-anchor="middle">${esc(t("axBottom"))}</text>`;
    o += `<text class="ax" transform="translate(13 200) rotate(-90)" text-anchor="middle">${esc(t("axLeft"))}</text>`;
    o += `<text class="ax" transform="translate(387 200) rotate(90)" text-anchor="middle">${esc(t("axRight"))}</text>`;
    const [ax, ay] = pos(avg);
    const axp = c + ax * k, ayp = c - ay * k;
    o += `<path d="M${axp} ${ayp - 11}L${axp + 11} ${ayp}L${axp} ${ayp + 11}L${axp - 11} ${ayp}Z" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"><title>${esc(t("avg"))}</title></path>`;

    const sorted = ms.slice().sort((a, b) => (a.id === me) - (b.id === me));
    const pts = sorted.map(m => {
      const [x, y] = pos(m.scores); const h = hash(m.id);
      const jx = ((h & 255) / 255 - 0.5) * 12, jy = (((h >> 8) & 255) / 255 - 0.5) * 12;
      const mine = m.id === me;
      const label = showNames ? m.nick : (mine ? t("you") : "");
      return { m, mine, label, px: clamp(c + x * k + jx, 26, 374), py: clamp(c - y * k + jy, 34, 374) };
    });
    // spread dots that sit on top of each other
    for (let it = 0; it < 30; it++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j], dx = b.px - a.px, dy = b.py - a.py, d = Math.hypot(dx, dy);
        if (d < 18) {
          const ang = d ? Math.atan2(dy, dx) : (hash(b.m.id) % 628) / 100, push = (18 - d) / 2;
          a.px -= Math.cos(ang) * push; a.py -= Math.sin(ang) * push;
          b.px += Math.cos(ang) * push; b.py += Math.sin(ang) * push; moved = true;
        }
      }
      pts.forEach(q => { q.px = clamp(q.px, 26, 374); q.py = clamp(q.py, 34, 374); });
      if (!moved) break;
    }
    // place each name above its dot, or below / beside it if that spot is taken
    const boxes = [];
    pts.forEach(q => {
      if (!q.label) return;
      const w = Math.min(q.label.length, 12) * 7 + 6;
      const tries = [[0, -12], [0, 20], [w / 2 + 10, 4], [-w / 2 - 10, 4], [0, -24], [0, 32]];
      let best = tries[0];
      for (const [ox, oy] of tries) {
        const bx = q.px + ox, by = q.py + oy;
        if (!boxes.some(b => Math.abs(b.x - bx) < (b.w + w) / 2 && Math.abs(b.y - by) < 13)) { best = [ox, oy]; break; }
      }
      q.lx = q.px + best[0]; q.ly = q.py + best[1]; boxes.push({ x: q.lx, y: q.ly, w });
    });
    o += pts.map(({ m, mine, label, px, py, lx, ly }) => {
      const [p1, p2] = rank(m.scores);
      const tip = showNames || mine ? `${esc(m.nick)} · ${p1}${p2}` : `${p1}${p2}`;
      return `<g><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${mine ? 9 : 7}" style="fill:var(--${p1})"
        stroke="${mine ? "currentColor" : "#fff"}" stroke-width="${mine ? 3 : 1.5}"/>
        ${label ? `<text class="nm" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(trunc(label, 12))}</text>` : ""}
        <title>${tip}</title></g>`;
    }).join("");
    return o + `</svg>`;
  }

  // QR code as crisp SVG (always dark-on-white so every phone camera can read it)
  function qrSVG(text) {
    if (typeof qrcode !== "function") return "";
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte"); qr.make();
    const n = qr.getModuleCount(), m = 4;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR">
      <rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  function showQR(link, name, code) {
    const el = document.createElement("div");
    el.className = "qr-overlay";
    el.innerHTML = `<div class="qr-big">${qrSVG(link)}</div>
      <div class="qr-name">${esc(name)}</div><div class="code">${code}</div>
      <p class="hint">${t("scanHint")}</p><p class="hint">${t("closeHint")}</p>`;
    const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    el.onclick = close;
    document.addEventListener("keydown", onKey);
    document.body.appendChild(el);
  }

  function drawBoard(code) {
    const d = S.boards[code];
    if (!d) {
      view.innerHTML = S.boardErr
        ? msgCard(S.boardErr === "notFound" ? t("errNotFound") : t("errNet"), `<button class="btn" data-a="retry">${t("retry")}</button>`)
        : loadingCard();
      bind({ retry: () => go(() => board(code)), home: () => go(intro) });
      return;
    }
    const me = memberRec(code)?.id;
    const ms = d.members;
    const n = ms.length;
    const link = ENV.link("join", code);
    const counts = { D: 0, I: 0, S: 0, C: 0 };
    ms.forEach(m => { counts[rank(m.scores)[0]]++; });
    const avg = {};
    ORDER.forEach(k => { avg[k] = n ? Math.round(ms.reduce((a, m) => a + m.scores[k], 0) / n) : 0; });
    const bar = (k, label, w) => `
      <div class="bar"><label><span>${k} · ${P()[k].name}</span><span>${label}</span></label>
      <div class="track"><div class="fill" style="width:${w}%;background:var(--${k})"></div></div></div>`;
    const people = ms.slice().sort((a, b) => a.nick.localeCompare(b.nick));

    view.innerHTML = `
      <section class="card">
        <div class="qcount">${t("board")}</div>
        <h1 style="margin:4px 0">${esc(d.name)}</h1>
        <p class="muted" style="margin:0">${t("members", { n })} · <span class="live">● ${t("autoRefresh")}</span></p>
        <div class="invite">
          <button class="qrbox" data-a="bigqr" aria-label="${esc(t("bigQR"))}">${qrSVG(link)}</button>
          <div class="invite-info">
            <span class="lbl">${t("scanTitle")}</span>
            <p class="hint" style="margin-top:0">${t("scanHint")}</p>
            <span class="lbl">${t("codeLabel")}</span>
            <div class="code">${code}</div>
            <button class="btn small" data-a="bigqr" style="margin-top:10px">⛶ ${t("bigQR")}</button>
            <details class="linkdetails">
              <summary>${t("orLink")}</summary>
              <div class="row nowrap"><input class="input" id="lnk" readonly value="${esc(link)}"><button class="btn small" data-a="copy">${t("copyLink")}</button></div>
            </details>
          </div>
        </div>
        <div class="row">
          <button class="btn" data-a="take">${me ? t("retakeClass") : t("takeTest")}</button>
          <button class="btn ghost" data-a="home">${t("home")}</button>
        </div>
      </section>
      ${n ? `
      <section class="card">
        <h2>${t("map")}</h2>
        <p class="muted">${t("mapText")}</p>
        ${mapSVG(ms, me, avg, d.showNames)}
        <div class="legend">${t("legend")}</div>
        <p class="hint" style="text-align:center">🔒 ${t("privacyNote")}</p>
      </section>
      <div class="grid2">
        <section class="card"><h2>${t("breakdown")}</h2><div class="bars">
          ${ORDER.map(k => bar(k, `${counts[k]} (${Math.round(counts[k] / n * 100)}%)`, counts[k] / n * 100)).join("")}
        </div></section>
        <section class="card"><h2>${t("avg")}</h2><div class="bars">
          ${ORDER.map(k => bar(k, avg[k], avg[k])).join("")}
        </div></section>
      </div>` : `<section class="card"><p class="muted" style="margin:0">${t("empty")}</p></section>`}
      ${d.isAdmin ? `
      <section class="card">
        <h2>🔑 ${t("teacherTools")}</h2>
        <label class="toggle"><input type="checkbox" data-a="names" ${d.showNames ? "checked" : ""}> ${t("showNames")}</label>
        ${n ? `<p class="lbl">${t("participants")}</p>
        <p class="hint" style="margin-bottom:10px">${t("participantsHint")}</p>
        <div class="chips">${people.map(m => S.confirmId === m.id
          ? `<button class="chip danger" data-a="del" data-id="${esc(m.id)}">${t("confirmShort", { n: esc(m.nick) })}</button>`
          : `<button class="chip" data-a="ask" data-id="${esc(m.id)}">${esc(m.nick)} <span class="muted">✕</span></button>`).join("")}</div>` : ""}
      </section>` : ""}`;

    bind({
      copy: async el => {
        try { await navigator.clipboard.writeText(link); }
        catch (e) { const i = $("#lnk"); i.select(); try { document.execCommand("copy"); } catch (x) {} }
        el.textContent = "✓"; setTimeout(() => { el.textContent = t("copyLink"); }, 1500);
      },
      take: () => go(() => joinView(code)),
      home: () => go(intro),
      bigqr: () => showQR(link, d.name, code),
      names: async el => {
        try { await BK.setShowNames(code, el.checked); } catch (e) { el.checked = !el.checked; }
      },
      ask: el => { S.confirmId = el.dataset.id; drawBoard(code); },
      del: async el => {
        S.confirmId = null;
        el.disabled = true;
        try { await BK.remove(code, el.dataset.id); } catch (e) {}
        drawBoard(code);
      }
    });
  }

  // ---------- boot ----------
  document.querySelectorAll("[data-lang]").forEach(b => { b.onclick = () => setLang(b.dataset.lang); });
  $("[data-home]").onclick = e => { e.preventDefault(); go(intro); };
  setLang(lang, false);

  function route() {
    const { kind, val } = ENV.route.read();
    const code = (val || "").toUpperCase();
    if (kind === "board" && CODE_RE.test(code)) return go(() => board(code));
    if (kind === "join" && CODE_RE.test(code)) return go(() => joinView(code));
    if (kind === "r") {
      const s = (val || "").split("-").map(Number);
      if (s.length === 4 && s.every(x => Number.isInteger(x) && x >= 0 && x <= 100))
        return go(() => results({ D: s[0], I: s[1], S: s[2], C: s[3] }, null, true));
    }
    go(intro);
  }
  route();
  if (ENV.onRouteChange) ENV.onRouteChange(route);
})();
