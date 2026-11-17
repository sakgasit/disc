// Class sessions API, stored in Netlify Blobs (no external database needed).
//
//   POST   /api/class                     { name }               -> { code, name, adminKey }
//   GET    /api/class/:code               (x-admin-key optional)  -> { code, name, members[], isAdmin }
//   POST   /api/class/:code/join          { id, token, nick, scores } -> { ok }
//   PATCH  /api/class/:code               (x-admin-key) { showNames } -> { ok }
//   DELETE /api/class/:code/member/:id    (x-admin-key required) -> { ok }
//
// Keys: "<CODE>/meta" and "<CODE>/m/<memberId>" — one blob per student, so
// simultaneous submissions never overwrite each other.

import { getStore } from "@netlify/blobs";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L confusion
const CODE_RE = /^[A-Z0-9]{6}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_MEMBERS = 300;
const DIMS = ["D", "I", "S", "C"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const clean = (s, max) =>
  String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join("");

async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

export async function handle(req, store) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/class\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  // Create a class
  if (parts.length === 0) {
    if (method !== "POST") return json({ error: "method" }, 405);
    const body = await readBody(req);
    const name = clean(body?.name, 60);
    if (!name) return json({ error: "name" }, 400);
    let code;
    for (let i = 0; i < 8; i++) {
      const c = newCode();
      if (!(await store.get(`${c}/meta`, { type: "json" }))) { code = c; break; }
    }
    if (!code) return json({ error: "server" }, 500);
    const adminKey = crypto.randomUUID();
    await store.setJSON(`${code}/meta`, { name, created: Date.now(), adminKey });
    return json({ code, name, adminKey }, 201);
  }

  const code = parts[0].toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: "bad_code" }, 400);
  const meta = await store.get(`${code}/meta`, { type: "json" });
  if (!meta) return json({ error: "not_found" }, 404);
  const isAdmin = req.headers.get("x-admin-key") === meta.adminKey;

  // Read the board
  if (parts.length === 1 && method === "GET") {
    const { blobs } = await store.list({ prefix: `${code}/m/` });
    const rows = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
    const members = rows.filter(Boolean)
      .map(({ id, nick, scores, at }) => ({ id, nick, scores, at }))
      .sort((a, b) => a.at - b.at);
    return json({ code, name: meta.name, created: meta.created, members, isAdmin, showNames: meta.showNames !== false });
  }

  // Teacher settings
  if (parts.length === 1 && method === "PATCH") {
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const body = await readBody(req);
    if (typeof body?.showNames !== "boolean") return json({ error: "bad_body" }, 400);
    await store.setJSON(`${code}/meta`, { ...meta, showNames: body.showNames });
    return json({ ok: true });
  }

  // Submit / update a result
  if (parts.length === 2 && parts[1] === "join" && method === "POST") {
    const body = await readBody(req);
    const id = String(body?.id ?? "");
    const token = String(body?.token ?? "");
    const nick = clean(body?.nick, 20);
    const s = body?.scores || {};
    if (!ID_RE.test(id) || !ID_RE.test(token)) return json({ error: "bad_id" }, 400);
    if (!nick) return json({ error: "nick" }, 400);
    if (!DIMS.every(k => Number.isInteger(s[k]) && s[k] >= 0 && s[k] <= 100)) return json({ error: "scores" }, 400);

    const key = `${code}/m/${id}`;
    const existing = await store.get(key, { type: "json" });
    if (existing && existing.token !== token) return json({ error: "forbidden" }, 403);
    if (!existing) {
      const { blobs } = await store.list({ prefix: `${code}/m/` });
      if (blobs.length >= MAX_MEMBERS) return json({ error: "full" }, 403);
    }
    const scores = Object.fromEntries(DIMS.map(k => [k, s[k]]));
    await store.setJSON(key, { id, token, nick, scores, at: Date.now() });
    return json({ ok: true });
  }

  // Teacher removes a student
  if (parts.length === 3 && parts[1] === "member" && method === "DELETE") {
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const id = decodeURIComponent(parts[2]);
    if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
    await store.delete(`${code}/m/${id}`);
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}

export default async (req) => {
  try {
    return await handle(req, getStore({ name: "disc-classes", consistency: "strong" }));
  } catch (err) {
    console.error(err);
    return json({ error: "server" }, 500);
  }
};

export const config = { path: ["/api/class", "/api/class/*"] };
