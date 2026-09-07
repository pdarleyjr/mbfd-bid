import { GUIDE_SECTIONS } from '../app/admin/guide/guide-content';

export function helpForPath(path: string) {
  const matches = GUIDE_SECTIONS.filter(
    (s) => path === s.route || (s.route !== '/admin' && path.startsWith(`${s.route}/`)),
  );
  const longest = Math.max(0, ...matches.map((s) => s.route.length));
  return matches.filter((s) => s.route.length === longest);
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Offline, printable manual from exactly the same content as the live help. */
export function buildAdministratorManual() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MBFD Bid — Complete Administrator Manual</title>
<style>body{font:17px/1.65 system-ui,sans-serif;color:#182331;max-width:960px;margin:auto;padding:32px}h1,h2,h3{line-height:1.2}h2{padding-top:28px;border-top:1px solid #ddd}a{color:#164d78}aside{background:#fff4d8;padding:16px}li{margin-bottom:10px}button{padding:12px;font:inherit}@media print{button{display:none}h2{break-after:avoid}a{color:inherit}}</style>
<h1>MBFD Bid</h1><p>Complete Administrator Manual · September 2026</p><p>This manual describes the available administrator workflows. The adopted bid policy and approved amendments determine the rules; this guide explains how to operate the software.</p><button onclick="window.print()">Print / Save as PDF</button>
<nav aria-label="Contents"><h2>Contents</h2><ol>${GUIDE_SECTIONS.map((s) => `<li><a href="#${escapeHtml(s.id)}">${escapeHtml(s.title)}</a></li>`).join('')}</ol></nav>
${GUIDE_SECTIONS.map((s) => `<article id="${escapeHtml(s.id)}"><h2>${escapeHtml(s.title)}</h2><p>${escapeHtml(s.category)}</p><p>${escapeHtml(s.summary)}</p><p>In the application: <a href="https://bid.mbfdhub.com${escapeHtml(s.route)}">${escapeHtml(s.routeLabel)}</a> (administrator sign-in required).</p><h3>How to use it</h3><ol>${s.steps.map((v) => `<li>${escapeHtml(v)}</li>`).join('')}</ol><h3>Controls</h3><ul>${s.controls.map((v) => `<li>${escapeHtml(v)}</li>`).join('')}</ul>${s.important ? `<aside>${escapeHtml(s.important)}</aside>` : ''}</article>`).join('')}</html>`;
}
