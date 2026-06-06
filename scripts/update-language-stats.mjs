import fs from 'node:fs/promises';

const USERNAME = process.env.GITHUB_USERNAME || 'kobadaidesu';
const TOKEN = process.env.GITHUB_TOKEN || '';
const OUTPUT = 'assets/language-stats.svg';
const MAX_LANGUAGES = 8;

const LANGUAGE_BY_EXTENSION = new Map(Object.entries({
  '.c': 'C',
  '.h': 'C',
  '.ipynb': 'Jupyter Notebook',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.py': 'Python',
  '.css': 'CSS',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.s': 'Assembly',
  '.asm': 'Assembly',
  '.java': 'Java',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.astro': 'Astro',
  '.jsx': 'JavaScript',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.sql': 'SQL',
  '.lua': 'Lua',
  '.r': 'R',
}));

const LANGUAGE_COLORS = {
  C: '#555555',
  'Jupyter Notebook': '#DA5B0B',
  TypeScript: '#3178C6',
  HTML: '#E34C26',
  Python: '#3572A5',
  CSS: '#563D7C',
  JavaScript: '#F1E05A',
  Assembly: '#6E4C13',
  Java: '#B07219',
  'C++': '#F34B7D',
  Go: '#00ADD8',
  Rust: '#DEA584',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Shell: '#89E051',
  Vue: '#41B883',
  Svelte: '#FF3E00',
  Astro: '#FF5D01',
  JSON: '#292929',
  YAML: '#CB171E',
  TOML: '#9C4221',
  SQL: '#E38C00',
  Lua: '#000080',
  R: '#198CE7',
  Other: '#8B949E',
};

const IGNORED_EXTENSIONS = new Set([
  '.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.lock', '.csv', '.tsv', '.zip', '.gz', '.tar', '.mp4', '.mov', '.mp3', '.wav',
]);

const IGNORED_PATH_PARTS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.vercel', 'vendor', '__pycache__',
]);

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${path}`);
  }
  return response.json();
}

async function listRepos() {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(`/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner&sort=full_name`);
    repos.push(...batch.filter((repo) => !repo.archived && !repo.disabled));
    if (batch.length < 100) break;
  }
  return repos;
}

function extensionOf(path) {
  const basename = path.split('/').pop() || '';
  const index = basename.lastIndexOf('.');
  return index > 0 ? basename.slice(index).toLowerCase() : '';
}

function shouldSkip(path) {
  const parts = path.split('/');
  if (parts.some((part) => IGNORED_PATH_PARTS.has(part))) return true;
  return IGNORED_EXTENSIONS.has(extensionOf(path));
}

async function countLanguages(repos) {
  const counts = new Map();
  let files = 0;

  for (const repo of repos) {
    let tree;
    try {
      tree = await github(`/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);
    } catch (error) {
      console.warn(`Skipping ${repo.full_name}: ${error.message}`);
      continue;
    }

    for (const item of tree.tree || []) {
      if (item.type !== 'blob' || shouldSkip(item.path)) continue;
      const language = LANGUAGE_BY_EXTENSION.get(extensionOf(item.path));
      if (!language) continue;
      counts.set(language, (counts.get(language) || 0) + 1);
      files += 1;
    }
  }

  return { counts, files };
}

function summarize(counts, total) {
  const sorted = [...counts.entries()]
    .map(([language, count]) => ({ language, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));

  const shown = sorted.slice(0, MAX_LANGUAGES);
  const rest = sorted.slice(MAX_LANGUAGES);
  const otherCount = rest.reduce((sum, item) => sum + item.count, 0);
  if (otherCount > 0) {
    shown.push({ language: 'Other', count: otherCount, share: otherCount / total });
  }
  return shown;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function renderSvg(items, total) {
  const width = 520;
  const height = 242;
  const pad = 24;
  const barX = pad;
  const barY = 76;
  const barWidth = width - pad * 2;
  const barHeight = 10;
  const today = new Date().toISOString().slice(0, 10);

  let x = barX;
  const segments = items.map((item, index) => {
    const segmentWidth = index === items.length - 1
      ? barX + barWidth - x
      : Math.max(2, Math.round(barWidth * item.share));
    const rx = index === 0 ? 5 : 0;
    const piece = `<rect x="${x}" y="${barY}" width="${segmentWidth}" height="${barHeight}" rx="${rx}" fill="${LANGUAGE_COLORS[item.language] || LANGUAGE_COLORS.Other}"/>`;
    x += segmentWidth;
    return piece;
  }).join('\n    ');

  const rows = items.map((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const rowX = pad + col * 246;
    const rowY = 116 + row * 30;
    return `
    <circle cx="${rowX + 6}" cy="${rowY - 5}" r="5" fill="${LANGUAGE_COLORS[item.language] || LANGUAGE_COLORS.Other}"/>
    <text x="${rowX + 20}" y="${rowY}" class="lang">${escapeXml(item.language)}</text>
    <text x="${rowX + 160}" y="${rowY}" class="pct">${percent(item.share)}</text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Most used languages for ${escapeXml(USERNAME)}</title>
  <desc id="desc">Language usage from public repositories, forks included, based on counted source files.</desc>
  <style>
    .card { fill: #0d1117; stroke: #30363d; }
    .title { fill: #58a6ff; font: 600 18px -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; }
    .sub { fill: #8b949e; font: 400 12px -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; }
    .lang { fill: #c9d1d9; font: 600 14px -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; }
    .pct { fill: #8b949e; font: 400 14px -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; }
  </style>
  <rect class="card" x="0.5" y="0.5" width="519" height="241" rx="6"/>
  <text x="${pad}" y="36" class="title">Most Used Languages</text>
  <text x="${pad}" y="56" class="sub">${total} source files · public repos · forks included</text>
  <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="5" fill="#21262d"/>
  ${segments}
  ${rows}
  <text x="${pad}" y="224" class="sub">Updated ${today} · file-count based</text>
</svg>
`;
}

async function main() {
  const repos = await listRepos();
  const { counts, files } = await countLanguages(repos);
  const items = summarize(counts, files);
  await fs.mkdir('assets', { recursive: true });
  await fs.writeFile(OUTPUT, renderSvg(items, files));
  console.log(`Wrote ${OUTPUT} from ${files} files across ${repos.length} repositories.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
