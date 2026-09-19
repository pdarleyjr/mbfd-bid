import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_GUIDE_COVERAGE,
  GUIDE_SECTIONS,
  filterGuideSections,
} from '../../app/admin/guide/guide-content';
import { ADMIN_NAV_LINKS } from '../../components/admin/AdminShell';

describe('Administrator Guide content contract', () => {
  it('covers every current top-level Admin navigation area', () => {
    const undocumented = ADMIN_NAV_LINKS.filter((link) => link.href !== '/admin/guide').filter(
      (link) => !ADMIN_GUIDE_COVERAGE[link.href],
    );

    expect(undocumented).toEqual([]);
  });

  it('finds the operational phrases administrators are likely to search for', () => {
    expect(filterGuideSections('TeleStaff').map((section) => section.id)).toContain('telestaff');
    expect(filterGuideSections('retire member').map((section) => section.id)).toContain(
      'personnel',
    );
    expect(filterGuideSections('change bid order').map((section) => section.id)).toContain(
      'annual-policy',
    );
    expect(filterGuideSections('specialty').map((section) => section.id)).toContain(
      'specialty-adjudication',
    );
    expect(filterGuideSections('hold presentation').map((section) => section.id)).toContain(
      'live-presentation',
    );
    expect(filterGuideSections('CSV').map((section) => section.id)).toContain('current-rosters');
  });

  it('documents the production effect and audit history of annual TeleStaff baseline replacement', () => {
    const teleStaff = GUIDE_SECTIONS.find((section) => section.id === 'telestaff');

    expect(teleStaff?.controls).toContain('Designate selected-year staffing baseline');
    expect(teleStaff?.steps.join(' ')).toContain('supersede the prior acceptance receipt');
    expect(teleStaff?.important).toContain('production D1');
    expect(teleStaff?.important).toContain('does not start a Bid session');
    expect(teleStaff?.important).toContain('does not write back to TeleStaff');
  });

  it('documents deterministic Decision Details without retaining the retired AI Assist workflow', () => {
    const advisory = GUIDE_SECTIONS.find((section) => section.id === 'bid-advisory');
    const text = `${advisory?.summary ?? ''} ${advisory?.important ?? ''}`;

    expect(advisory).toMatchObject({ route: '/admin/bid', routeLabel: 'Live Bid & Advisory' });
    expect(text).toContain('deterministic BID application rules');
    expect(text).toContain('authoritative results');
    expect(text).toContain('no AI or model generation delay');
    expect(text).toContain('do not make decisions');
    expect(text).toContain('change eligibility');
    expect(text).toContain('award positions');
    expect(text).not.toMatch(/AI Assist|Workers AI|\/admin\/ai-assist/i);
  });

  it('deep-links each Current Bid guide workflow to its selected workspace view', () => {
    expect(GUIDE_SECTIONS.find((section) => section.id === 'current-bid-blueprint')).toMatchObject({
      route: '/admin/current-bid?view=blueprint',
    });
    expect(GUIDE_SECTIONS.find((section) => section.id === 'current-bid-versions')).toMatchObject({
      route: '/admin/current-bid?view=versions',
    });
    expect(GUIDE_SECTIONS.find((section) => section.id === 'current-bid-mock')).toMatchObject({
      route: '/admin/current-bid?view=mock',
    });
    expect(
      GUIDE_SECTIONS.find((section) => section.id === 'current-bid-live-preflight'),
    ).toMatchObject({
      route: '/admin/current-bid?view=live',
    });
    expect(GUIDE_SECTIONS.find((section) => section.id === 'current-bid-results')).toMatchObject({
      route: '/admin/current-bid?view=results',
    });
  });

  it('explains automatic profile Save, explicit Live creation and separate Start', () => {
    const edit = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-edit');
    expect(edit?.steps.join(' ')).toContain('Save Bid checks and applies those profile changes');
    expect(edit?.steps.join(' ')).toContain('not a separate required approval step');
    const live = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-live-preflight');
    expect(live?.controls).toContain('Confirm Live session creation');
    expect(live?.steps.join(' ')).toContain('readiness check is read-only');
    expect(live?.steps.join(' ')).toContain('fresh readiness check and confirmation');
    expect(live?.important).toContain('Creation and Start are separate actions');
    expect(JSON.stringify(GUIDE_SECTIONS)).not.toContain(
      'Current Bid has no Live creation control',
    );
  });

  it('documents explicit policy scopes, fallback evidence and simultaneous award controls', () => {
    const rules = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-execution-rules');
    expect(rules?.steps.join(' ')).toContain('Department seniority and time in grade');
    expect(rules?.steps.join(' ')).toContain('slots in reservation order');
    expect(rules?.steps.join(' ')).toContain('force action does not waive qualification rules');
    const live = GUIDE_SECTIONS.find((section) => section.id === 'live-bid');
    expect(live?.steps.join(' ')).toContain('reason and required evidence');
    expect(live?.steps.join(' ')).toContain('Selection A-Day with the award');
    expect(filterGuideSections('station pool').map((section) => section.id)).toContain(
      'current-bid-execution-rules',
    );
  });

  it('separates selected-run reads and term facts from actions and consent', () => {
    const results = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-results');
    expect(results?.steps.join(' ')).toContain('choose a Bid run');
    expect(results?.important).toContain('Results and History are read-only');
    expect(results?.important).toContain('apply Department staffing changes');
    const tenure = GUIDE_SECTIONS.find((section) => section.id === 'tenure');
    expect(tenure?.controls).toContain('Record service and bid cycles');
    expect(tenure?.steps.join(' ')).toContain('including a verified zero');
    expect(tenure?.important).toContain('voluntary departure consent');
    expect(tenure?.important).toContain('removes incumbent protection');
  });

  it('routes reviewed-policy Mock runs through Start and the session operator console', () => {
    const mock = GUIDE_SECTIONS.find((section) => section.id === 'mock-bids');
    expect(mock?.route).toBe('/admin/rehearsal');
    expect(mock?.controls).toContain('Start session');
    expect(mock?.controls).toContain('Open session operator console');
    expect(mock?.steps.join(' ')).toContain(
      'select Start session, then Open session operator console',
    );
    expect(mock?.steps.join(' ')).toContain('Legacy Auto Bid and manual simulations reject');
    const creation = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-mock');
    expect(creation?.steps.join(' ')).toContain('select Start session');
    expect(creation?.steps.join(' ')).toContain('Open session operator console');
    expect(creation?.important).toContain('does not start it');
    expect(creation?.important).toContain('Legacy Auto Bid and manual simulations reject');
  });

  it('explains pending source procedures, approved rankings and both membership populations', () => {
    const edit = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-edit');
    expect(edit?.steps.join(' ')).toContain('Blank values remain unresolved');
    expect(edit?.steps.join(' ')).toContain('Use reviewed procedures in this draft');
    const rules = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-execution-rules');
    expect(rules?.steps.join(' ')).toContain('Rank Seniority supplies time-in-grade order');
    expect(rules?.steps.join(' ')).toContain(
      'Straight Seniority supplies department-service order',
    );
    expect(rules?.steps.join(' ')).toContain('Reviewed existing members or Wider qualified pool');
    expect(rules?.steps.join(' ')).toContain('must be resolved before Real activation');
    const evidence = GUIDE_SECTIONS.find((section) => section.id === 'bid-evidence');
    expect(evidence?.route).toBe('/admin/personnel/bid-evidence');
    expect(evidence?.controls).toContain('Save reviewed Bid ordinals');
    expect(evidence?.controls).toContain('Save reviewed tour evidence');
    expect(evidence?.steps.join(' ')).toContain('does not calculate or change hire dates');
    expect(evidence?.steps.join(' ')).toContain('unknown finding cannot satisfy a fallback rule');
    const scoring = GUIDE_SECTIONS.find((section) => section.id === 'rules-list');
    expect(scoring?.steps.join(' ')).toContain('counts each satisfied criterion once');
    expect(scoring?.steps.join(' ')).toContain(
      'criteria in their stated order before cumulative credit',
    );
    expect(scoring?.steps.join(' ')).toContain(
      'secondary-course credit to candidates without IAAI',
    );
  });

  it('separates result package reads from authorized external publication evidence', () => {
    const results = GUIDE_SECTIONS.find((section) => section.id === 'current-bid-results');
    expect(results?.controls).toContain('Generate final result package');
    expect(results?.steps.join(' ')).toContain('verified completed Live run');
    expect(results?.steps.join(' ')).toContain('does not send or publish it');
    expect(results?.steps.join(' ')).toContain('Email distribution and TargetSolutions bulletin');
    expect(results?.steps.join(' ')).toContain('Corrections add history');
    expect(results?.steps.join(' ')).toContain('not that this application delivered it');
    expect(results?.steps.join(' ')).toContain(
      'Mock runs offer a read-only Department transition rehearsal',
    );
  });

  it('uses an intentional category, a real route, and concise guide content for each section', () => {
    expect(GUIDE_SECTIONS.length).toBeGreaterThanOrEqual(27);

    for (const section of GUIDE_SECTIONS) {
      expect(section.category.length).toBeGreaterThan(0);
      expect(section.route).toMatch(/^\/admin(?:\/|$)/);
      const pathname = new URL(section.route, 'https://guide.invalid').pathname;
      expect(existsSync(new URL(`../../app${pathname}/page.tsx`, import.meta.url))).toBe(true);
      expect(section.summary.length).toBeGreaterThan(20);
      expect(section.steps.length).toBeGreaterThan(0);
    }
  });
});
