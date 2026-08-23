import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "legacy_timing_maps");
const outputDir = path.join(root, "public", "generated_timing_maps");
const indexPath = path.join(outputDir, "index.json");

function normalizeTrackName(text) {
  const basename = String(text).replace(/^.*[\\/]/, "");
  const stem = basename.replace(/\.[^.]+$/, "");
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
  console.warn(
    `[Parade Suite] Source LIB folder not found: ${sourceDir}. ` +
    "Skipping built-in LIB generation."
  );
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });

// Clear prior generated files so deleted/renamed LIBs do not linger.
for (const entry of fs.readdirSync(outputDir)) {
  fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true });
}

const libFiles = fs
  .readdirSync(sourceDir)
  .filter((name) => name.toLowerCase().endsWith(".lib"))
  .sort((a, b) => a.localeCompare(b));

const index = {};

for (const filename of libFiles) {
  const src = path.join(sourceDir, filename);
  const dest = path.join(outputDir, filename);

  fs.copyFileSync(src, dest);

  const content = fs.readFileSync(src, "utf8");
  const lines = content.split(/\r?\n/);

  const candidateKeys = [
    normalizeTrackName(filename),
    normalizeTrackName(lines[0] || ""),
    normalizeTrackName(lines[1] || ""),
  ].filter(Boolean);

  for (const key of candidateKeys) {
    index[key] = filename;
  }
}

const ordered = Object.fromEntries(
  Object.entries(index).sort(([a], [b]) => a.localeCompare(b))
);

fs.writeFileSync(indexPath, JSON.stringify(ordered, null, 2) + "\n");

console.log(`[Parade Suite] Source LIB folder: ${sourceDir}`);
console.log(`[Parade Suite] Runtime LIB folder: ${outputDir}`);
console.log(
  `[Parade Suite] Copied ${libFiles.length} .lib files and generated ${Object.keys(ordered).length} mappings.`
);
