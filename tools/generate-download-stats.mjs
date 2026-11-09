import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appZip = /^Wose(?:-v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)?-windows-x64\.zip$/;

function validateRepository(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Expected repository in owner/repo format');
  }
}

function validateReleases(releases) {
  if (!Array.isArray(releases)) throw new Error('Releases response must be an array');
  for (const release of releases) {
    if (!release || typeof release.draft !== 'boolean' || !Array.isArray(release.assets)) {
      throw new Error('Malformed release');
    }
    for (const asset of release.assets) {
      if (!asset || typeof asset.name !== 'string' || !asset.name ||
          !Number.isSafeInteger(asset.download_count) || asset.download_count < 0) {
        throw new Error('Malformed release asset or download_count');
      }
    }
  }
}

export function summarizeReleases(releases, generatedAt, repository) {
  validateRepository(repository);
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt)) ||
      new Date(generatedAt).toISOString() !== generatedAt) {
    throw new Error('generatedAt must be an ISO UTC timestamp');
  }
  validateReleases(releases);
  let appDownloads = 0;
  for (const release of releases) {
    if (release.draft) continue;
    for (const asset of release.assets) {
      if (!appZip.test(asset.name)) continue;
      appDownloads += asset.download_count;
      if (!Number.isSafeInteger(appDownloads)) throw new Error('Download total exceeds the safe integer range');
    }
  }
  return {
    schemaVersion: 1,
    generatedAt,
    source: {
      repository,
      url: `https://github.com/${repository}/releases`,
      metric: 'GitHub release asset download_count',
    },
    appDownloads,
  };
}

export async function fetchReleases(repository, request = fetch, token = process.env.GITHUB_TOKEN) {
  validateRepository(repository);
  const endpoint = `https://api.github.com/repos/${repository}/releases`;
  let url = `${endpoint}?per_page=100&page=1`;
  const visited = new Set();
  const releases = [];
  while (url) {
    if (visited.has(url)) throw new Error('Repeated Releases page');
    visited.add(url);
    const response = await request(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 200) throw new Error(`GitHub Releases returned HTTP ${response.status}`);
    const page = await response.json();
    validateReleases(page);
    releases.push(...page);
    const links = response.headers.get('link');
    const next = links?.split(',').find((link) => /;\s*rel="next"(?:\s*;|\s*$)/.test(link));
    url = '';
    if (next) {
      const target = next.match(/^\s*<([^>]+)>/);
      if (!target) throw new Error('Malformed Releases pagination link');
      const nextUrl = new URL(target[1]);
      if (`${nextUrl.origin}${nextUrl.pathname}` !== endpoint || nextUrl.username || nextUrl.password ||
          nextUrl.hash || nextUrl.searchParams.get('per_page') !== '100' ||
          !/^[1-9]\d*$/.test(nextUrl.searchParams.get('page') ?? '') ||
          [...nextUrl.searchParams.keys()].some((key) => key !== 'per_page' && key !== 'page')) {
        throw new Error('Unexpected Releases pagination URL');
      }
      url = nextUrl.href;
    }
  }
  return releases;
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--repo', '--output'].includes(key) || !args[index + 1] || options[key]) {
      throw new Error('Usage: node generate-download-stats.mjs --repo owner/repo --output download-stats.json');
    }
    options[key] = args[index + 1];
  }
  if (!options['--repo'] || !options['--output']) throw new Error('Both --repo and --output are required');
  const releases = await fetchReleases(options['--repo']);
  const stats = summarizeReleases(releases, new Date().toISOString(), options['--repo']);
  const output = resolve(options['--output']);
  const temporary = `${output}.${process.pid}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(stats, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  console.log(`Generated ${output}: ${stats.appDownloads} app asset downloads`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Download statistics failed: ${error.message}`);
    process.exitCode = 1;
  });
}
