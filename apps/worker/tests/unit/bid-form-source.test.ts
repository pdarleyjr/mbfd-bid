import { describe, expect, it } from 'vitest';
import {
  BidFormArchiveSchema,
  type BidFormReceipt,
  type PublishedRankList,
  type SubmittedBidForm,
  bidFormArchiveHasIdentityConflict,
  bidFormArchiveHash,
  projectMemberBidForm,
} from '../../src/lib/bid-form-source.js';

const source = { name: 'Synthetic workbook.xlsx', sha256: 'a'.repeat(64) };
const form = (employeeId = 'member-1', sourceName = 'Member,First'): SubmittedBidForm => ({
  employeeId,
  sourceName,
  sourceRank: 'Firefighter',
  attendingTeams: 'Yes',
  phone1: 'synthetic contact',
  phone2: null,
  positionPreferences: [{ order: 1, shift: 'A Shift', unit: '<b>Station 2 Air Tech</b>' }],
  aDayPreferences: [{ order: 1, sourceLabel: 'A Group 3', shift: 'A', group: 'G3' }],
  sourceLocation: { sheet: 'Forms', row: 3 },
});
const receipt = (forms = [form()]): BidFormReceipt => ({
  archive: { v: 1, year: 2026, source, forms, notSubmitted: [], unlinkedNotSubmitted: [] },
  sha256: 'b'.repeat(64),
  publishedAt: '2026-10-04T16:00:00.000Z',
  publishedBy: 'synthetic-operator',
});
const member = { memberId: 1, employeeId: 'member-1', firstName: 'First', lastName: 'Member' };
const rankList = (listId = 'STATION_TWO_LIEUTENANT'): PublishedRankList => ({
  listId,
  title: 'Station 2 Lieutenant',
  source: {
    name: 'Synthetic final rank list.pdf',
    sha256: 'e'.repeat(64),
    pages: 1,
    generatedAt: [],
  },
  columns: ['drone', 'operations', 'total', 'preferences'],
  columnLabels: {
    drone: 'Drone',
    operations: 'Operations',
    total: 'Total',
    preferences: 'Preferences',
  },
  rows: [
    {
      employeeId: member.employeeId,
      sourceMemberName: 'Member First',
      sourceRank: 'Lieutenant',
      bidOrder: null,
      values: { drone: 1, operations: 6, total: 12, preferences: 'First choice' },
      provenance: [{ page: 1, textLine: 3, bbox: [10, 20, 200, 30] }],
    },
  ],
});

describe('documentary member bid forms', () => {
  it('preserves preference order, source labels and provenance without generating seat IDs or commands', () => {
    const projection = projectMemberBidForm(receipt(), member, 2026, 'mock-session');
    expect(projection.status).toBe('SUBMITTED');
    expect(projection.form).toEqual(form());
    expect(projection.source).toEqual(source);
    expect(projection.sessionId).toBe('mock-session');
    expect(projection.form).not.toHaveProperty('positionIds');
  });
  it('distinguishes missing source, absent source member and explicit non-submission', () => {
    expect(projectMemberBidForm(null, member, 2026, null).status).toBe('SOURCE_UNAVAILABLE');
    expect(projectMemberBidForm(receipt([]), member, 2026, null).status).toBe('NOT_LISTED');
    const saved = receipt([]);
    saved.archive.notSubmitted = [
      {
        employeeId: member.employeeId,
        sourceName: 'First Member',
        sourceLocation: { sheet: 'DID NOT SUBMIT', row: 1 },
      },
    ];
    expect(projectMemberBidForm(saved, member, 2026, null)).toMatchObject({
      status: 'NOT_SUBMITTED',
      form: null,
      sourceLocation: { row: 1 },
    });
  });
  it('never links a form to another member merely because the source ID matches', () => {
    expect(
      projectMemberBidForm(receipt([form('member-1', 'Other,Person')]), member, 2026, null).status,
    ).toBe('NOT_LISTED');
    expect(projectMemberBidForm(receipt([form('incorrect-id')]), member, 2026, null).status).toBe(
      'IDENTITY_REVIEW',
    );
  });
  it('applies only explicit authoritative correction and retains the original submitted ID', () => {
    const submitted = form('incorrect-id');
    submitted.identityResolution = {
      employeeId: 'member-1',
      method: 'AUTHORITATIVE_DIRECTORY_CORRECTION',
      source: { name: 'Synthetic directory.csv', sha256: 'c'.repeat(64) },
      sourceLocation: 'CSV row 2',
      discrepancy: 'Original source ID differs from the exact authoritative identity.',
    };
    const linked = projectMemberBidForm(receipt([submitted]), member, 2026, null);
    expect(linked.status).toBe('SUBMITTED');
    expect(linked.form?.employeeId).toBe('incorrect-id');
    expect(linked.form?.identityResolution?.employeeId).toBe('member-1');
    expect(
      projectMemberBidForm(
        receipt([submitted]),
        { ...member, employeeId: 'incorrect-id', firstName: 'Another' },
        2026,
        null,
      ).status,
    ).toBe('NOT_LISTED');
  });
  it('keeps the valid duplicate-ID owner form and the explicit non-submitted member separate after corrections', () => {
    const first = form('valid-owner');
    const second = form('valid-owner', 'Member,Second');
    second.identityResolution = {
      employeeId: 'second-member',
      method: 'AUTHORITATIVE_DIRECTORY_CORRECTION',
      source,
      sourceLocation: 'CSV row 2',
      discrepancy: 'Corrected documentary link only.',
    };
    const third = form('not-submitted-member', 'Member,Third');
    third.identityResolution = { ...second.identityResolution, employeeId: 'third-member' };
    const saved = receipt([first, second, third]);
    saved.archive.notSubmitted = [
      {
        employeeId: 'not-submitted-member',
        sourceName: 'Fourth Member',
        sourceLocation: { sheet: 'DID NOT SUBMIT', row: 1 },
      },
    ];
    expect(bidFormArchiveHasIdentityConflict(saved.archive)).toBe(false);
    expect(
      projectMemberBidForm(saved, { ...member, employeeId: 'valid-owner' }, 2026, null).form
        ?.sourceName,
    ).toBe('Member,First');
    expect(
      projectMemberBidForm(
        saved,
        { ...member, employeeId: 'second-member', firstName: 'Second' },
        2026,
        null,
      ).form?.sourceName,
    ).toBe('Member,Second');
    expect(
      projectMemberBidForm(
        saved,
        { ...member, employeeId: 'not-submitted-member', firstName: 'Fourth' },
        2026,
        null,
      ).status,
    ).toBe('NOT_SUBMITTED');
  });
  it('exposes ambiguity instead of selecting the first form', () => {
    expect(projectMemberBidForm(receipt([form(), form()]), member, 2026, null).status).toBe(
      'IDENTITY_REVIEW',
    );
    expect(bidFormArchiveHasIdentityConflict(receipt([form(), form()]).archive)).toBe(true);
  });
  it('preserves Days weekday preferences and their source labels separately from combat groups', () => {
    const submitted = form();
    submitted.aDayPreferences = [
      { order: 1, sourceLabel: 'Days - Friday', shift: 'D', group: null },
    ];
    const parsed = BidFormArchiveSchema.parse(receipt([submitted]).archive);
    expect(parsed.forms[0]?.aDayPreferences[0]).toEqual(submitted.aDayPreferences[0]);
  });
  it('shows one exact-ID/name matched Air Tech source reference without converting points to qualifications', () => {
    const saved = receipt([]);
    saved.archive.airTechReferences = [
      {
        employeeId: member.employeeId,
        sourceMemberName: 'Member First',
        bidOrder: 160,
        driverEngineerPoints: 2,
        airTechPoints: 0,
        carSeatPoints: 0,
        dronePoints: 0,
        operationsPoints: 0,
        technicianPoints: 0,
        totalPoints: 2,
        rankSeniority: 74.5,
        generatedAt: '10/2/2026 @ 2:19 PM',
        sourceName: 'Synthetic ranking.pdf',
        sourceSha256: 'd'.repeat(64),
      },
    ];
    const projected = projectMemberBidForm(saved, member, 2026, 'real-session');
    expect(projected.status).toBe('NOT_LISTED');
    expect(projected.airTechReference).toEqual(saved.archive.airTechReferences[0]);
    expect(projected).not.toHaveProperty('credentialNames');
    expect(projected).not.toHaveProperty('eligible');
    expect(
      projectMemberBidForm(saved, { ...member, firstName: 'Other' }, 2026, null).airTechReference,
    ).toBeNull();
  });
  it('hashes normalized source content and detects preference or contact changes', async () => {
    const archive = BidFormArchiveSchema.parse(receipt().archive);
    const before = await bidFormArchiveHash(archive);
    expect(before).toMatch(/^[a-f0-9]{64}$/);
    const submitted = archive.forms[0];
    if (!submitted) throw new Error('Synthetic form missing');
    submitted.phone1 = 'changed synthetic contact';
    expect(await bidFormArchiveHash(archive)).not.toBe(before);
  });
  it('preserves old archive bytes and hash when generic lists are absent', async () => {
    const old = receipt().archive;
    const parsed = BidFormArchiveSchema.parse(old);
    expect(parsed).not.toHaveProperty('rankLists');
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(old));
    expect(await bidFormArchiveHash(parsed)).toBe(await bidFormArchiveHash(old));
    expect(projectMemberBidForm(receipt(), member, 2026, null).rankReferences).toEqual([]);
  });
  it('projects multiple exact identity references without making credentials or correcting literal source cells', () => {
    const saved = receipt();
    saved.archive.rankLists = [rankList(), rankList('FIRE_INVESTIGATOR')];
    const parsed = BidFormArchiveSchema.parse(saved.archive);
    expect(bidFormArchiveHasIdentityConflict(parsed)).toBe(false);
    const projected = projectMemberBidForm(saved, member, 2026, 'real-session');
    expect(projected.rankReferences).toHaveLength(2);
    expect(projected.rankReferences?.[0]?.row).toMatchObject({
      bidOrder: null,
      values: { total: 12 },
    });
    expect(projected.rankReferences?.[0]?.source.generatedAt).toEqual([]);
    expect(projected.rankReferences?.[0]).not.toHaveProperty('rows');
    expect(projected).not.toHaveProperty('credentialNames');
    expect(projected).not.toHaveProperty('eligible');
    expect(
      projectMemberBidForm(saved, { ...member, employeeId: 'other' }, 2026, null).rankReferences,
    ).toEqual([]);
    expect(
      projectMemberBidForm(saved, { ...member, firstName: 'Other' }, 2026, null).rankReferences,
    ).toEqual([]);
  });
  it.each([
    'duplicate-list',
    'duplicate-member',
    'missing-column',
    'extra-column',
    'wrong-label',
    'outside-page',
    'reversed-bounds',
    'unknown-key',
    'nonfinite',
  ] as const)('rejects invalid published list evidence: %s', (kind) => {
    const saved = receipt().archive;
    const list = rankList();
    saved.rankLists = [list];
    const row = list.rows[0];
    if (!row) throw new Error('Missing synthetic rank row');
    const location = row.provenance[0];
    if (!location) throw new Error('Missing synthetic source location');
    if (kind === 'duplicate-list') saved.rankLists.push(rankList());
    if (kind === 'duplicate-member') list.rows.push({ ...row });
    if (kind === 'missing-column')
      row.values = Object.fromEntries(
        Object.entries(row.values).filter(([key]) => key !== 'total'),
      );
    if (kind === 'extra-column') row.values.unknown = 1;
    if (kind === 'wrong-label') list.columnLabels.unknown = 'Unknown';
    if (kind === 'outside-page') location.page = 2;
    if (kind === 'reversed-bounds') location.bbox = [200, 20, 10, 30];
    if (kind === 'unknown-key') Object.assign(row, { eligible: true });
    if (kind === 'nonfinite') row.values.total = Number.POSITIVE_INFINITY;
    expect(BidFormArchiveSchema.safeParse(saved).success).toBe(false);
  });
  it('does not pick the first duplicate list row in projection', () => {
    const saved = receipt();
    const list = rankList();
    const row = list.rows[0];
    if (!row) throw new Error('Missing synthetic rank row');
    list.rows.push({ ...row });
    saved.archive.rankLists = [list];
    expect(bidFormArchiveHasIdentityConflict(saved.archive)).toBe(true);
    expect(projectMemberBidForm(saved, member, 2026, null).rankReferences).toEqual([]);
  });
});
