import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const OUTPUT_PREFIX = 'combine-part';

const BLOCK_REGEX = /##\s+([^\n]+)\n([\s\S]*?)(?=\n---|\n##\s+|$)/g;

function getInputFiles(): string[] {
  return fs
    .readdirSync(ROOT_DIR)
    .filter((f) => f.startsWith(OUTPUT_PREFIX) && f.endsWith('.md'))
    .sort()
    .map((f) => path.join(ROOT_DIR, f));
}

const inputFiles = getInputFiles();

if (inputFiles.length === 0) {
  console.error('✖ No combine-part-*.md files found');
  process.exit(1);
}

let written = 0;

for (const file of inputFiles) {
  const md = fs.readFileSync(file, 'utf8');

  let match: RegExpExecArray | null;
  BLOCK_REGEX.lastIndex = 0;

  while ((match = BLOCK_REGEX.exec(md)) !== null) {
    const relativePath = match[1].trim();
    const body = match[2].trim();

    if (!body) continue;

    const fullPath = path.join(ROOT_DIR, relativePath);

    fs.mkdirSync(path.dirname(fullPath), {
      recursive: true,
    });

    fs.writeFileSync(fullPath, body + '\n', 'utf8');

    written++;
    console.log(`✔ wrote ${relativePath}`);
  }
}

if (written === 0) {
  console.error('✖ No valid file sections found');
  process.exit(1);
}

console.log(
  `\nDone. ${written} files generated from ${inputFiles.length} part files.`,
);
