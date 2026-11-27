import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const args = process.argv.slice(2);
const addonsDir = resolve(option(args, 'addons-dir', 'addons'));
const flight3dDir = resolve(option(args, 'flight3d-dir', '.flight3d'));
const baseUrl = option(args, 'base-url', 'https://stlim0727.github.io/flight3d-addons').replace(/\/+$/, '');
const outDir = resolve(option(args, 'out-dir', 'dist'));

const { validateAddonManifest, validateCatalog } = await import(
  pathToFileURL(join(flight3dDir, 'src/addons/addonContract.js')).href
);

async function findManifests(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await findManifests(full));
    else if (entry.isFile() && entry.name === 'addon.json') results.push(full);
  }
  return results.sort();
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function rewriteLocalResourceUrl(resource, addonFolder, publishedFolderUrl) {
  if (!resource || typeof resource.url !== 'string') return;
  const fileName = basename(new URL(resource.url, 'https://placeholder.invalid/').pathname);
  if (!fileName) return;
  for (const rel of [fileName, `assets/${fileName}`]) {
    try {
      const info = await stat(join(addonFolder, rel));
      if (info.isFile()) {
        resource.url = `${publishedFolderUrl}/${rel}`;
        return;
      }
    } catch {
      // External asset URL; keep as-is.
    }
  }
}

await mkdir(join(outDir, 'addons'), { recursive: true });
const manifestPaths = await findManifests(addonsDir);
const entries = [];

for (const manifestPath of manifestPaths) {
  const relPath = relative(addonsDir, manifestPath);
  const relDir = dirname(relPath).replaceAll('\\', '/');
  const sourceDir = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const check = validateAddonManifest(manifest);
  if (!check.ok) {
    throw new Error(`invalid manifest ${relPath}: ${check.errors.join('; ')}`);
  }

  const destDir = join(outDir, 'addons', relDir);
  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, { recursive: true });

  const publishedFolderUrl = `${baseUrl}/addons/${relDir}`;
  const published = structuredClone(manifest);
  await rewriteLocalResourceUrl(published.aircraft?.model, sourceDir, publishedFolderUrl);
  await rewriteLocalResourceUrl(published.aircraft?.cockpit, sourceDir, publishedFolderUrl);
  for (const asset of published.assets ?? []) {
    await rewriteLocalResourceUrl(asset, sourceDir, publishedFolderUrl);
  }
  for (const override of published.region?.buildingOverrides ?? []) {
    await rewriteLocalResourceUrl(override?.model, sourceDir, publishedFolderUrl);
  }

  const manifestJson = JSON.stringify(published, null, 2) + '\n';
  await writeFile(join(destDir, 'addon.json'), manifestJson, 'utf8');
  const sha256 = sha256Hex(Buffer.from(manifestJson, 'utf8'));

  entries.push({
    id: published.id,
    version: published.version,
    title: published.title ?? published.attribution ?? published.id,
    publisher: published.publisher,
    compatible: true,
    url: `${publishedFolderUrl}/addon.json`,
    sha256,
  });
}

const catalog = { schemaVersion: 1, addons: entries };
const catalogCheck = validateCatalog(catalog);
if (!catalogCheck.ok) {
  throw new Error(`generated catalog invalid: ${catalogCheck.errors.join('; ')}`);
}
await writeFile(join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(`Built catalog.json with ${entries.length} addon(s) at ${outDir}`);
