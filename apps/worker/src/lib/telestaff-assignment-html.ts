import { type DefaultTreeAdapterTypes, parse } from 'parse5';

/**
 * A versioned, pure adapter for the TeleStaff `(EX) Export Assignments` HTML
 * report. It deliberately has no database, network, or portal dependency.
 *
 * Raw source names and Emp IDs returned here are ephemeral matching evidence:
 * an ingestion boundary must HMAC an Emp ID before persistence and must never
 * store this HTML or a raw source identity in D1.
 */
export const TELSTAFF_ASSIGNMENTS_HTML_SOURCE_FORMAT = 'TELSTAFF_ASSIGNMENTS_HTML_V1' as const;
export const TELSTAFF_ASSIGNMENTS_HTML_PARSER_VERSION = 'telestaff-assignments-html@1' as const;

export type TeleStaffAssignmentsHtmlErrorCode =
  | 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT'
  | 'DUPLICATE_SOURCE_ROW_IDENTITY'
  | 'DUPLICATE_SOURCE_ROW_FINGERPRINT';

export interface ParsedTeleStaffAssignmentSourceRow {
  /** Table-local source-row ordinal; not a canonical position identifier. */
  sourceRowNumber: number;
  /** Ephemeral corroboration only. Never persist a raw name. */
  sourceName: string | null;
  /** Opaque source text. Preserve leading zeros; HMAC before persistence. */
  employeeId: string | null;
  shift: string | null;
  division: string | null;
  station: string | null;
  unit: string | null;
  position: string | null;
  /** Source-system observation, deliberately distinct from Bid A-Day. */
  sourceARDay: string | null;
  /**
   * Plain duplicate-detection material, intentionally transient. The staging
   * boundary must derive a keyed opaque row fingerprint before any persistence.
   */
  transientDuplicateFingerprint: string;
  /** Canonical structured source evidence; no MBFD slot is inferred. */
  normalizedTopology: string;
  topologyCompleteness: 'complete' | 'incomplete';
}

export interface ParsedTeleStaffAssignmentsHtml {
  ok: true;
  sourceSystem: 'telestaff';
  sourceFormat: typeof TELSTAFF_ASSIGNMENTS_HTML_SOURCE_FORMAT;
  parserVersion: typeof TELSTAFF_ASSIGNMENTS_HTML_PARSER_VERSION;
  /** SHA-256 of the received HTML bytes. The raw artifact is not persisted. */
  sourceHash: string;
  /** The report contained no supported effective-date field. */
  sourceSnapshotAsOf: null;
  inputRowCount: number;
  normalizedDataRowCount: number;
  uniqueEmployeeCount: number;
  /** All report rows following the recognized semantic header. */
  reportRowCount: number;
  structuralRowCount: number;
  rows: readonly ParsedTeleStaffAssignmentSourceRow[];
}

export interface RejectedTeleStaffAssignmentsHtml {
  ok: false;
  code: TeleStaffAssignmentsHtmlErrorCode;
}

export type TeleStaffAssignmentsHtmlParseResult =
  | ParsedTeleStaffAssignmentsHtml
  | RejectedTeleStaffAssignmentsHtml;

type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlNode = DefaultTreeAdapterTypes.Node;

type SemanticColumn =
  | 'sourceName'
  | 'employeeId'
  | 'shift'
  | 'division'
  | 'station'
  | 'unit'
  | 'position'
  | 'sourceARDay';

const REQUIRED_COLUMNS: readonly SemanticColumn[] = [
  'sourceName',
  'employeeId',
  'shift',
  'division',
  'station',
  'unit',
  'position',
  'sourceARDay',
];

const HEADER_TO_COLUMN: Readonly<Record<string, SemanticColumn>> = {
  name: 'sourceName',
  'emp id': 'employeeId',
  shift: 'shift',
  division: 'division',
  station: 'station',
  unit: 'unit',
  position: 'position',
  'a r day': 'sourceARDay',
};

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

function isTextNode(node: HtmlNode): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function childrenOf(node: HtmlNode): readonly HtmlNode[] {
  return 'childNodes' in node ? node.childNodes : [];
}

function attributesOf(element: HtmlElement): ReadonlyMap<string, string> {
  return new Map(element.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
}

function isHiddenElement(element: HtmlElement, inheritedHidden: boolean): boolean {
  if (inheritedHidden) return true;
  const attributes = attributesOf(element);
  // `aria-hidden` changes accessibility exposure, not necessarily visual source
  // content. Treating it as display:none would erase a visible report value.
  if (attributes.has('hidden')) return true;
  const style = attributes.get('style')?.replaceAll(/\s+/g, '').toLowerCase() ?? '';
  return style.includes('display:none') || style.includes('visibility:hidden');
}

/** A hidden report/table/row is not a semantic source candidate. */
function hasHiddenSelfOrAncestor(node: HtmlNode): boolean {
  let current: HtmlNode | null = node;
  while (current !== null) {
    if (isElement(current) && isHiddenElement(current, false)) return true;
    current = 'parentNode' in current ? current.parentNode : null;
  }
  return false;
}

function sourceText(node: HtmlNode, inheritedHidden = false): string {
  if (isTextNode(node)) return inheritedHidden ? '' : node.value;
  if (!isElement(node)) return '';
  if (['script', 'style', 'template'].includes(node.tagName.toLowerCase())) return '';
  const hidden = isHiddenElement(node, inheritedHidden);
  return childrenOf(node)
    .map((child) => sourceText(child, hidden))
    .join('');
}

/** Collapse normal, non-breaking, and placeholder whitespace to semantic null. */
function normalizeSourceText(value: string): string | null {
  const normalized = value.replace(/[\s\u00a0]+/g, ' ').trim();
  return normalized === '' ? null : normalized;
}

function normalizedHeader(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === '' ? null : normalized;
}

function descendantsByTag(node: HtmlNode, tagName: string): HtmlElement[] {
  const elements: HtmlElement[] = [];
  for (const child of childrenOf(node)) {
    if (isElement(child) && child.tagName.toLowerCase() === tagName) elements.push(child);
    elements.push(...descendantsByTag(child, tagName));
  }
  return elements;
}

function directCells(row: HtmlElement): HtmlElement[] {
  return childrenOf(row).filter(
    (child): child is HtmlElement =>
      isElement(child) &&
      (child.tagName.toLowerCase() === 'th' || child.tagName.toLowerCase() === 'td'),
  );
}

function rowBelongsToTable(row: HtmlElement, table: HtmlElement): boolean {
  let parent = row.parentNode;
  while (parent !== null) {
    if (parent === table) return true;
    if (isElement(parent) && parent.tagName.toLowerCase() === 'table') return false;
    parent = 'parentNode' in parent ? parent.parentNode : null;
  }
  return false;
}

interface HeaderMatch {
  row: HtmlElement;
  columnIndexes: Readonly<Record<SemanticColumn, number>>;
}

function semanticHeaderMatch(row: HtmlElement): HeaderMatch | null {
  if (hasHiddenSelfOrAncestor(row)) return null;
  const indexes = {} as Record<SemanticColumn, number>;
  for (const [index, cell] of directCells(row).entries()) {
    const column = HEADER_TO_COLUMN[normalizedHeader(normalizeSourceText(sourceText(cell))) ?? ''];
    if (column === undefined) continue;
    if (indexes[column] !== undefined) return null;
    indexes[column] = index;
  }
  if (REQUIRED_COLUMNS.some((column) => indexes[column] === undefined)) return null;
  return { row, columnIndexes: indexes };
}

function readRow(
  row: HtmlElement,
  sourceRowNumber: number,
  columnIndexes: Readonly<Record<SemanticColumn, number>>,
): Omit<
  ParsedTeleStaffAssignmentSourceRow,
  'transientDuplicateFingerprint' | 'normalizedTopology' | 'topologyCompleteness'
> {
  const cells = directCells(row);
  const valueAt = (column: SemanticColumn): string | null => {
    const cell = cells[columnIndexes[column]];
    return cell === undefined ? null : normalizeSourceText(sourceText(cell));
  };
  return {
    sourceRowNumber,
    sourceName: valueAt('sourceName'),
    employeeId: valueAt('employeeId'),
    shift: valueAt('shift'),
    division: valueAt('division'),
    station: valueAt('station'),
    unit: valueAt('unit'),
    position: valueAt('position'),
    sourceARDay: valueAt('sourceARDay'),
  };
}

function isStructuralBlank(
  row: Omit<
    ParsedTeleStaffAssignmentSourceRow,
    'transientDuplicateFingerprint' | 'normalizedTopology' | 'topologyCompleteness'
  >,
): boolean {
  return REQUIRED_COLUMNS.every((column) => row[column] === null);
}

function topologyFor(
  row: Omit<
    ParsedTeleStaffAssignmentSourceRow,
    'transientDuplicateFingerprint' | 'normalizedTopology' | 'topologyCompleteness'
  >,
): { normalizedTopology: string; topologyCompleteness: 'complete' | 'incomplete' } {
  const topology = {
    v: 1,
    shift: row.shift,
    division: row.division,
    station: row.station,
    unit: row.unit,
    position: row.position,
  };
  return {
    normalizedTopology: JSON.stringify(topology),
    topologyCompleteness:
      row.shift === null ||
      row.division === null ||
      row.station === null ||
      row.unit === null ||
      row.position === null
        ? 'incomplete'
        : 'complete',
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalDuplicateFingerprintInput(
  row: Omit<
    ParsedTeleStaffAssignmentSourceRow,
    'transientDuplicateFingerprint' | 'normalizedTopology' | 'topologyCompleteness'
  >,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      sourceName: row.sourceName,
      employeeId: row.employeeId,
      shift: row.shift,
      division: row.division,
      station: row.station,
      unit: row.unit,
      position: row.position,
      sourceARDay: row.sourceARDay,
    }),
  );
}

function decodeSource(source: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return null;
  }
}

/**
 * Parses only one table whose visible semantic headers exactly contain the
 * required source fields. Generated ids, styles, layout, and row attributes
 * play no part in selection.
 */
export async function parseTeleStaffAssignmentsHtml(
  source: Uint8Array,
): Promise<TeleStaffAssignmentsHtmlParseResult> {
  const html = decodeSource(source);
  if (html === null) {
    return { ok: false, code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT' };
  }
  const document = parse(html);
  const candidates = descendantsByTag(document, 'table')
    .filter((table) => !hasHiddenSelfOrAncestor(table))
    .map((table) => {
      const headers = descendantsByTag(table, 'tr')
        .filter((row) => rowBelongsToTable(row, table) && !hasHiddenSelfOrAncestor(row))
        .map(semanticHeaderMatch)
        .filter((match): match is HeaderMatch => match !== null);
      return headers.length === 1 ? { table, header: headers[0] } : null;
    })
    .filter(
      (candidate): candidate is { table: HtmlElement; header: HeaderMatch } => candidate !== null,
    );

  if (candidates.length !== 1) {
    return { ok: false, code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT' };
  }

  const candidate = candidates[0];
  if (candidate === undefined) {
    return { ok: false, code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT' };
  }
  const { table, header } = candidate;
  const tableRows = descendantsByTag(table, 'tr').filter(
    (row) => rowBelongsToTable(row, table) && !hasHiddenSelfOrAncestor(row),
  );
  const headerIndex = tableRows.indexOf(header.row);
  // A matching header must be a visible direct row of its selected table.
  // This defensive check preserves the fail-closed boundary if parse5's tree
  // construction ever changes for malformed table markup.
  if (headerIndex < 0) {
    return { ok: false, code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT' };
  }
  const sourceRows = tableRows.slice(headerIndex + 1);
  const records: ParsedTeleStaffAssignmentSourceRow[] = [];
  let structuralRowCount = 0;
  const employeeIds = new Set<string>();
  const fingerprints = new Set<string>();

  for (const [index, sourceRow] of sourceRows.entries()) {
    const row = readRow(sourceRow, index + 1, header.columnIndexes);
    if (isStructuralBlank(row)) {
      structuralRowCount += 1;
      continue;
    }
    if (row.employeeId !== null) {
      if (employeeIds.has(row.employeeId))
        return { ok: false, code: 'DUPLICATE_SOURCE_ROW_IDENTITY' };
      employeeIds.add(row.employeeId);
    }
    const fingerprint = await sha256Hex(canonicalDuplicateFingerprintInput(row));
    if (fingerprints.has(fingerprint)) {
      return { ok: false, code: 'DUPLICATE_SOURCE_ROW_FINGERPRINT' };
    }
    fingerprints.add(fingerprint);
    records.push({ ...row, transientDuplicateFingerprint: fingerprint, ...topologyFor(row) });
  }

  return {
    ok: true,
    sourceSystem: 'telestaff',
    sourceFormat: TELSTAFF_ASSIGNMENTS_HTML_SOURCE_FORMAT,
    parserVersion: TELSTAFF_ASSIGNMENTS_HTML_PARSER_VERSION,
    sourceHash: await sha256Hex(source),
    sourceSnapshotAsOf: null,
    inputRowCount: records.length,
    normalizedDataRowCount: records.length,
    uniqueEmployeeCount: employeeIds.size,
    reportRowCount: sourceRows.length,
    structuralRowCount,
    rows: records,
  };
}
