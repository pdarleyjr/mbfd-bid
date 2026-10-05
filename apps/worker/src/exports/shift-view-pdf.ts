import puppeteer from '@cloudflare/puppeteer';
import type { Fetcher } from '@cloudflare/workers-types';
import { type ShiftRoster, exportTimestamp } from './shift-roster.js';
import {
  SHIFT_VIEW_COLORS,
  shiftViewADay,
  shiftViewColumns,
  shiftViewOccupant,
  shiftViewOccupied,
  shiftViewStationLabel,
  shiftViewSummaries,
  shiftViewTitle,
  shiftViewUnitColor,
} from './shift-view.js';

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

/** A station board on one large landscape sheet. Its saved awards are identical
 * to Bid View; this changes their arrangement, not their source or meaning. */
export function renderShiftViewHtml(roster: ShiftRoster): string {
  const esc = escapeHtml;
  const shifts = roster.shifts
    .map((shift, index) => {
      const columns = shiftViewColumns(shift);
      const board = columns
        .map(
          (blocks) =>
            `<div class="station-column">${blocks
              .map(
                (block) => `
      <table class="station"><colgroup><col class="unit"><col class="seat"><col class="count"><col class="role"><col class="member"><col class="aday"></colgroup>
      <thead><tr><th colspan="6">${esc(shiftViewStationLabel(block.station))}</th></tr></thead><tbody>
      ${block.units
        .map((unit) =>
          unit.rows
            .map(
              (row, rowIndex) => `<tr class="${block.rows.indexOf(row) % 2 ? 'alternate' : ''}">
        ${rowIndex === 0 ? `<td class="unit-band" rowspan="${unit.rows.length}" style="background:${shiftViewUnitColor(unit.unit)}"><span>${esc(unit.unit)}</span></td>` : ''}
        <td class="seat-id">${esc(row.positionId)}</td><td class="occupied">${shiftViewOccupied(row) ? '1' : ''}</td>
        <td>${esc(row.position)}</td><td class="occupant">${esc(shiftViewOccupant(row)).replaceAll('\n', '<br>')}</td><td class="aday">${esc(shiftViewADay(row.aDay))}</td>
      </tr>`,
            )
            .join(''),
        )
        .join('')}
      <tr class="station-total"><td colspan="2">Total</td><td>${block.rows.filter(shiftViewOccupied).length}</td><td colspan="3">${block.rows.length} positions</td></tr>
      </tbody></table>`,
              )
              .join('')}</div>`,
        )
        .join('');
      const summaries = shiftViewSummaries(shift)
        .map(
          (summary) =>
            `<table class="summary"><thead><tr><th colspan="2">${esc(summary.label)}</th></tr></thead><tbody>${summary.values.map(([label, value]) => `<tr><td>${esc(String(value))}</td><td>${esc(label)}</td></tr>`).join('')}</tbody></table>`,
        )
        .join('');
      const unplaced =
        index === roster.shifts.length - 1 && roster.unplacedTemporaryDuties.length
          ? `<p class="temporary">Temporary duties without a seat: ${roster.unplacedTemporaryDuties.map(esc).join('; ')}</p>`
          : '';
      return `<section class="shift-view" data-shift="${shift.shift}">
      <h1 style="background:${SHIFT_VIEW_COLORS[shift.shift]}">${esc(shiftViewTitle(shift))} <span>MBFD ${roster.year} · Shift View</span></h1>
      <p class="mode ${roster.isMock ? 'mock' : ''}">${roster.isMock ? 'MOCK REHEARSAL — Not for staffing assignments' : 'REAL BID — Progress at export time'} · Sequence ${roster.sequence} · ${esc(roster.phase.replaceAll('_', ' '))}</p>
      <div class="board" style="grid-template-columns:repeat(${columns.length},minmax(0,1fr))">${board}</div>
      <div class="summaries">${summaries}</div>${unplaced}
      <footer>Captured ${esc(exportTimestamp(roster.generatedAt))} · Session ${esc(roster.sessionId)} · Saved rule book ${esc(roster.ruleBookVersion)} · Configuration ${roster.configurationRevision}<br>
      ${roster.currentStaffing ? `Chief 300 current assignments: ${esc(roster.currentStaffing.sourceName)} (${esc(exportTimestamp(roster.currentStaffing.snapshotAt))}).<br>` : ''}
      Empty bid seats are open. Admin assigned seats show current staffing when recorded. Due = Deferred A-Day. Forced selections and temporary duties are labelled.</footer>
    </section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>MBFD Shift View</title><style>
    @page{size:17in 11in;margin:.25in}*{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}body{margin:0;font-family:Arial,sans-serif;font-size:8pt;color:#101010}.shift-view{break-inside:avoid;page-break-inside:avoid}.shift-view+.shift-view{break-before:page}h1{font-size:15pt;color:white;text-align:center;margin:0;padding:6pt}h1 span{font-size:10pt;font-weight:normal;margin-left:20pt}.mode{font-size:8pt;margin:5pt 0;text-align:center}.mock{color:#a00000;font-weight:bold}.board{display:grid;gap:4pt;align-items:start}.station{border-collapse:collapse;width:100%;table-layout:fixed;margin:0 0 8pt}.station th{background:#ffff00;font-size:9pt;text-align:center;padding:3pt;border:1pt solid #111}.station td{border:.55pt solid #111;padding:2.5pt 2pt;vertical-align:middle;overflow-wrap:anywhere;font-size:7pt;line-height:1.2}.unit{width:8%}.seat{width:12%}.count{width:7%}.role{width:31%}.member{width:32%}.aday{width:10%}.unit-band{text-align:center;padding:1pt!important}.unit-band span{writing-mode:vertical-rl;transform:rotate(180deg);font-weight:bold;white-space:nowrap;font-size:8pt}.seat-id{color:#0039c2;font-weight:bold;text-align:center}.occupied{color:#d00000;text-align:center}.aday{text-align:center;white-space:normal}.alternate{background:#d8d8d8}.station-total{background:#c5d9ec;font-weight:bold;text-align:center}.station-total td{font-size:7.5pt;white-space:nowrap}.summaries{display:flex;gap:22pt;justify-content:center;align-items:start;margin:14pt 0 8pt}.summary{border-collapse:collapse;min-width:120pt;font-size:8pt}.summary th{background:#96cf50;border:1pt solid #111;padding:3pt}.summary td{background:#ffff00;border:.6pt solid #111;padding:2pt 4pt}.summary td:first-child{text-align:center;color:#ce0000;min-width:24pt}.summary td:last-child{font-weight:bold}.temporary{font-size:7.5pt;margin:5pt 0;overflow-wrap:anywhere}footer{font-size:6.5pt;color:#444;line-height:1.4;border-top:.5pt solid #aaa;padding-top:5pt;margin-top:7pt;overflow-wrap:anywhere}
  </style></head><body>${shifts}</body></html>`;
}

export async function generateShiftViewPdf(
  roster: ShiftRoster,
  binding: Fetcher,
): Promise<Uint8Array> {
  const browser = await puppeteer.launch(
    binding as unknown as Parameters<typeof puppeteer.launch>[0],
  );
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setContent(renderShiftViewHtml(roster), { waitUntil: 'load', timeout: 30_000 });
    const bytes = await page.pdf({
      format: 'Tabloid',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0.25in', right: '0.25in', bottom: '0.25in', left: '0.25in' },
    });
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } finally {
    await browser.close();
  }
}
