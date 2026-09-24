import writeXlsxFile, { type SheetData } from 'write-excel-file/universal';

export interface EligibilityExportDecision {
  member: { employeeId: string; firstName: string; lastName: string; rank: string };
  result: {
    points: number;
    reasons: { label: string; satisfied: boolean }[];
  };
  priority: number | null;
  orderingComponents: Record<string, number>;
  dataBlockers: string[];
}

export interface EligibilityExportList {
  positionId: string;
  ruleBookVersion: string;
  asOf: string;
  eligible: EligibilityExportDecision[];
  excluded: EligibilityExportDecision[];
  dataBlocked: EligibilityExportDecision[];
}

function rowsForList(list: EligibilityExportList): SheetData {
  const metadata: SheetData = [
    ['MBFD 2026 Bid eligibility list'],
    ['Position', list.positionId],
    ['Rule book', list.ruleBookVersion],
    ['As of', list.asOf],
    [],
    [
      'Status',
      'Priority',
      'Employee ID',
      'Last name',
      'First name',
      'Rank',
      'Points',
      'Requirements / blockers',
      'Ordering components',
    ],
  ];
  const decisionRow = (status: string, decision: EligibilityExportDecision) => [
    status,
    decision.priority ?? '',
    decision.member.employeeId,
    decision.member.lastName,
    decision.member.firstName,
    decision.member.rank,
    decision.result.points,
    [
      ...decision.result.reasons.map(
        (reason) => `${reason.satisfied ? 'PASS' : 'FAIL'}: ${reason.label}`,
      ),
      ...decision.dataBlockers.map((blocker) => `BLOCKED: ${blocker}`),
    ].join(' | '),
    Object.entries(decision.orderingComponents)
      .map(([key, value]) => `${key}=${value}`)
      .join('; '),
  ];
  return [
    ...metadata,
    ...list.eligible.map((decision) => decisionRow('ELIGIBLE', decision)),
    ...list.excluded.map((decision) => decisionRow('EXCLUDED', decision)),
    ...list.dataBlocked.map((decision) => decisionRow('DATA BLOCKED', decision)),
  ];
}

export async function generateEligibilityWorkbook(lists: readonly EligibilityExportList[]) {
  if (lists.length === 0) throw new Error('ELIGIBILITY_EXPORT_EMPTY');
  const sheets = lists.map((list) => ({
    sheet: list.positionId,
    data: rowsForList(list),
    stickyRowsCount: 7,
    columns: [
      { width: 16 },
      { width: 10 },
      { width: 14 },
      { width: 22 },
      { width: 22 },
      { width: 10 },
      { width: 10 },
      { width: 80 },
      { width: 52 },
    ],
  }));
  return (await writeXlsxFile(sheets)).toBlob();
}

function ascii(value: string) {
  return value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?');
}

function pdfEscape(value: string) {
  return ascii(value).replace(/([\\()])/g, '\\$1');
}

function wrap(value: string, width = 108) {
  const words = ascii(value).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (`${line} ${word}`.trim().length > width && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

export function generateEligibilityPdf(lists: readonly EligibilityExportList[]): Uint8Array {
  if (lists.length === 0) throw new Error('ELIGIBILITY_EXPORT_EMPTY');
  const allLines: string[] = [];
  for (const list of lists) {
    allLines.push(
      `MBFD 2026 Bid Eligibility - Position ${list.positionId}`,
      `Rule book ${list.ruleBookVersion} | As of ${list.asOf}`,
      '',
    );
    const add = (status: string, decision: EligibilityExportDecision) => {
      const summary = `${status} | Priority ${decision.priority ?? '-'} | ${decision.member.employeeId} | ${decision.member.lastName}, ${decision.member.firstName} | ${decision.member.rank} | Points ${decision.result.points}`;
      allLines.push(...wrap(summary));
      for (const reason of decision.result.reasons)
        allLines.push(...wrap(`  ${reason.satisfied ? 'PASS' : 'FAIL'} - ${reason.label}`));
      for (const blocker of decision.dataBlockers) allLines.push(...wrap(`  BLOCKED - ${blocker}`));
    };
    for (const decision of list.eligible) add('ELIGIBLE', decision);
    for (const decision of list.excluded) add('EXCLUDED', decision);
    for (const decision of list.dataBlocked) add('DATA BLOCKED', decision);
    allLines.push('', '---', '');
  }
  const chunks: string[][] = [];
  for (let offset = 0; offset < allLines.length; offset += 52)
    chunks.push(allLines.slice(offset, offset + 52));
  const objectCount = 3 + chunks.length * 2;
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = chunks.map((_, index) => 4 + index * 2);
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  );
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const [index, lines] of chunks.entries()) {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const commands = [
      'BT',
      '/F1 9 Tf',
      '40 760 Td',
      ...lines.flatMap((line, lineIndex) => [
        ...(lineIndex === 0 ? [] : ['0 -13 Td']),
        `(${pdfEscape(line)}) Tj`,
      ]),
      'ET',
    ].join('\n');
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(
      contentId,
      `<< /Length ${new TextEncoder().encode(commands).length} >>\nstream\n${commands}\nendstream`,
    );
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id <= objectCount; id++) {
    offsets[id] = new TextEncoder().encode(pdf).length;
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id++)
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
