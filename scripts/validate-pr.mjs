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
const coreVersion = option(args, 'core', '1.8.0');
const prNumber = Number(option(args, 'pr', '0'));
const headSha = option(args, 'head-sha', '');
const previewBaseUrl = option(args, 'preview-base-url', 'https://stlim0727.github.io/flight3d-addons/previews').replace(/\/+$/, '');
const outDir = option(args, 'out-dir', '');

const [{ validateAddonManifest, validateCatalog }, { lintAddonSet }, { verifyAddonRuntime }] = await Promise.all([
  import(pathToFileURL(join(flight3dDir, 'src/addons/addonContract.js')).href),
  import(pathToFileURL(join(flight3dDir, 'src/addons/lintAddonSet.js')).href),
  import(pathToFileURL(join(flight3dDir, 'src/addons/verifyAddonRuntime.js')).href),
]);

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
    if (entry.isDirectory()) {
      results.push(...await findManifests(full));
    } else if (entry.isFile() && entry.name === 'addon.json') {
      results.push(full);
    }
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

async function rewriteManifestForPreview(manifest, addonFolder, publishedFolderUrl) {
  const cloned = structuredClone(manifest);
  await rewriteLocalResourceUrl(cloned.aircraft?.model, addonFolder, publishedFolderUrl);
  await rewriteLocalResourceUrl(cloned.aircraft?.cockpit, addonFolder, publishedFolderUrl);
  await rewriteLocalResourceUrl(cloned.aircraft?.livery?.tailEmblem?.map, addonFolder, publishedFolderUrl);
  for (const spec of Object.values(cloned.aircraft?.livery?.materials ?? {})) {
    await rewriteLocalResourceUrl(spec?.map, addonFolder, publishedFolderUrl);
  }
  for (const asset of cloned.assets ?? []) {
    await rewriteLocalResourceUrl(asset, addonFolder, publishedFolderUrl);
  }
  for (const override of cloned.region?.buildingOverrides ?? []) {
    await rewriteLocalResourceUrl(override?.model, addonFolder, publishedFolderUrl);
  }
  return cloned;
}

const manifestPaths = await findManifests(addonsDir);
const manifests = [];
const errors = [];

for (const manifestPath of manifestPaths) {
  const relPath = relative(addonsDir, manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    errors.push(`${relPath}: invalid JSON (${error.message})`);
    continue;
  }
  const schema = validateAddonManifest(manifest, { coreVersion });
  if (!schema.ok) {
    for (const msg of schema.errors) errors.push(`${relPath}: ${msg}`);
    continue;
  }
  const runtime = await verifyAddonRuntime(manifest, {
    coreVersion,
    addonDir: dirname(manifestPath),
    strict: true,
    requireLocalAssets: true,
  });
  for (const warning of runtime.warnings) console.warn(`WARN [${relPath}]: ${warning}`);
  if (!runtime.ok) {
    for (const msg of runtime.errors) errors.push(`${relPath}: ${msg}`);
    continue;
  }
  manifests.push({ manifestPath, relPath, manifest });
}

if (manifests.length > 0) {
  const byId = new Map();
  for (const { relPath, manifest } of manifests) {
    if (byId.has(manifest.id)) {
      errors.push(`lint-set: duplicate manifest id ${manifest.id} (${relPath})`);
      continue;
    }
    byId.set(manifest.id, manifest);
  }

  const seenErrors = new Set();
  const seenWarnings = new Set();
  const collectClosure = rootManifest => {
    const closure = [];
    const visited = new Set();
    const visit = current => {
      if (!current || visited.has(current.id)) return;
      visited.add(current.id);
      closure.push(current);
      for (const dep of current.dependencies ?? []) {
        if (byId.has(dep.id)) visit(byId.get(dep.id));
      }
      for (const req of current.scenario?.requiredAddons ?? []) {
        if (byId.has(req.id)) visit(byId.get(req.id));
      }
    };
    visit(rootManifest);
    return closure;
  };

  for (const { manifest } of manifests) {
    const lint = lintAddonSet(collectClosure(manifest), { coreVersion });
    for (const warning of lint.warnings) {
      if (!seenWarnings.has(warning)) {
        seenWarnings.add(warning);
        console.warn(`WARN [lint-set]: ${warning}`);
      }
    }
    if (!lint.ok) {
      for (const msg of lint.errors) {
        if (!seenErrors.has(msg)) {
          seenErrors.add(msg);
          errors.push(`lint-set: ${msg}`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

console.log(`OK: validated ${manifests.length} addon(s) against flight3d core ${coreVersion}`);

if (outDir && prNumber > 0) {
  const bundleRoot = resolve(outDir);
  const prFilesRoot = join(bundleRoot, `pr-${prNumber}`);
  await mkdir(prFilesRoot, { recursive: true });
  const catalogEntries = [];

  for (const { manifestPath, relPath, manifest } of manifests) {
    const relDir = dirname(relPath).replaceAll('\\', '/');
    const sourceDir = dirname(manifestPath);
    const destDir = join(prFilesRoot, relDir);
    await mkdir(destDir, { recursive: true });
    await cp(sourceDir, destDir, { recursive: true });

    const publishedFolderUrl = `${previewBaseUrl}/pr-${prNumber}/${relDir}`;
    const publishedManifest = await rewriteManifestForPreview(manifest, sourceDir, publishedFolderUrl);
    const manifestJson = JSON.stringify(publishedManifest, null, 2) + '\n';
    await writeFile(join(destDir, 'addon.json'), manifestJson, 'utf8');
    const manifestSha = sha256Hex(Buffer.from(manifestJson, 'utf8'));

    catalogEntries.push({
      id: publishedManifest.id,
      version: publishedManifest.version,
      title: publishedManifest.title ?? publishedManifest.attribution ?? publishedManifest.id,
      publisher: publishedManifest.publisher,
      compatible: true,
      url: `${publishedFolderUrl}/addon.json`,
      sha256: manifestSha,
    });
  }

  const catalog = { schemaVersion: 1, addons: catalogEntries };
  const catalogCheck = validateCatalog(catalog);
  if (!catalogCheck.ok) {
    console.error(`FAIL: generated PR catalog invalid: ${catalogCheck.errors.join('; ')}`);
    process.exit(1);
  }

  const previewDoc = {
    schemaVersion: 1,
    prNumber,
    headSha,
    ciPassed: true,
    checkName: 'validate-addons',
    generatedAt: new Date().toISOString(),
    catalog,
  };
  await writeFile(join(bundleRoot, `pr-${prNumber}.json`), JSON.stringify(previewDoc, null, 2) + '\n', 'utf8');
  console.log(`Wrote PR preview bundle to ${bundleRoot}/pr-${prNumber}.json`);
}
