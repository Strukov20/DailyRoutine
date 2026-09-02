#!/usr/bin/env node
/**
 * Validates the structure of the LLM Wiki under knowledge/wiki/.
 *
 * Deliberately plain Node + fs/path only — no dependency, per docs/LLM_WIKI.md
 * ("Do not add a heavy dependency when a small Node script is sufficient").
 *
 * Checks:
 *  - knowledge/wiki/index.md and knowledge/wiki/log.md exist
 *  - every wiki article is reachable from index.md via relative Markdown links
 *  - every relative Markdown link in a wiki page resolves to a real file
 *  - every wiki page has the required frontmatter (title, status, updated, sources, tags)
 *  - every path listed in a page's `sources:` frontmatter exists on disk
 *  - no two wiki pages share the same title
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const wikiDir = join(repoRoot, 'knowledge', 'wiki');
const indexPath = join(wikiDir, 'index.md');
const logPath = join(wikiDir, 'log.md');

const errors = [];
const warnings = [];

function relToRoot(p) {
  return relative(repoRoot, p);
}

function walkMarkdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/** Minimal frontmatter parser for the controlled subset this repo uses:
 *  scalars, inline arrays `[a, b]`, and block list arrays (`- item` lines). */
function parseFrontmatter(content, filePath) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return null;
  }
  const lines = match[1].split(/\r?\n/);
  const data = {};
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const blockItem = line.match(/^\s*-\s*(.*)$/);
    if (blockItem && currentKey) {
      data[currentKey] = data[currentKey] || [];
      data[currentKey].push(stripQuotes(blockItem[1].trim()));
      continue;
    }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) {
      continue;
    }
    const [, key, rawValue] = kv;
    currentKey = key;
    const value = rawValue.trim();
    if (value === '') {
      data[key] = []; // may be filled by following block-list lines
    } else if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map((s) => stripQuotes(s.trim()));
    } else {
      data[key] = stripQuotes(value);
    }
  }
  return data;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function extractRelativeLinks(body) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(body))) {
    const target = m[1].trim();
    if (/^(https?:)?\/\//.test(target) || target.startsWith('mailto:') || target.startsWith('#')) {
      continue;
    }
    links.push(target.split('#')[0]);
  }
  return links;
}

if (!existsSync(indexPath)) {
  console.error(`✗ Missing ${relToRoot(indexPath)}`);
  process.exit(1);
}
if (!existsSync(logPath)) {
  errors.push(`Missing ${relToRoot(logPath)}`);
}

const allWikiFiles = existsSync(wikiDir) ? walkMarkdownFiles(wikiDir) : [];
const articleFiles = allWikiFiles.filter((f) => f !== indexPath && f !== logPath);

const titles = new Map(); // title -> [files]
const fileData = new Map(); // file -> { frontmatter, body, links }

for (const file of allWikiFiles) {
  const content = readFileSync(file, 'utf8');
  const frontmatter = parseFrontmatter(content, file);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const links = extractRelativeLinks(body);
  fileData.set(file, { frontmatter, body, links });

  const isIndexOrLog = file === indexPath || file === logPath;
  if (!isIndexOrLog) {
    if (!frontmatter) {
      errors.push(`${relToRoot(file)}: missing frontmatter block`);
    } else {
      for (const required of ['title', 'status', 'updated', 'sources', 'tags']) {
        if (!(required in frontmatter)) {
          errors.push(`${relToRoot(file)}: frontmatter missing required key "${required}"`);
        }
      }
      if (frontmatter.title) {
        const list = titles.get(frontmatter.title) ?? [];
        list.push(file);
        titles.set(frontmatter.title, list);
      }
      if (Array.isArray(frontmatter.sources)) {
        for (const src of frontmatter.sources) {
          const resolved = resolve(dirname(file), src);
          if (!existsSync(resolved)) {
            errors.push(`${relToRoot(file)}: sources entry not found on disk: ${src}`);
          }
        }
      }
    }
  }

  // Every relative link must resolve to a real file.
  for (const link of links) {
    const resolved = resolve(dirname(file), link);
    if (!existsSync(resolved)) {
      errors.push(`${relToRoot(file)}: broken link -> ${link}`);
    }
  }
}

// Duplicate titles.
for (const [title, files] of titles) {
  if (files.length > 1) {
    errors.push(`Duplicate title "${title}" used by: ${files.map((f) => relToRoot(f)).join(', ')}`);
  }
}

// Reachability from index.md via relative .md links (transitive).
const reachable = new Set([indexPath]);
const queue = [indexPath];
while (queue.length > 0) {
  const current = queue.shift();
  const { links } = fileData.get(current) ?? { links: [] };
  for (const link of links) {
    if (!link.endsWith('.md')) continue;
    const resolved = resolve(dirname(current), link);
    if (existsSync(resolved) && !reachable.has(resolved)) {
      reachable.add(resolved);
      queue.push(resolved);
    }
  }
}

for (const file of articleFiles) {
  if (!reachable.has(file)) {
    errors.push(`${relToRoot(file)}: not reachable from knowledge/wiki/index.md`);
  }
}

if (warnings.length > 0) {
  console.warn('Warnings:');
  for (const w of warnings) console.warn(`  ! ${w}`);
}

if (errors.length > 0) {
  console.error(`✗ wiki:lint found ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✓ wiki:lint passed — ${articleFiles.length} article(s) validated`);
