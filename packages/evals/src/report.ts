import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVAL_CASES } from './cases';
import { CHECK_IDS, CHECK_LABELS } from './grade';
import { readErrors, readRows, type EvalError, type EvalRow } from './run';
import { summarize, type Rate } from './summary';

/**
 * Builds <runsDir>/report.html from every variant directory (one per prompt version and model):
 * pass rate per check side by side, then every case with its runs, failed checks and links to
 * the traces. A static page: everything from disk is escaped, nothing loads from the network.
 */

interface Variant {
  dir: string;
  promptVersion: string;
  model: string;
  rows: EvalRow[];
  errors: EvalError[];
}

export async function loadVariants(runsDir: string): Promise<Variant[]> {
  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch {
    return [];
  }
  const variants: Variant[] = [];
  for (const dir of names.sort()) {
    const path = join(runsDir, dir);
    const stat = await lstat(path);
    if (!stat.isDirectory()) continue;
    let meta: { promptVersion?: string; model?: string };
    try {
      meta = JSON.parse(await readFile(join(path, 'meta.json'), 'utf8')) as typeof meta;
    } catch {
      continue;
    }
    variants.push({
      dir,
      promptVersion: String(meta.promptVersion ?? '?'),
      model: String(meta.model ?? '?'),
      rows: await readRows(path),
      errors: await readErrors(path),
    });
  }
  return variants;
}

const esc = (value: string | number | null | undefined) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Only links that stay inside the runs directory. */
const safeHref = (path: string) =>
  /^[A-Za-z0-9._-]+\/traces\/[A-Za-z0-9._-]+\.json$/.test(path) ? esc(path) : null;

function rateCell(r: Rate): string {
  if (r.rate === null) return '<td class="na">n/a</td>';
  const pct = Math.round(r.rate * 100);
  const tone = pct >= 95 ? 'good' : pct >= 75 ? 'mid' : 'bad';
  return `<td class="${tone}"><b>${pct}%</b> <span class="sub">${r.passed}/${r.of} · ${Math.round(r.low! * 100)}–${Math.round(r.high! * 100)}%</span></td>`;
}

export async function buildReport(runsDir: string): Promise<string> {
  const variants = await loadVariants(runsDir);
  const out = join(runsDir, 'report.html');
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const summaryRows = variants.map((v) => {
    const s = summarize(v.rows, v.errors);
    return `<tr><th scope="row">${esc(v.promptVersion)}<br><span class="sub">${esc(v.model)}</span></th>
      ${rateCell(s.pass)}${CHECK_IDS.map((id) => rateCell(s.checks[id])).join('')}
      <td>${s.runs}${s.errors ? ` <span class="warn">+${s.errors} not scored</span>` : ''}</td>
      <td>${s.costUsd.perRun === null ? 'not measured' : `$${s.costUsd.perRun.toFixed(4)}`}<br><span class="sub">$${s.costUsd.total.toFixed(3)} total</span></td>
      <td>${s.latencyS.mean === null ? '–' : `${s.latencyS.mean.toFixed(1)} s`}</td></tr>`;
  });

  const caseIds = [
    ...new Set([
      ...EVAL_CASES.map((c) => c.id),
      ...variants.flatMap((v) => v.rows.map((r) => r.case_id)),
    ]),
  ];
  const caseRows = caseIds.map((id) => {
    const evalCase = EVAL_CASES.find((c) => c.id === id);
    const cells = variants.map((v) => {
      const rows = v.rows.filter((r) => r.case_id === id).sort((a, b) => a.rep - b.rep);
      if (rows.length === 0) return '<td class="na">not run</td>';
      const passed = rows.filter((r) => r.grade.pass === 1).length;
      const tone = passed === rows.length ? 'good' : passed === 0 ? 'bad' : 'mid';
      const details = rows
        .map((r) => {
          const href = safeHref(`${v.dir}/${r.trace}`);
          const link = href ? `<a href="${href}">trace</a>` : '';
          const failed = Object.entries(r.reasons)
            .map(
              ([check, reasons]) =>
                `<li><b>${esc(CHECK_LABELS[check as keyof typeof CHECK_LABELS] ?? check)}:</b> ${reasons.map(esc).join(' ')}</li>`,
            )
            .join('');
          return `<div class="rep">#${r.rep} ${r.grade.pass === 1 ? 'pass' : '<span class="bad-text">fail</span>'} ${link}${failed ? `<ul>${failed}</ul>` : ''}</div>`;
        })
        .join('');
      return `<td class="${tone}"><details><summary><b>${passed}/${rows.length}</b> passed</summary>${details}</details></td>`;
    });
    return `<tr><th scope="row"><code>${esc(id)}</code><br><span class="sub">${esc(evalCase?.title ?? '')}</span><br>${(evalCase?.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</th>${cells.join('')}</tr>`;
  });

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Briefing evals</title>
<style>
:root{--bg:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--good:#dcfce7;--mid:#fef3c7;--bad:#fee2e2;--na:#f1f5f9}
@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--good:#14532d;--mid:#713f12;--bad:#7f1d1d;--na:#1e293b}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1400px;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.sub{color:var(--muted);font-size:12px;font-weight:normal}.warn{color:#b45309;font-size:12px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
thead th{font-size:12px;color:var(--muted);font-weight:600}
.good{background:var(--good)}.mid{background:var(--mid)}.bad{background:var(--bad)}.na{background:var(--na);color:var(--muted)}
.bad-text{color:#b91c1c;font-weight:600}.tag{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:11px;color:var(--muted)}
.rep{margin-top:4px}.rep ul{margin:2px 0 4px 16px;padding:0}a{color:inherit}code{font-size:12px}
</style></head><body>
<h1>Briefing evals</h1>
<p class="sub">${EVAL_CASES.length} frozen cases, graded by code (no model judges). Each cell is the share of runs that passed, with the run count and a 95% interval: higher is better. Built ${esc(generated)}Z. For flight simulation only.</p>
<h2>By prompt version and model</h2>
<div class="wrap"><table><thead><tr><th>Prompt · model</th><th>All checks</th>${CHECK_IDS.map((id) => `<th>${esc(CHECK_LABELS[id])}</th>`).join('')}<th>Runs</th><th>Cost per run</th><th>Time per run</th></tr></thead>
<tbody>${summaryRows.join('') || `<tr><td colspan="${CHECK_IDS.length + 5}" class="na">No runs yet: pnpm eval</td></tr>`}</tbody></table></div>
<h2>By case</h2>
<p class="sub">Open a cell for each run: which checks failed and why, and its trace (the prompts, every tool call and result, and the answer).</p>
<div class="wrap"><table><thead><tr><th>Case</th>${variants.map((v) => `<th>${esc(v.promptVersion)}<br><span class="sub">${esc(v.model)}</span></th>`).join('')}</tr></thead>
<tbody>${caseRows.join('')}</tbody></table></div>
</body></html>
`;
  await writeFile(out, html);
  return out;
}
