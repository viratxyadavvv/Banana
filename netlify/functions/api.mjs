import { getStore } from '@netlify/blobs';
import { createHmac, createHash } from 'node:crypto';
export const config = { path: '/api/*' };
// Admin password: set ADMIN_PASSWORD in Netlify env vars to change it. Default hash below is for the password you chose.
const sha = x => createHash('sha256').update(String(x)).digest('hex');
const PH = process.env.ADMIN_PASSWORD ? sha(process.env.ADMIN_PASSWORD) : '6d4ce2a157252a77b40b56f466c8f0b1a74358a887e24f6d72dfa2729afc1ddc';
const KEY = process.env.ADMIN_SECRET || PH;
const sign = e => createHmac('sha256', KEY).update(String(e)).digest('hex');
const authed = req => { const [e, s] = (req.headers.get('authorization') || '').replace('Bearer ', '').split('.'); return !!e && !!s && +e > Date.now() && s === sign(e); };
const str = (x, n) => String(x ?? '').replace(/[<>`]/g, '').trim().slice(0, n);
const J = (d, c = 200) => new Response(JSON.stringify(d), { status: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export default async req => {
  const u = new URL(req.url), p = u.pathname.replace(/^\/api\/?/, '').replace(/\/$/, ''), m = req.method;
  try {
    const db = getStore('movies'), ph = getStore('posters');
    if (p === 'login' && m === 'POST') {
      const { password = '' } = await req.json();
      if (sha(password) !== PH) return J({ error: 'Wrong password' }, 401);
      const e = Date.now() + 6048e5; return J({ token: e + '.' + sign(e) });
    }
    if (p === 'movies' && m === 'GET') {
      const { blobs } = await db.list();
      const all = await Promise.all(blobs.map(b => db.get(b.key, { type: 'json' })));
      return J(all.filter(Boolean).sort((a, b) => b.id - a.id));
    }
    if (p === 'poster' && m === 'GET') {
      const d = await ph.get(u.searchParams.get('id') || '');
      if (!d) return new Response('', { status: 404 });
      return new Response(Buffer.from(d.split(',')[1], 'base64'), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    if (!authed(req)) return J({ error: 'Unauthorized' }, 401);
    if (p === 'movies' && m === 'POST') {
      const b = await req.json(), id = +b.id || Date.now();
      const old = b.id ? await db.get(String(id), { type: 'json' }) : null;
      if (b.id && !old) return J({ error: 'Movie not found' }, 404);
      let pv = old?.pv || 0;
      if (typeof b.poster === 'string' && /^data:image\/jpeg;base64,/.test(b.poster) && b.poster.length < 2e6) { await ph.set(String(id), b.poster); pv = Date.now(); }
      let v = str(b.v, 600); if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      const mv = { id, t: str(b.t, 120) || 'Untitled', y: +b.y || new Date().getFullYear(), l: str(b.l, 30) || 'English', g: str(b.g, 30) || 'Drama', s: str(b.s, 1500), v, r: Math.min(10, Math.max(0, +b.r || 0)), d: str(b.d, 20), pv };
      await db.setJSON(String(id), mv); return J(mv);
    }
    if (p === 'movies' && m === 'DELETE') {
      const id = u.searchParams.get('id') || ''; await db.delete(id); await ph.delete(id); return J({ ok: true });
    }
    return J({ error: 'Not found' }, 404);
  } catch (e) { return J({ error: 'Server error' }, 500); }
};
