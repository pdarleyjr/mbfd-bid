import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  BidDefinitionContentSchema,
  type BidSessionPolicySnapshot,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  LiveBidCommandSchema,
} from '@mbfd/shared';
import { expect, it, vi } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { loadFrozenSessionBidPolicy } from '../../src/lib/bid-policy.js';
import { evaluateFrozenSimultaneousADays } from '../../src/lib/frozen-a-day.js';
import { signJwt } from '../../src/lib/jwt.js';
import { setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

// Private source input is opt-in. No source document or real personnel facts
// enter the repository. This is an actual canonical command integration run,
// with an explicitly synthetic activation layer and loopback DO transport.
const sourcePath = process.env.MBFD_FINAL_MOCK_SOURCE;
it.skipIf(!sourcePath)(
  'runs the entire source-derived final definition through a synthetic canonical Mock',
  async () => {
    if (!sourcePath) throw new Error('Source artifact required');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-02T15:00:00Z'));
    const h = await setupTestD1();
    try {
      h.sqlite.pragma('foreign_keys = ON');
      const raw = readFileSync(sourcePath, 'utf8');
      const sourceSha256 = createHash('sha256').update(raw).digest('hex');
      expect(sourceSha256).toBe(process.env.MBFD_FINAL_MOCK_SOURCE_SHA256);
      const content = BidDefinitionContentSchema.parse(JSON.parse(raw));
      expect(content.positions).toHaveLength(228);
      const pending = content.pendingPolicy;
      if (!pending?.executionPolicy.annualOperations)
        throw new Error('Source pending annual policy required');
      const year = content.bidYear;
      const active = content.positions.filter(
        (p) =>
          !p.isExcludedFromCount &&
          content.participation.find((row) => row.positionId === p.id)?.bidParticipation ===
            'BIDDABLE',
      );
      expect(active).toHaveLength(223);
      const memberSeats = new Map(active.map((position, index) => [92000 + index, position]));
      const actor = 92000;
      const credentialIds = new Map<string, number>();
      h.sqlite
        .prepare(
          "INSERT INTO position_templates(version,effective_year) VALUES ('synthetic-source',?)",
        )
        .run(year);
      h.sqlite
        .prepare(
          "INSERT INTO rule_books(version,effective_year,status,revision) VALUES ('synthetic-source',?,'draft',0)",
        )
        .run(year);
      h.sqlite
        .prepare(
          "INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json) VALUES (?,'configuring','synthetic-source','synthetic-source',1,?)",
        )
        .run(
          year,
          JSON.stringify({
            v: 2,
            expectedDurationDays: 2,
            turnTimerSeconds: 180,
            credentialEvaluationOn: '2027-01-01',
            personnelEvaluationOn: '2027-01-01',
          }),
        );
      for (const position of content.positions) {
        h.sqlite
          .prepare(
            "INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name) VALUES (?,'synthetic-source',?,?,?,?,?,?)",
          )
          .run(
            position.id,
            position.shift,
            position.station,
            position.division,
            position.unit,
            position.rankRequired,
            position.positionName,
          );
        h.sqlite
          .prepare(
            "INSERT INTO staffing_positions(id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'2020-01-01','approved',1,1)",
          )
          .run(
            `synthetic-${position.id}`,
            `synthetic/${position.id}`,
            position.shift,
            position.station,
            position.unit,
            position.positionName,
            position.rankRequired,
          );
        const participation = content.participation.find((p) => p.positionId === position.id);
        if (participation)
          h.sqlite
            .prepare(
              "INSERT INTO rule_book_position_participation(rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at) VALUES ('synthetic-source',?,'synthetic-source',?,?,1)",
            )
            .run(position.id, participation.bidParticipation, participation.authoritativeSourceRef);
        const rule = content.rules.find((r) => r.positionId === position.id);
        if (rule && participation?.bidParticipation === 'BIDDABLE')
          h.sqlite
            .prepare(
              "INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) VALUES ('synthetic-source',?,'synthetic-source',?,?,?)",
            )
            .run(
              position.id,
              rule.requiredCriteriaJson,
              rule.pointsPreferenceJson,
              rule.tieBreakChainJson,
            );
        h.sqlite
          .prepare(
            "INSERT INTO staffing_tenure_evidence(id,staffing_position_id,revision,effective_on,status,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES (?,?,1,'2020-01-01','UNPROTECTED','Synthetic vacant slot','synthetic','Synthetic fixture input',?,'{}',1)",
          )
          .run(`tenure-${position.id}`, `synthetic-${position.id}`, `tenure-${position.id}`);
      }
      for (const [id, seat] of memberSeats) {
        h.sqlite
          .prepare(
            "INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at) VALUES (?,?,'Synthetic','Source Rehearsal',?,?,?, ?,0,'active','2020-01-01',1,1)",
          )
          .run(
            id,
            `SYNTHETIC-FINAL-${id}`,
            seat.rankRequired,
            seat.rankRequired === 'FF' ? 'FF' : 'OFC',
            id - 91999,
            id - 91999,
          );
        const rule = content.rules.find((r) => r.positionId === seat.id);
        if (!rule) throw new Error(`Missing source rule ${seat.id}`);
        const required: {
          credentials: string[];
          service?: { serviceCode: string; minimumMonths: number }[];
        } = JSON.parse(rule.requiredCriteriaJson);
        for (const name of [
          ...required.credentials,
          ...(seat.id === 'B303' ? ['Certified Fire Investigator (IAAI-CFI)'] : []),
        ]) {
          let credential = credentialIds.get(name);
          if (credential === undefined) {
            credential = 92000 + credentialIds.size;
            credentialIds.set(name, credential);
            h.sqlite.prepare('INSERT INTO credentials(id,name) VALUES (?,?)').run(credential, name);
          }
          h.sqlite
            .prepare(
              "INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES (?,?,'2020-01-01',NULL)",
            )
            .run(id, credential);
        }
        for (const service of required.service ?? []) {
          h.sqlite
            .prepare(
              "INSERT OR IGNORE INTO service_credit_types(id,name,source_ref,actor_subject,created_at) VALUES (?,?,'Synthetic source-specific service evidence','synthetic',1)",
            )
            .run(service.serviceCode, service.serviceCode);
          h.sqlite
            .prepare(
              "INSERT INTO member_service_evidence(id,member_id,service_code,revision,effective_on,verified_months,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES (?,?,?,1,'2020-01-01',?,'Synthetic source-specific service evidence','synthetic','Synthetic fixture only',?,'{}',1)",
            )
            .run(`service-${id}`, id, service.serviceCode, service.minimumMonths, `service-${id}`);
        }
      }
      const entries = [...memberSeats].map(([memberId]) => ({
        memberId,
        employeeId: `SYNTHETIC-FINAL-${memberId}`,
        timeInGrade: memberId - 91999,
        departmentService: memberId - 91999,
      }));
      h.sqlite
        .prepare(
          "INSERT INTO bid_ordinal_datasets(id,bid_year,revision,source_sha256,source_ref,entries_json,actor_subject,reason,idempotency_key,request_json,created_at) VALUES ('synthetic-source-ordinals',?,1,?,'Synthetic certified ordinal fixture',?,'synthetic','Rehearsal only','synthetic-source-ordinals','{}',1)",
        )
        .run(
          year,
          createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
          JSON.stringify(entries),
        );
      const captured = await captureBidDefinitionSource(h.env.DB, year);
      if (!captured.ok) throw new Error(JSON.stringify(captured));
      const policyInput = structuredClone(pending.executionPolicy);
      const activeIds = new Set(active.map((p) => p.id));
      const dcSeats = active.filter((p) => p.rankRequired === 'DC');
      const stages = [
        {
          id: 'synthetic-dc-prebid',
          label: 'Synthetic DC staging assumption',
          order: 0,
          kind: 'MIXED' as const,
          memberIds: [...memberSeats].filter(([, p]) => p.rankRequired === 'DC').map(([id]) => id),
          opportunityPositionIds: dcSeats.map((p) => p.id),
        },
        ...policyInput.stages.map((stage, index) => ({
          ...stage,
          order: index + 1,
          opportunityPositionIds: stage.opportunityPositionIds.filter((id) => activeIds.has(id)),
          memberIds: [...memberSeats]
            .filter(([, p]) => stage.opportunityPositionIds.includes(p.id))
            .map(([id]) => id),
        })),
      ];
      const policy = FrozenLiveBidPolicySchema.parse({
        ...policyInput,
        policyRevision: `synthetic-source-${sourceSha256}`,
        stages,
        actionPermissions: LiveBidActionSchema.options.map((action) => ({
          action,
          actorMemberIds: [actor],
        })),
        annualOperations: {
          ...policyInput.annualOperations,
          requiredTopologyPositionIds:
            policyInput.annualOperations?.requiredTopologyPositionIds.filter((id) =>
              activeIds.has(id),
            ),
          fallbackPolicies: policyInput.annualOperations?.fallbackPolicies
            ?.map((f) => ({ ...f, positionIds: f.positionIds.filter((id) => activeIds.has(id)) }))
            .filter((f) => f.positionIds.length > 0),
          membershipDistributions: [
            {
              id: 'swat',
              label: 'Synthetic six reviewed SWAT memberships',
              sourceRef: 'PDF Procedure9 distribution only; synthetic existing-member assumption',
              sourceDecisionId: 'swat-population',
              membershipSource: 'REVIEWED_EXISTING_MEMBERS',
              memberIds: ['A', 'B', 'C'].flatMap((shift) =>
                [...memberSeats]
                  .filter(([, p]) => p.rankRequired === 'FF' && p.shift === shift)
                  .slice(0, 2)
                  .map(([id]) => id),
              ),
              shifts: ['A', 'B', 'C'],
              minimumPerShift: 2,
              maximumPerShift: 2,
              maximumPerADay: 1,
            },
          ],
          stageOrder: stages.map((s) => s.id),
          contact: {
            minimumAttempts: 3,
            timingMode: 'OPERATOR_DISCRETION',
            durationSeconds: null,
            evidenceRequired: true,
          },
          aDay: {
            ...policyInput.annualOperations?.aDay,
            min: 0,
            max: 100,
            captainDcMax: 100,
            specialtyMaximums: {
              ...policyInput.annualOperations?.aDay.specialtyMaximums,
              MARINE_FLOAT: 2,
            },
          },
        },
      });
      content.pendingPolicy = undefined;
      content.settings = {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-01',
        personnelEvaluationOn: '2027-01-01',
        livePolicy: policy,
      };
      content.policy = {
        policyText: pending.policyText,
        executionPolicy: policy,
        orderingAuthority: {
          v: 2,
          sourceDecisionId: 'seniority-source',
          stages: stages.map((stage) => ({
            stageId: stage.id,
            comparator: [
              {
                key:
                  stage.kind === 'FIREFIGHTER'
                    ? 'DEPARTMENT_SERVICE_BID_ORDINAL'
                    : 'TIME_IN_GRADE_BID_ORDINAL',
                direction: 'ASC',
              },
            ],
          })),
        },
      };
      content.staffingBindings = content.positions.map((p) => ({
        positionId: p.id,
        staffingPositionId: `synthetic-${p.id}`,
        authoritativeSourceRef: 'Synthetic reviewed test mapping; not real staffing authority',
        reviewStatus: 'approved',
      }));
      content.sourceDecisions = content.sourceDecisions.map((d) =>
        d.status === 'OPEN'
          ? {
              ...d,
              status: 'RESOLVED',
              decision:
                'Synthetic rehearsal assumption only; source activation fact remains unresolved.',
              sourceRef: `Synthetic fixture override of ${d.issueId}`,
              effectiveOn: '2027-01-01',
              ...(d.membershipPopulation
                ? {
                    membershipPopulation: {
                      ...d.membershipPopulation,
                      choice: 'CURRENT_SIX' as const,
                    },
                  }
                : {}),
            }
          : d,
      );
      const token = await signJwt(
        {
          sub: actor,
          emp: `SYNTHETIC-FINAL-${actor}`,
          role: 'admin',
          rank: 'CPT',
          first_name: 'Synthetic',
          last_name: 'Rehearsal',
          fresh_auth_at: Math.floor(Date.now() / 1000),
        },
        h.env.JWT_SIGNING_KEY,
      );
      async function request(path: string, body?: unknown) {
        return app.fetch(
          new Request(`http://x/api/admin/${path}`, {
            ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': randomUUID(),
            },
          }),
          h.env,
        );
      }
      let sessionId = '';
      let frozenTransportPolicy: FrozenLiveBidPolicy | undefined;
      let frozenSnapshot: Extract<BidSessionPolicySnapshot, { v: 3 }> | undefined;
      const lease = h.env.BID_SESSION.get(h.env.BID_SESSION.idFromName('synthetic'));
      h.env.BID_SESSION = {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const req = new Request(input, init);
            if (new URL(req.url).pathname.startsWith('/admin/normal-mutation-lease/'))
              return lease.fetch(req.url);
            const command = LiveBidCommandSchema.parse(await req.json());
            const state = await loadCanonicalBidSessionState(h.env.DB, sessionId);
            if (!frozenTransportPolicy) {
              const frozen = await loadFrozenSessionBidPolicy(getDb(h.env.DB), sessionId);
              if (!frozen.ok || frozen.snapshot.v !== 3 || frozen.snapshot.settings.v !== 3)
                throw new Error('Frozen canonical policy required');
              frozenSnapshot = frozen.snapshot;
              frozenTransportPolicy = frozen.snapshot.settings.livePolicy;
            }
            if (!state) throw new Error('Frozen canonical state required');
            const committed = await commitLiveBidCommand({
              db: h.env.DB,
              command,
              state,
              policy: frozenTransportPolicy,
            });
            return Response.json(committed.result, {
              status: committed.result.kind === 'accepted' ? 200 : 409,
            });
          },
        }),
      } as unknown as typeof h.env.BID_SESSION;
      const save = await request(`bid/${year}/versions`, {
        content,
        expected: { kind: 'legacy', sourceToken: captured.sourceToken },
        reason: 'Synthetic full source rehearsal',
      });
      expect(save.status, await save.clone().text()).toBe(201);
      const saved = (await save.json()) as { versionId: string; contentSha256: string };
      const selection = { versionId: saved.versionId, versionSha256: saved.contentSha256 };
      const preview = await request(`bid/${year}/preview`, { kind: 'mock', ...selection });
      const prepared = (await preview.json()) as {
        contextSha256: string;
        runtimeSourceToken: string;
      };
      expect(prepared, JSON.stringify(prepared)).toHaveProperty('contextSha256');
      const created = await request(`bid/${year}/mock-sessions`, {
        ...selection,
        expectedContextSha256: prepared.contextSha256,
        expectedSourceToken: prepared.runtimeSourceToken,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      sessionId = ((await created.json()) as { id: string }).id;
      expect(await loadCanonicalBidSessionState(h.env.DB, sessionId)).toBeNull();
      const started = await request(`bid-session/${sessionId}/start`, {});
      expect(started.status, await started.clone().text()).toBe(200);
      const attempts: {
        type: string;
        code?: string | undefined;
        memberId?: number | undefined;
        positionId?: string | undefined;
      }[] = [];
      async function command(type: string, fields: Record<string, unknown> = {}) {
        const state = await loadCanonicalBidSessionState(h.env.DB, sessionId);
        if (!state) throw new Error('Missing state');
        const response = await request(`bid-session/${sessionId}/commands/live`, {
          v: 1,
          type,
          commandId: randomUUID(),
          expectedSeq: state.lastSeq,
          reason: 'Synthetic full source rehearsal',
          evidenceReference: 'synthetic:operator-choice',
          ...fields,
        });
        const result = (await response.json()) as { kind: string; code?: string; error?: string };
        attempts.push({
          type,
          code: result.code,
          memberId: fields.memberId as number | undefined,
          positionId: fields.positionId as string | undefined,
        });
        if (process.env.MBFD_FINAL_MOCK_REPORT && attempts.length % 20 === 0)
          writeFileSync(
            `${process.env.MBFD_FINAL_MOCK_REPORT}.progress`,
            JSON.stringify({
              sourceSha256,
              attempts: attempts.length,
              last: attempts.at(-1),
              seq: state.lastSeq,
            }),
          );
        return result;
      }
      // Reuse the server's exact pure preflight for the next choice. This does
      // not commit any fill, bypass the canonical guard, or infer policy limits.
      async function availableADay(memberId: number, positionId: string, forced = false) {
        const state = await loadCanonicalBidSessionState(h.env.DB, sessionId);
        if (!state || !frozenSnapshot) throw new Error('Frozen projection required');
        const position = frozenSnapshot.ruleBookMaterial.positions.find((p) => p.id === positionId);
        const choices =
          position?.shift === 'D' ? (['MON'] as const) : (['G1', 'G2', 'G3', 'G4'] as const);
        for (const aDay of choices) {
          const candidate = {
            ...state,
            fills: {
              ...state.fills,
              [positionId]: {
                memberId,
                ordinal: state.lastSeq + 1,
                bidId: 'synthetic-preflight-only',
                aDay,
              },
            },
          };
          if (
            evaluateFrozenSimultaneousADays(frozenSnapshot, candidate, {
              nowMs: Date.now(),
              actorId: actor,
              forced,
              finalize: false,
            }).ok
          )
            return [aDay];
        }
        throw new Error(`No server-approved A-Day for ${positionId}`);
      }
      const firstBidder = (await loadCanonicalBidSessionState(h.env.DB, sessionId))
        ?.currentBidderId;
      if (firstBidder == null) throw new Error('Started bidder required');
      const firstSeat = memberSeats.get(firstBidder);
      if (!firstSeat) throw new Error('Synthetic first opportunity required');
      expect(
        await command('live.record_selection', { memberId: firstBidder, positionId: firstSeat.id }),
      ).toMatchObject({ kind: 'rejected', code: 'A_DAY_REQUIRED_WITH_SELECTION' });
      expect(await command('live.declare_unreachable', { memberId: firstBidder })).toMatchObject({
        kind: 'rejected',
        code: 'CONTACT_ATTEMPTS_INCOMPLETE',
      });
      for (const method of ['PHONE', 'TEXT', 'PHONE'])
        expect(
          (await command('live.record_contact_attempt', { memberId: firstBidder, method })).kind,
        ).toBe('accepted');
      expect((await command('live.declare_unreachable', { memberId: firstBidder })).kind).toBe(
        'accepted',
      );
      expect((await command('live.disposition', { disposition: 'DEFER' })).kind).toBe('accepted');
      expect(
        (await command('live.return_at_current_sequence', { memberId: firstBidder })).kind,
      ).toBe('accepted');
      let forcedFallback = false;
      let amended = false;
      let specialtyInterruptions = 0;
      for (let step = 0; step < 230; step++) {
        const state = await loadCanonicalBidSessionState(h.env.DB, sessionId);
        if (!state) throw new Error('Missing state');
        if (state.currentPhase === 'complete') break;
        const memberId = state.annual?.returningMemberId ?? state.currentBidderId;
        const seat = memberId === null ? undefined : memberSeats.get(memberId);
        if (memberId === null || !seat) throw new Error(`Unexpected bidder ${memberId}`);
        const pool = policy.annualOperations?.opportunityPools?.find((p) =>
          p.positionIds.includes(seat.id),
        );
        const specialty = policy.annualOperations?.specialties?.find((s) =>
          s.opportunityPositionIds.includes(seat.id),
        );
        const positionId =
          pool?.positionIds.find((id) => !state.fills[id]) ??
          specialty?.opportunityPositionIds.find((id) => !state.fills[id]) ??
          seat.id;
        const negativeADay = new Map([
          ['final2026-A104', 'MEMBERSHIP_A_DAY_MAXIMUM_REACHED'],
          ['final2026-A303', 'SCOPED_A_DAY_MAXIMUM'],
          ['A612', 'SCOPED_A_DAY_MAXIMUM'],
          ['final2026-A606', 'SCOPED_A_DAY_MAXIMUM'],
        ]).get(seat.id);
        if (negativeADay)
          expect(
            await command('live.record_selection', {
              memberId,
              positionId,
              ...(pool ? { pool: { poolId: pool.id } } : {}),
              aDay: 'G1',
            }),
          ).toMatchObject({ kind: 'rejected', code: negativeADay });
        if (seat.id === 'A203') {
          const ineligible = await command('live.record_selection', {
            memberId,
            positionId: 'A612',
            aDay: 'G1',
          });
          expect(ineligible).toMatchObject({ kind: 'rejected', code: 'MEMBER_NOT_ELIGIBLE' });
        }
        if (!forcedFallback && seat.id === 'final2026-C707') {
          const response = await request(`bid-session/${sessionId}/specialty-live`);
          const projected = (await response.json()) as {
            fallbacks: {
              ok: boolean;
              positionId: string;
              policyId: string;
              tierId: string;
              candidateMemberIds: number[];
            }[];
          };
          const fallback = projected.fallbacks.find(
            (row) =>
              row.ok && row.positionId === positionId && row.policyId === 'fallback-designated-de',
          );
          if (!fallback?.candidateMemberIds[0])
            throw new Error('Server ordered fallback candidate required');
          let accepted = false;
          for (const aDay of await availableADay(
            fallback.candidateMemberIds[0],
            positionId,
            true,
          )) {
            const result = await command('live.force_selection', {
              memberId: fallback.candidateMemberIds[0],
              positionId,
              ...(pool ? { pool: { poolId: pool.id } } : {}),
              fallback: { policyId: fallback.policyId, tierId: fallback.tierId },
              aDay,
            });
            if (result.kind === 'accepted') {
              accepted = true;
              break;
            }
            expect(result.code).toMatch(/A_DAY/);
          }
          expect(accepted).toBe(true);
          forcedFallback = true;
          continue;
        }
        let selected = false;
        if (specialty) {
          const begun = await command('live.start_specialty_adjudication', {
            specialtyId: specialty.id,
            positionId,
          });
          if (begun.error === 'live_specialty_no_higher_priority_candidate') {
            for (const aDay of await availableADay(memberId, positionId)) {
              const result = await command('live.record_selection', { memberId, positionId, aDay });
              if (result.kind === 'accepted') {
                selected = true;
                break;
              }
              expect(result.code, JSON.stringify(result)).toMatch(/A_DAY/);
            }
          } else {
            expect(begun.kind, JSON.stringify(begun)).toBe('accepted');
            specialtyInterruptions++;
            const pendingState = await loadCanonicalBidSessionState(h.env.DB, sessionId);
            const candidate = pendingState?.live?.specialty?.candidateMemberIds[0];
            if (candidate === undefined) throw new Error('Candidate required');
            for (const aDay of await availableADay(candidate, positionId)) {
              const result = await command('live.resolve_specialty_candidate', {
                memberId: candidate,
                outcome: 'ACCEPT',
                aDay,
              });
              if (result.kind === 'accepted') {
                selected = true;
                break;
              }
              expect(result.code).toMatch(/A_DAY/);
            }
          }
        } else
          for (const aDay of await availableADay(memberId, positionId)) {
            const result = await command('live.record_selection', {
              memberId,
              positionId,
              ...(pool ? { pool: { poolId: pool.id } } : {}),
              aDay,
            });
            if (result.kind === 'accepted') {
              selected = true;
              break;
            }
            expect(result.code, JSON.stringify(result)).toMatch(/A_DAY/);
          }
        expect(selected, `No server-approved A-Day for ${positionId}`).toBe(true);
        if (!amended && seat.id === 'final2026-A101') {
          const later = [...memberSeats].find(([, p]) => p.id === 'final2026-B101');
          if (!later) throw new Error('Synthetic equivalent Captain opportunity required');
          const result = await command('live.amend_selection', {
            memberId,
            fromPositionId: seat.id,
            toPositionId: later[1].id,
            aDay: 'G1',
          });
          expect(result.kind, JSON.stringify(result)).toBe('accepted');
          memberSeats.set(later[0], seat);
          amended = true;
        }
      }
      const completed = await command('live.complete_session');
      expect(completed.kind, JSON.stringify(completed)).toBe('accepted');
      const final = await loadCanonicalBidSessionState(h.env.DB, sessionId);
      expect(Object.keys(final?.fills ?? {})).toHaveLength(223);
      expect(forcedFallback).toBe(true);
      expect(amended).toBe(true);
      expect(specialtyInterruptions).toBeGreaterThan(0);
      if (process.env.MBFD_FINAL_MOCK_REPORT)
        writeFileSync(
          `${process.env.MBFD_FINAL_MOCK_REPORT}.progress`,
          JSON.stringify({
            sourceSha256,
            stage: 'canonical-completed',
            awards: Object.keys(final?.fills ?? {}).length,
            seq: final?.lastSeq,
            attempts: attempts.length,
          }),
        );
      const before = h.sqlite.serialize();
      const results = await request(`bid-session/${sessionId}/results`);
      expect(results.status).toBe(200);
      const resultBody = (await results.json()) as { awards: unknown[] };
      expect(resultBody.awards).toHaveLength(223);
      const rehearsal = await request(
        `result-distribution/${sessionId}/rehearsal-transition-preview`,
      );
      expect(rehearsal.status, await rehearsal.clone().text()).toBe(200);
      expect(await rehearsal.json()).toMatchObject({
        mode: 'MOCK',
        canApply: false,
        finalization: { complete: true, blockers: [] },
      });
      const after = h.sqlite.serialize();
      expect(
        after.length === before.length && after.every((byte, index) => byte === before[index]),
      ).toBe(true);
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM bids').get()).toEqual({ n: 0 });
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM member_assignments').get()).toEqual({
        n: 0,
      });
      if (process.env.MBFD_FINAL_MOCK_REPORT)
        writeFileSync(
          process.env.MBFD_FINAL_MOCK_REPORT,
          JSON.stringify(
            {
              sourceSha256,
              saved,
              sessionId,
              positions: 228,
              awards: 223,
              commandAttempts: attempts,
              readOnlyProjection: true,
              departmentWrites: 0,
              legacyBidWrites: 0,
              syntheticOverrides: [
                'identity/credentials/service/ordinal evidence',
                'operator permissions',
                'dates',
                'DC pre-stage',
                'general A-Day capacity',
                'staffing bindings',
                'pending activation decisions',
                'reviewed existing six SWAT members chosen only for synthetic rehearsal',
              ],
              transport: 'loopback DO; actual canonical service and HTTP adapters',
            },
            null,
            2,
          ),
        );
    } finally {
      vi.useRealTimers();
      await teardownTestD1(h);
    }
  },
  600000,
);
