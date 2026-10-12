#!/usr/bin/env node
// Snap PR gate: sends the PR diff plus as much of the repo as fits to SubQ Snap and gets back ship / needs_review / risky.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERDICTS = ['ship', 'needs_review', 'risky'];

const QUESTIONS = {
  verdict: {
    type: 'choice',
    instructions:
      'The state is a pull request diff followed by the repository source. Decide how safe it is to merge this pull request.',
    criteria: {
      ship: 'Small, self-contained, consistent with the codebase, no risk beyond its stated purpose',
      needs_review: 'Reasonable change that touches shared logic or public APIs, or lacks tests; a human should look',
      risky: 'Touches auth, secrets, payments, migrations or data deletion, breaks callers, or looks like a bug',
    },
  },
};

// Lockfiles and minified bundles burn context without telling Snap anything.
const SKIP = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|[^/]*\.min\.(js|css))$/;

// Docs and tests say little about merge risk, so they only get leftover budget.
const LAST = /(^|\/)(docs?|tests?|__tests__|examples?)\/|\.(md|mdx|txt)$|\.(test|spec)\.[^/]+$/;

export function orderFiles(changed, all) {
  return [...new Set([...changed, ...all.filter((f) => !LAST.test(f)), ...all.filter((f) => LAST.test(f))])];
}

// Diff always goes first; then files in priority order until the budget runs out.
export function buildState(diff, files, read, maxChars) {
  let state = `## Pull request diff\n${diff}\n\n## Repository files\n`;
  if (state.length > maxChars) return state.slice(0, maxChars) + '\n[diff truncated]\n';
  let omitted = 0;
  for (const f of files) {
    if (SKIP.test(f)) continue;
    const body = read(f);
    if (body == null) continue;
    const block = `\n### ${f}\n${body}\n`;
    if (state.length + block.length > maxChars) { omitted++; continue; }
    state += block;
  }
  if (omitted) state += `\n[${omitted} files omitted for size]\n`;
  return state;
}

export function shouldFail(verdict, failOn) {
  if (failOn === 'never') return false;
  if (!VERDICTS.includes(failOn)) throw new Error(`fail-on must be needs_review, risky or never, got "${failOn}"`);
  return VERDICTS.indexOf(verdict) >= VERDICTS.indexOf(failOn);
}

function readText(path) {
  try {
    const buf = readFileSync(path);
    return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8'); // NUL byte = binary
  } catch {
    return null; // deleted in this PR, or a submodule dir
  }
}

async function main() {
  const { SUBQ_API_KEY, BASE_REF = 'origin/main', FAIL_ON = 'risky', MAX_CHARS = '1200000' } = process.env;
  if (!SUBQ_API_KEY) throw new Error('SUBQ_API_KEY is empty (fork PRs do not get repo secrets)');
  shouldFail('ship', FAIL_ON); // validate input before spending a call

  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const range = `${BASE_REF}...HEAD`;
  const diff = git('diff', range);
  if (!diff.trim()) return console.log('Empty diff, nothing to gate.');
  const changed = git('diff', '--name-only', range).split('\n').filter(Boolean);
  const files = orderFiles(changed, git('ls-files').split('\n').filter(Boolean));
  const state = buildState(diff, files, readText, Number(MAX_CHARS));

  const res = await fetch(`${process.env.SUBQ_BASE_URL ?? 'https://api.subq.ai/v1'}/systemone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUBQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.SUBQ_MODEL ?? 'subq-snap-preview', state, questions: QUESTIONS }),
  });
  if (!res.ok) throw new Error(`SubQ ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const { choice, confidence, probabilities } = (json.answers ?? json).verdict;

  const summary = [
    `## Snap PR gate: **${choice}** (confidence ${confidence.toFixed(2)})`,
    '', '| verdict | probability |', '|---|---|',
    ...VERDICTS.map((v) => `| ${v} | ${(probabilities[v] ?? 0).toFixed(2)} |`),
    '', `<sub>${state.length.toLocaleString()} chars sent, ${changed.length} files changed</sub>`,
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${choice}\nconfidence=${confidence}\n`);
  if (shouldFail(choice, FAIL_ON)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
