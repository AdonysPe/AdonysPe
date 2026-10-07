// Generates SVG cards for the profile README, counting private repos too:
//   dist/year.svg       -> this year's stats + Jan–Dec contribution calendar
//   dist/activity.svg   -> contributions per day over the last 31 days
//   dist/languages.svg  -> most used languages across every repo you own
// Needs GH_TOKEN = a classic PAT with `repo` + `read:user` scopes.

import { mkdir, writeFile } from 'node:fs/promises';

const TOKEN = process.env.GH_TOKEN;
const ACCENT = process.env.ACCENT || '#00F7FF';
const OUT = process.env.OUT_DIR || 'dist';
const IGNORE = (process.env.IGNORE_LANGS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const FONT = "-apple-system, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

if (!TOKEN) throw new Error('GH_TOKEN is missing');

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const now = new Date();
const year = now.getUTCFullYear();
const today = now.toISOString().slice(0, 10);

const { viewer } = await gql(
  `query($from: DateTime!, $to: DateTime!, $recentFrom: DateTime!) {
    viewer {
      recent: contributionsCollection(from: $recentFrom, to: $to) {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        restrictedContributionsCount
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
        nodes { languages(first: 20) { edges { size node { name color } } } }
      }
    }
  }`,
  { from: `${year}-01-01T00:00:00Z`, to: now.toISOString(), recentFrom: new Date(now.getTime() - 31 * 86400000).toISOString() },
);

const cc = viewer.contributionsCollection;
const counts = {};
for (const w of cc.contributionCalendar.weeks) for (const d of w.contributionDays) counts[d.date] = d.contributionCount;

// Streaks inside the year. Today without contributions does not break the current streak yet.
const days = Object.keys(counts).sort();
let longest = 0, run = 0, best = { date: null, n: 0 };
for (const d of days) {
  run = counts[d] > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
  if (counts[d] > best.n) best = { date: d, n: counts[d] };
}
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (counts[days[i]] > 0) current++;
  else if (days[i] === today) continue;
  else break;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hexToRgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
const [r, g, b] = hexToRgb(ACCENT);
const LEVELS = ['#161b22', `rgba(${r},${g},${b},0.22)`, `rgba(${r},${g},${b},0.45)`, `rgba(${r},${g},${b},0.72)`, ACCENT];
const level = (n) => (n === 0 ? 0 : n <= 3 ? 1 : n <= 7 ? 2 : n <= 12 ? 3 : 4);

// ---------- year.svg ----------
const W = 900, CELL = 12, GAP = 3, GX = 58, GY = 168;
const tiles = [
  [cc.contributionCalendar.totalContributions, `contributions in ${year}`, true],
  [cc.totalCommitContributions, 'commits', false],
  [cc.restrictedContributionsCount, 'in private repos', false],
  [`${longest}d`, 'longest streak', false],
  [`${current}d`, 'current streak', false],
];
const tileW = (W - 40 - 4 * 12) / 5;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="330" viewBox="0 0 ${W} 330" font-family="${FONT}">
<rect x="0.5" y="0.5" width="${W - 1}" height="329" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="34" fill="#e6edf3" font-size="16" font-weight="600">${year} in code</text>
<text x="${W - 20}" y="34" fill="#9198a1" font-size="12" text-anchor="end">public + private · updated ${esc(today)}</text>`;
tiles.forEach(([value, label, hi], i) => {
  const x = 20 + i * (tileW + 12);
  svg += `<rect x="${x}" y="52" width="${tileW}" height="74" rx="8" fill="none" stroke="#30363d"/>
<text x="${x + 14}" y="88" fill="${hi ? ACCENT : '#e6edf3'}" font-size="28" font-weight="800">${esc(value)}</text>
<text x="${x + 14}" y="112" fill="#9198a1" font-size="12">${esc(label)}</text>`;
});
['Mon', 'Wed', 'Fri'].forEach((d, i) => {
  svg += `<text x="20" y="${GY + (1 + i * 2) * (CELL + GAP) + 10}" fill="#9198a1" font-size="10">${d}</text>`;
});
let cur = new Date(Date.UTC(year, 0, 1));
cur = new Date(cur.getTime() - cur.getUTCDay() * 86400000); // back to Sunday
for (let w = 0; w < 53; w++) {
  for (let d = 0; d < 7; d++) {
    const key = cur.toISOString().slice(0, 10);
    const x = GX + w * (CELL + GAP), y = GY + d * (CELL + GAP);
    if (cur.getUTCFullYear() === year) {
      if (cur.getUTCDate() <= 7 && d === 0) svg += `<text x="${x}" y="${GY - 8}" fill="#9198a1" font-size="10">${MONTHS[cur.getUTCMonth()]}</text>`;
      svg += key > today
        ? `<rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="3" fill="none" stroke="#21262d"/>`
        : `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${LEVELS[level(counts[key] || 0)]}"><title>${key}: ${counts[key] || 0}</title></rect>`;
    }
    cur = new Date(cur.getTime() + 86400000);
  }
}
const legendX = W - 20 - 5 * 14 - 34;
svg += `<text x="20" y="${GY + 7 * (CELL + GAP) + 26}" fill="#9198a1" font-size="11">${best.date ? `best day: ${best.date} · ${best.n}` : ''}</text>
<text x="${legendX - 6}" y="${GY + 7 * (CELL + GAP) + 26}" fill="#9198a1" font-size="11" text-anchor="end">Less</text>`;
LEVELS.forEach((c, i) => {
  svg += `<rect x="${legendX + i * 14}" y="${GY + 7 * (CELL + GAP) + 16}" width="11" height="11" rx="2" fill="${c}"/>`;
});
svg += `<text x="${legendX + 5 * 14 + 4}" y="${GY + 7 * (CELL + GAP) + 26}" fill="#9198a1" font-size="11">More</text></svg>`;

// ---------- languages.svg ----------
const totals = {};
for (const repo of viewer.repositories.nodes) {
  for (const { size, node } of repo.languages.edges) {
    if (IGNORE.includes(node.name.toLowerCase())) continue;
    totals[node.name] ??= { size: 0, color: node.color || '#9198a1' };
    totals[node.name].size += size;
  }
}
const sum = Object.values(totals).reduce((a, t) => a + t.size, 0) || 1;
const langs = Object.entries(totals).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const LW = 420, LH = 64 + Math.ceil(langs.length / 2) * 24 + 16;
let lsvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LW}" height="${LH}" viewBox="0 0 ${LW} ${LH}" font-family="${FONT}">
<rect x="0.5" y="0.5" width="${LW - 1}" height="${LH - 1}" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="32" fill="#e6edf3" font-size="15" font-weight="600">Most used languages</text>
<clipPath id="bar"><rect x="20" y="46" width="${LW - 40}" height="10" rx="5"/></clipPath><g clip-path="url(#bar)">`;
let bx = 20;
for (const [, t] of langs) {
  const w = ((LW - 40) * t.size) / sum;
  lsvg += `<rect x="${bx}" y="46" width="${w}" height="10" fill="${t.color}"/>`;
  bx += w;
}
lsvg += `</g>`;
langs.forEach(([name, t], i) => {
  const x = 20 + (i % 2) * ((LW - 40) / 2), y = 84 + Math.floor(i / 2) * 24;
  lsvg += `<circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${t.color}"/>
<text x="${x + 16}" y="${y}" fill="#c9d1d9" font-size="12">${esc(name)} <tspan fill="#9198a1">${((t.size / sum) * 100).toFixed(1)}%</tspan></text>`;
});
lsvg += `</svg>`;

// ---------- activity.svg ----------
const recent = viewer.recent.contributionCalendar.weeks.flatMap((w) => w.contributionDays).slice(-31);
const AW = 500, AH = LH, PX = 20, top = 52, bottom = AH - 34;
const max = Math.max(4, ...recent.map((d) => d.contributionCount));
const step = (AW - 2 * PX) / Math.max(1, recent.length - 1);
const pts = recent.map((d, i) => `${(PX + i * step).toFixed(1)},${(bottom - (d.contributionCount / max) * (bottom - top)).toFixed(1)}`);
const short = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
let asvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${AW}" height="${AH}" viewBox="0 0 ${AW} ${AH}" font-family="${FONT}">
<rect x="0.5" y="0.5" width="${AW - 1}" height="${AH - 1}" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="32" fill="#e6edf3" font-size="15" font-weight="600">Last 31 days</text>
<text x="${AW - 20}" y="32" fill="#9198a1" font-size="11" text-anchor="end">peak ${max} / day</text>
<line x1="${PX}" y1="${top}" x2="${AW - PX}" y2="${top}" stroke="#21262d"/>
<line x1="${PX}" y1="${bottom}" x2="${AW - PX}" y2="${bottom}" stroke="#30363d"/>
<polygon points="${pts.join(' ')} ${AW - PX},${bottom} ${PX},${bottom}" fill="${ACCENT}" fill-opacity="0.12"/>
<polyline points="${pts.join(' ')}" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round"/>`;
if (recent.length) {
  asvg += `<text x="${PX}" y="${AH - 14}" fill="#9198a1" font-size="11">${short(recent[0].date)}</text>
<text x="${AW - PX}" y="${AH - 14}" fill="#9198a1" font-size="11" text-anchor="end">${short(recent[recent.length - 1].date)}</text>`;
}
asvg += `</svg>`;

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/year.svg`, svg);
await writeFile(`${OUT}/activity.svg`, asvg);
await writeFile(`${OUT}/languages.svg`, lsvg);
console.log(`year.svg: ${cc.contributionCalendar.totalContributions} contributions, streak ${current}/${longest}; languages.svg: ${langs.length} languages`);
