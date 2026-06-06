import fs from 'node:fs/promises';

const USERNAME = process.env.GITHUB_USERNAME || 'kobadaidesu';
const OUTPUT = 'assets/language-stats.svg';
const MAX_LANGS = 8;

const COLORS = {
  C: '#555555',
  'Jupyter Notebook': '#da5b0b',
  TypeScript: '#3178c6',
  HTML: '#e34c26',
  Python: '#3572A5',
  CSS: '#563d7c',
  JavaScript: '#f1e05a',
  Assembly: '#6E4C13',
  Shell: '#89e051',
  Batchfile: '#C1F12E',
  Makefile: '#427819',
  'C++': '#f34b7d',
  Hack: '#878787',
  Dockerfile: '#384d54',
  CMake: '#DA3434',
  Other: '#8b949e',
};

const LANG_BY_EXT = new Map(Object.entries({
  '.ipynb': 'Jupyter Notebook',
  '.py': 'Python',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.hh': 'C++',
  '.hxx': 'C++',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.bat': 'Batchfile',
  '.cmd': 'Batchfile',
  '.s': 'Assembly',
  '.asm': 'Assembly',
  '.scm': 'Scilab',
  '.sce': 'Scilab',
  '.hack': 'Hack',
}));

const LANG_BY_NAME = new Map(Object.entries({
  makefile: 'Makefile',
  dockerfile: 'Dockerfile',
  'cmakelists.txt': 'CMake',
}));

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.cache',
]);

const IGNORED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.lock', '.txt',
  '.csv', '.tsv', '.pkl', '.model', '.mp4', '.mov', '.zip', '.gz', '.tar',
]);

async function githubJson(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'kobadaidesu-language-chart',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}\n${await response.text()}`);
  }
  return response.json();
}

async function fetchPublicRepos() {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/users/${USERNAME}/repos?type=owner&per_page=100&page=${page}`;
    const chunk = await githubJson(url);
    repos.push(...chunk);
    if (chunk.length < 100) break;
  }
  return repos.filter((repo) => !repo.archived);
}

function extname(path) {
  const base = path.split('/').pop() || '';
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index).toLowerCase() : '';
}

function classify(path) {
  const parts = path.split('/');
  if (parts.some((part) => IGNORED_DIRS.has(part))) return null;

  const base = (parts.at(-1) || '').toLowerCase();
  const byName = LANG_BY_NAME.get(base);
  if (byName) return byName;

  const ext = extname(path);
  if (!ext || IGNORED_EXTS.has(ext)) return null;
  return LANG_BY_EXT.get(ext) || null;
}

async function countLanguageFiles(repos) {
  const totals = new Map();
  let countedFiles = 0;
  let blobFiles = 0;

  for (const repo of repos) {
    const branch = encodeURIComponent(repo.default_branch);
    const url = `https://api.github.com/repos/${repo.full_name}/git/trees/${branch}?recursive=1`;
    const tree = await githubJson(url);
    if (tree.truncated) {
      console.warn(`${repo.full_name}: recursive tree was truncated by GitHub API`);
    }

    for (const item of tree.tree || []) {
      if (item.type !== 'blob') continue;
      blobFiles += 1;
      const language = classify(item.path);
      if (!language) continue;
      totals.set(language, (totals.get(language) || 0) + 1);
      countedFiles += 1;
    }
  }

  return { totals, countedFiles, blobFiles };
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildRows(totals) {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, MAX_LANGS);
  const otherCount = sorted.slice(MAX_LANGS).reduce((sum, [, count]) => sum + count, 0);
  return otherCount > 0 ? [...top, ['Other', otherCount]] : top;
}

function buildBar(rows, countedFiles) {
  const barX = 24;
  const barY = 66;
  const barWidth = 712;
  const barHeight = 12;
  let x = barX;

  return rows.map(([language, count], index) => {
    const width = index === rows.length - 1
      ? barX + barWidth - x
      : (count / countedFiles) * barWidth;
    const segment = `    <rect x="${x.toFixed(2)}" y="${barY}" width="${width.toFixed(2)}" height="${barHeight}" fill="${COLORS[language] || COLORS.Other}" clip-path="url(#language-bar)"/>`;
    x += width;
    return segment;
  }).join('\n');
}

function buildLegend(rows, countedFiles) {
  const columnWidth = 245;
  const rowHeight = 40;

  return rows.map(([language, count], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 24 + column * columnWidth;
    const y = 106 + row * rowHeight;
    const pct = ((count / countedFiles) * 100).toFixed(1);

    return `    <g transform="translate(${x} ${y})">
      <circle cx="6" cy="6" r="6" fill="${COLORS[language] || COLORS.Other}"/>
      <text x="24" y="11" fill="#f0f6fc" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(language)}</text>
      <text x="178" y="11" fill="#8b949e" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="18">${pct}%</text>
    </g>`;
  }).join('\n');
}

function buildChart(totals, countedFiles) {
  const rows = buildRows(totals);
  const date = new Date().toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="250" viewBox="0 0 760 250" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(USERNAME)} language stats</title>
  <desc id="desc">A horizontal language usage chart generated from extension-based file counts for public repositories, including forks.</desc>
  <defs>
    <clipPath id="language-bar">
      <rect x="24" y="66" width="712" height="12" rx="6" ry="6"/>
    </clipPath>
  </defs>

  <text x="24" y="38" fill="#f0f6fc" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="30" font-weight="700">Languages</text>

  <rect x="24" y="66" width="712" height="12" rx="6" fill="#30363d"/>
${buildBar(rows, countedFiles)}

  <g>
${buildLegend(rows, countedFiles)}
  </g>

  <rect x="24" y="218" width="4" height="22" fill="#30363d"/>
  <text x="42" y="235" fill="#8b949e" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="16">Generated daily by GitHub Actions · file count · public repos + forks · ${date}</text>
</svg>
`;
}

const repos = await fetchPublicRepos();
const { totals, countedFiles, blobFiles } = await countLanguageFiles(repos);
if (countedFiles === 0) {
  throw new Error('No language files were counted.');
}

const chart = buildChart(totals, countedFiles);
await fs.mkdir('assets', { recursive: true });
await fs.writeFile(OUTPUT, chart, 'utf8');

console.log(`Updated ${OUTPUT}`);
console.log(`Repos: ${repos.length}, blobs: ${blobFiles}, counted language files: ${countedFiles}`);
console.table([...totals.entries()].sort((a, b) => b[1] - a[1]).map(([language, files]) => ({
  language,
  files,
  share: `${((files / countedFiles) * 100).toFixed(1)}%`,
})));
