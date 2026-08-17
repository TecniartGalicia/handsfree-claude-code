#!/usr/bin/env node
// Snapshot of the public numbers of the extension. Prints a Markdown row; with --append it also appends it to docs/METRICAS.md.
// Optional: POLAR_OAT=<organization access token> (or a POLAR_OAT= line in Documents/handsfree-secrets.txt) adds Polar orders/keys.
// No dependencies. Usage: node scripts/metrics.mjs [--append] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXT = { publisher: 'argalla', name: 'handsfree-claude-code', repo: 'TecniartGalicia/handsfree-claude-code', polarOrg: 'fa5605f8-f935-44c5-9923-686f9479d390' };
const args = new Set(process.argv.slice(2));
const UA = { 'User-Agent': 'handsfree-metrics/1.0 (+https://github.com/TecniartGalicia/handsfree-claude-code)' };
const nd = 'n/d';

async function json(url, init = {}) {
  try {
    const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } });
    if (!r.ok) return { __err: `HTTP ${r.status}` };
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { __err: 'not json' }; }
  } catch (e) { return { __err: e.message }; }
}

async function marketplace() {
  const body = { filters: [{ criteria: [{ filterType: 7, value: `${EXT.publisher}.${EXT.name}` }] }], flags: 914 };
  // The gallery answers from several caches that disagree by hours; installs/downloads only grow, so ask a few times with
  // different headers and keep the max of each statistic.
  const variants = [{}, { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, { 'Accept-Encoding': 'identity' }];
  let e; const st = {};
  for (const extra of variants) {
    const j = await json('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.1-preview.1', ...extra }, body: JSON.stringify(body) });
    const x = j?.results?.[0]?.extensions?.[0];
    if (!x) continue;
    e = e ?? x;
    for (const s of x.statistics || []) st[s.statisticName] = Math.max(st[s.statisticName] ?? 0, Number(s.value) || 0);
  }
  if (!e) return { installs: nd, downloads: nd, version: nd, rating: nd, ratings: nd, reviews: nd, reviewList: [] };
  // filterOptions=0 returns rating-only entries too (filterOptions=1 hides them); the endpoint answers empty now and
  // then, so fall back to the ratingcount statistic instead of printing "n/d".
  const rv = await json(`https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${EXT.publisher}/extensions/${EXT.name}/reviews?count=100&filterOptions=0&api-version=7.1-preview.1`, { headers: { Accept: 'application/json;api-version=7.1-preview.1' } });
  const reviews = typeof rv?.totalReviewCount === 'number' ? rv.totalReviewCount : (st.ratingcount ?? nd);
  return { installs: st.install ?? 0, downloads: st.downloadCount ?? 0, version: e.versions?.[0]?.version ?? nd, rating: st.averagerating ? Number(st.averagerating).toFixed(1) : '-', ratings: st.ratingcount ?? 0, reviews, reviewList: rv?.reviews ?? [] };
}

async function openvsx() {
  const j = await json(`https://open-vsx.org/api/${EXT.publisher}/${EXT.name}`);
  return { downloads: j.downloadCount ?? nd, version: j.version ?? nd, reviews: j.reviewCount ?? 0, rating: j.averageRating ?? '-', verified: j.verified };
}

async function github() {
  const j = await json(`https://api.github.com/repos/${EXT.repo}`);
  const issues = await json(`https://api.github.com/repos/${EXT.repo}/issues?state=open&per_page=50`);
  const rel = await json(`https://api.github.com/repos/${EXT.repo}/releases`);
  const dl = Array.isArray(rel) ? rel.flatMap((r) => r.assets || []).reduce((a, x) => a + (x.download_count || 0), 0) : nd;
  return { stars: j.stargazers_count ?? nd, forks: j.forks_count ?? nd, watchers: j.subscribers_count ?? nd, openIssues: Array.isArray(issues) ? issues.filter((i) => !i.pull_request).length : nd, openPRs: Array.isArray(issues) ? issues.filter((i) => i.pull_request).length : nd, releaseDownloads: dl, issueTitles: Array.isArray(issues) ? issues.map((i) => `#${i.number} ${i.title}`) : [] };
}

async function hn() {
  const j = await json('https://hn.algolia.com/api/v1/search?query=%22handsfree%22%20%22claude%20code%22&tags=(story,comment)');
  return { hits: j?.nbHits ?? nd, titles: (j?.hits || []).slice(0, 5).map((h) => h.title || h.story_title || '').filter(Boolean) };
}

async function reddit() {
  // Anonymous search is often blocked (HTML instead of JSON); report n/d then and search by hand.
  const j = await json('https://api.reddit.com/search?q=%22handsfree%22%20%22claude%20code%22&sort=new&limit=10');
  if (j?.__err || !j?.data) return { hits: nd, titles: [] };
  return { hits: j.data.children.length, titles: j.data.children.map((c) => `r/${c.data.subreddit}: ${c.data.title}`) };
}

function polarToken() {
  if (process.env.POLAR_OAT) return process.env.POLAR_OAT;
  const docs = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents');
  // Same Polar organisation serves every Argalla product, so the token may sit in any of these files.
  for (const name of ['handsfree-secrets.txt', 'changekeeper-secrets.txt', 'argalla-secrets.txt']) {
    try {
      const m = /^\s*POLAR_OAT\s*=\s*(.+)$/m.exec(fs.readFileSync(path.join(docs, name), 'utf8'));
      if (m) return m[1].trim();
    } catch { /* next file */ }
  }
  return '';
}

async function polar() {
  const tok = polarToken();
  if (!tok) return { orders: nd, revenue: nd, keys: nd, note: 'sin POLAR_OAT (mirar panel)' };
  const H = { Authorization: `Bearer ${tok}` };
  const o = await json(`https://api.polar.sh/v1/orders/?organization_id=${EXT.polarOrg}&limit=100`, { headers: H });
  const k = await json(`https://api.polar.sh/v1/license-keys/?organization_id=${EXT.polarOrg}&limit=100`, { headers: H });
  if (o?.__err) return { orders: nd, revenue: nd, keys: nd, note: `Polar API: ${o.__err}` };
  const items = o.items || [];
  const paid = items.filter((x) => (x.net_amount ?? x.amount ?? 0) > 0);
  const revenue = paid.reduce((a, x) => a + (x.net_amount ?? x.amount ?? 0), 0) / 100;
  const keys = k?.__err ? nd : (k?.pagination?.total_count ?? (k?.items || []).length);
  return { orders: items.length, paidOrders: paid.length, revenue: revenue.toFixed(2) + ' €', keys, granted: k?.__err ? undefined : (k?.items || []).filter((x) => x.status === 'granted').length };
}

const [mk, ov, gh, hnr, rd, po] = await Promise.all([marketplace(), openvsx(), github(), hn(), reddit(), polar()]);
const today = new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD: a run at 01:00 CEST is today, not yesterday
const row = `| ${today} | ${mk.installs} | ${mk.downloads} | ${mk.rating}/${mk.ratings} (${mk.reviews} reseñas) | ${ov.downloads} | ${gh.stars} | ${gh.openIssues}/${gh.openPRs} | ${gh.releaseDownloads} | ${po.orders}${po.paidOrders !== undefined ? ` (${po.paidOrders} de pago, ${po.revenue})` : ''} | ${po.keys}${po.granted !== undefined ? ` (${po.granted} activas)` : ''} | ${hnr.hits} | ${rd.hits} |`;
const header = `| Fecha | MP instalaciones | MP descargas | MP valoración (n) | Open VSX descargas | GH ★ | Issues/PR abiertos | .vsix release | Pedidos Polar | Claves | HN menciones | Reddit menciones |\n|---|---:|---:|---|---:|---:|---|---:|---|---|---:|---:|`;

if (args.has('--json')) {
  console.log(JSON.stringify({ date: today, marketplace: mk, openvsx: ov, github: gh, hn: hnr, reddit: rd, polar: po }, null, 2));
} else {
  console.log(header + '\n' + row);
  if (mk.version !== ov.version) console.log(`\n⚠ versiones distintas: Marketplace ${mk.version} vs Open VSX ${ov.version}`);
  if (gh.issueTitles.length) console.log('\nIssues/PR abiertos:\n- ' + gh.issueTitles.join('\n- '));
  if (mk.reviewList.length) console.log('\nReseñas Marketplace:\n- ' + mk.reviewList.map((r) => `${r.rating}★ ${r.userDisplayName}: ${(r.text || '').slice(0, 120)}`).join('\n- '));
  if (hnr.titles.length) console.log('\nHN:\n- ' + hnr.titles.join('\n- '));
  if (rd.titles.length) console.log('\nReddit:\n- ' + rd.titles.join('\n- '));
  if (po.note) console.log(`\nPolar: ${po.note}`);
}

if (args.has('--append')) {
  const file = path.join(REPO, 'docs', 'METRICAS.md'); // relative to the repo, not to the cwd
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  // Add the table when it is missing — never replace the file: it also holds hand-written sections.
  if (!text.includes('| Fecha |')) {
    const intro = text ? text.replace(/\n*$/, '\n\n') : '# Métricas — Handsfree for Claude Code\n\nGeneradas con `node scripts/metrics.mjs --append` (APIs públicas; Polar solo con POLAR_OAT). "n/d" = no disponible.\n\n';
    text = intro + header + '\n';
  }
  // The daily rows live in the first table; the sections below must not move.
  const lines = text.split('\n');
  const headIdx = lines.findIndex((l) => l.startsWith('| Fecha |'));
  let last = headIdx + 1; // the |---| separator
  while (last + 1 < lines.length && lines[last + 1].startsWith('| 20')) last++;
  const cols = row.split('|').length;
  const existing = lines.findIndex((l, i) => i > headIdx && i <= last && l.startsWith(`| ${today} |`) && l.split('|').length === cols);
  if (existing >= 0) {
    // Merge instead of overwrite: a degraded read (API down → n/d, or a stale cache reporting fewer
    // downloads than we already recorded) must never lose the good numbers of an earlier run today.
    const before = lines[existing].split('|');
    lines[existing] = row
      .split('|')
      .map((cell, i) => {
        const old = before[i];
        if (old === undefined || cell.trim() === '' || old.trim() === '') return cell; // row edges
        if (cell.trim() === 'n/d' && old.trim() !== 'n/d') return old;
        const a = Number(old);
        const b = Number(cell);
        return Number.isFinite(a) && Number.isFinite(b) ? ` ${Math.max(a, b)} ` : cell;
      })
      .join('|');
  } else {
    lines.splice(last + 1, 0, row);
  }
  // One row per day: collapse duplicates a format change may have left behind (keep the first).
  const seen = new Set();
  const out = lines.filter((l, i) => {
    if (i <= headIdx || !l.startsWith('| 20')) return true;
    const date = l.split('|')[1]?.trim();
    if (seen.has(date)) return false;
    seen.add(date);
    return true;
  });
  fs.writeFileSync(file, out.join('\n'), 'utf8');
  console.log(`\n→ ${file} actualizado`);
}
