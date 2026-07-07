import fs from 'fs/promises';
import path from 'path';
import { parseArgs } from 'node:util';

const args = parseArgs({
  allowPositionals: true,
  options: {
    output: {
      short: 'o',
      type: 'string',
      default: 'combine-part',
    },
    'max-chars': {
      type: 'string',
      default: '200000',
    },
  },
});

const ROOT_DIR = process.cwd();

const INPUTS =
  args.positionals.length > 0
    ? args.positionals.map((p) => path.resolve(p))
    : [ROOT_DIR];

const OUTPUT_PREFIX = args.values.output;
const MAX_CHARS = Number(args.values['max-chars']);
const INCLUDE_EXTENSIONS = new Set([
  '.ts',
  '.mjs', //
  '.json',
  '.yaml',
  '.yml',
  '.sql',
  '.conf',
]);

const INCLUDE_FILENAMES = new Set([
  '.nvmrc',
  '.env.example',
  '.dockerignore',
  '.env.development',

  'Dockerfile',
  'Makefile',
  '.gitkeep',
  '.prettierrc',
  '.prettierignore',
  // '.npmrc',
  // '.npmignore',
  // '.gitignore',
  // '.editorconfig',
  // ".dockerignore",
  // ".code-workspace",
  // ".example",
  // 'build',
]);

const IGNORE_NAMES = new Set([
  '.git',
  '.turbo',
  '.vscode',
  'node_modules',
  'pnpm-lock.yaml',
  'package-lock.json',
  'dist',
  'build',
  'README.md', //

  'tsup.config.ts',
  'vitest.config.ts',
]);

const IGNORE_PATH_PREFIXES = ['scripts'];

const ignoreFile = path.join(process.cwd(), '.ignorecombine');

let ignorePatterns: string[] = [];

function normalize(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

function shouldIgnore(relPath: string): boolean {
  const normalized = normalize(relPath);

  for (const pattern of ignorePatterns) {
    if (pattern.startsWith('*.')) {
      if (normalized.endsWith(pattern.slice(1))) {
        return true;
      }
      continue;
    }

    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' +
          pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') +
          '$',
      );

      if (regex.test(normalized)) {
        return true;
      }

      continue;
    }

    if (
      normalized === pattern ||
      normalized.startsWith(`${pattern}/`) ||
      normalized.split('/').includes(pattern)
    ) {
      return true;
    }
  }

  for (const prefix of IGNORE_PATH_PREFIXES) {
    if (
      normalized === prefix.replace(/\/$/, '') ||
      normalized.startsWith(prefix)
    ) {
      return true;
    }
  }

  return normalized.split('/').some((segment) => IGNORE_NAMES.has(segment));
}

function shouldInclude(fileName: string): boolean {
  return (
    INCLUDE_EXTENSIONS.has(path.extname(fileName)) ||
    INCLUDE_FILENAMES.has(fileName)
  );
}

function isProbablyText(content: string): boolean {
  // crude binary detection
  return !content.includes('\0');
}

// ---- File Walker (Iterative DFS) ----

async function collectFiles(): Promise<string[]> {
  const stack = [...INPUTS];
  const result: string[] = [];

  while (stack.length) {
    const current = stack.pop()!;

    let stat;

    try {
      stat = await fs.stat(current);
    } catch {
      console.warn(`⚠ skipped missing path: ${current}`);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    if (stat.isFile()) {
      const rel = normalize(path.relative(ROOT_DIR, current));

      if (!shouldIgnore(rel) && shouldInclude(path.basename(current))) {
        result.push(current);
      }

      continue;
    }

    const entries = await fs.readdir(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = normalize(path.relative(ROOT_DIR, full));

      if (shouldIgnore(rel)) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && shouldInclude(entry.name)) {
        result.push(full);
      }
    }
  }

  return result.sort();
}

// ---- Main Processor ----

async function run() {
  try {
    ignorePatterns = (await fs.readFile(ignoreFile, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    // .ignorecombine is optional
  }
  const files = await collectFiles();

  let part = 1;
  let currentChars = 0;
  let buffer = '';

  async function flush() {
    if (!buffer.trim()) return;

    const fileName = `${OUTPUT_PREFIX}-${part}.md`;

    await fs.writeFile(fileName, buffer.trimEnd() + '\n', 'utf8');

    console.log(`✔ written ${fileName}`);

    buffer = '';
    currentChars = 0;
    part++;
  }

  for (const file of files) {
    const rel = normalize(path.relative(ROOT_DIR, file));

    if (rel.startsWith(OUTPUT_PREFIX)) continue;

    let content: string;
    try {
      content = (await fs.readFile(file, 'utf8')).trimEnd();
    } catch {
      continue;
    }

    if (!isProbablyText(content)) {
      continue;
    }

    const section = `## ${rel}\n\n${content}\n\n---\n\n`;
    const size = section.length;

    if (size > MAX_CHARS) {
      console.warn(`⚠ skipped ${rel} (${size} > ${MAX_CHARS})`);
      continue;
    }

    if (currentChars + size > MAX_CHARS) {
      await flush();
    }

    buffer += section;
    currentChars += size;
  }

  await flush();

  console.log(`✔ done. Total parts: ${part - 1}`);
}

// ---- Entry ----

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
