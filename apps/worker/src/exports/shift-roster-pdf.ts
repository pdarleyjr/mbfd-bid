import puppeteer from '@cloudflare/puppeteer';
import type { Fetcher } from '@cloudflare/workers-types';
import { type ShiftRoster, exportTimestamp, shiftLabel } from './shift-roster.js';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

export function renderShiftRosterHtml(roster: ShiftRoster): string {
  const esc = escapeHtml;
  const shifts = roster.shifts
    .map(
      (shift) => `<section class="shift">
    <header><h1>MBFD ${roster.year} - ${esc(shiftLabel(shift.shift))}</h1>
    <div class="mode ${roster.isMock ? 'mock' : ''}">${roster.isMock ? 'MOCK REHEARSAL - Do not use for staffing assignments.' : 'REAL BID - Progress at export time'}</div>
    <p>${shift.positions} seats &middot; ${shift.selected} selected &middot; ${shift.available} available &middot; Sequence ${roster.sequence} &middot; ${esc(roster.phase.replaceAll('_', ' '))}</p></header>
    ${shift.stations.map((station) => `<section class="station"><h2>${esc(/^\d+$/.test(station.station.trim()) ? `Station ${station.station.trim()}` : station.station)}</h2><table><colgroup><col style="width:7%"><col style="width:14%"><col style="width:22%"><col style="width:6%"><col style="width:23%"><col style="width:11%"><col style="width:17%"></colgroup><thead><tr><th>Seat</th><th>Unit</th><th>Position</th><th>Rank</th><th>Member</th><th>A-Day</th><th>Status</th></tr></thead><tbody>${station.rows.map((row) => `<tr class="${row.status === 'Selected' ? 'selected' : ''}"><td class="seat">${esc(row.positionId)}</td><td>${esc(row.unit)}</td><td>${esc(row.position)}</td><td>${esc(row.rank)}</td><td>${row.member ? `<strong>${esc(`${row.memberRank ?? row.rank} ${row.member}`)}</strong>` : `<span class="empty">${row.status === 'Available' ? 'Open' : '-'}</span>`}${row.temporaryDuties.map((duty) => `<div class="detail">Temporary duty: ${esc(duty)}</div>`).join('')}</td><td>${esc(row.aDay ?? '')}</td><td>${esc(row.status)}${row.markers.map((marker) => `<div class="detail">${esc(marker)}</div>`).join('')}</td></tr>`).join('')}</tbody></table></section>`).join('')}
    ${shift.positions === 0 ? '<p>No seats in this saved shift.</p>' : ''}
    <footer>Captured ${esc(exportTimestamp(roster.generatedAt))} &middot; Session ${esc(roster.sessionId)}<br>Saved rule book ${esc(roster.ruleBookVersion)} &middot; Configuration ${roster.configurationRevision} &middot; Policy captured ${esc(exportTimestamp(roster.snapshotCapturedAt))}</footer>
  </section>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>MBFD Bid shifts</title><style>
    @page{size:Letter landscape;margin:0.55in 0.4in}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#17314f;font-size:9pt}.shift+.shift{break-before:page}header{border-bottom:2pt solid #17314f;margin:0 0 12pt}h1{font-size:21pt;margin:0 0 5pt}.mode{font-weight:bold;font-size:10pt}.mock{color:#b91c1c}header p{margin:5pt 0 8pt;font-size:9pt;color:#475569}h2{font-size:12pt;background:#e8edf4;padding:6pt;margin:12pt 0 0;break-after:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{padding:5pt 6pt;text-align:left;vertical-align:top;border-bottom:0.5pt solid #d7dee8;overflow-wrap:anywhere}th{font-size:8pt;text-transform:uppercase;background:#f5f7fa}td{font-size:9pt;line-height:1.2}.selected{background:#edf8f1}.seat{font-weight:bold}.empty{color:#64748b}.detail{font-size:8pt;margin-top:3pt;color:#475569}footer{margin-top:12pt;font-size:7.5pt;color:#64748b;line-height:1.4}
  </style></head><body>${shifts}${roster.unplacedTemporaryDuties.length ? `<section><h2>Temporary duties without a seat</h2>${roster.unplacedTemporaryDuties.map((duty) => `<p>${esc(duty)}</p>`).join('')}</section>` : ''}</body></html>`;
}

/** Set one already captured document directly. The renderer cannot refetch a
 * later command sequence, access an admin cookie, or load third-party assets. */
export async function generateShiftPdf(roster: ShiftRoster, binding: Fetcher): Promise<Uint8Array> {
  const browser = await puppeteer.launch(
    binding as unknown as Parameters<typeof puppeteer.launch>[0],
  );
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setContent(renderShiftRosterHtml(roster), { waitUntil: 'load', timeout: 30_000 });
    const bytes = await page.pdf({
      format: 'Letter',
      landscape: true,
      printBackground: true,
      margin: { top: '0.55in', right: '0.4in', bottom: '0.55in', left: '0.4in' },
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-family:Arial,sans-serif;font-size:8px;width:100%;padding:0 29px;color:${roster.isMock ? '#b91c1c' : '#475569'}">MBFD ${roster.year} &middot; ${roster.isMock ? 'MOCK REHEARSAL - Not for staffing' : 'REAL BID'} &middot; Sequence ${roster.sequence} &middot; Captured ${escapeHtml(exportTimestamp(roster.generatedAt))}</div>`,
      footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:8px;width:100%;padding:0 29px;color:#64748b;display:flex;justify-content:space-between"><span>Session ${escapeHtml(roster.sessionId)} &middot; ${roster.scope === 'ALL' ? 'All shifts' : escapeHtml(shiftLabel(roster.scope))}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } finally {
    await browser.close();
  }
}
