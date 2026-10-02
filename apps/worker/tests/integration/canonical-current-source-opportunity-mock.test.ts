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
import Papa from 'papaparse';
import { expect, it, vi } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import type { BidSessionState } from '../../src/durable/bid-session-state.js';
import { app } from '../../src/index.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { decodeBidEvidenceDocument } from '../../src/lib/bid-evidence-storage.js';
import { loadFrozenSessionBidPolicy } from '../../src/lib/bid-policy.js';
import { evaluateFrozenADays } from '../../src/lib/frozen-a-day.js';
import { signJwt } from '../../src/lib/jwt.js';
import { setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

// Private source input is opt-in. No source document or real personnel facts
// enter the repository. This is an actual canonical command integration run,
// with an explicitly synthetic activation layer and loopback DO transport.
const sourcePath = process.env.MBFD_CURRENT_OPPORTUNITY_SOURCE;
it.skipIf(!sourcePath)(
  'runs current 231-position topology with 223 synthetic opportunity-load bidders',
  async () => {
    if (!sourcePath) throw new Error('Source artifact required');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T15:00:00Z'));
    const h = await setupTestD1();
    try {
      h.sqlite.pragma('foreign_keys = ON');
      const raw = readFileSync(sourcePath, 'utf8');
      const sourceSha256 = createHash('sha256').update(raw).digest('hex');
      expect(sourceSha256).toBe(process.env.MBFD_CURRENT_OPPORTUNITY_SOURCE_SHA256);
      if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT) {
        writeFileSync(
          `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.progress`,
          JSON.stringify({ sourceSha256, stage: 'starting', attempts: 0, seq: null }),
        );
        writeFileSync(`${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.last-rejection`, 'null');
      }
      const content = BidDefinitionContentSchema.parse(JSON.parse(raw));
      expect(content.positions).toHaveLength(231);
      const pending = content.policy;
      if (!pending?.executionPolicy.annualOperations)
        throw new Error('Current source annual policy required');
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
      const juniorInvestigatorOpportunity = pending.executionPolicy.annualOperations.specialties
        ?.find((specialty) => specialty.id === 'investigator-preference')
        ?.opportunityPositionIds.at(-1);
      if (!juniorInvestigatorOpportunity)
        throw new Error('Source investigator opportunity required for synthetic priority case');
      const deferredFallbackOpportunity = pending.executionPolicy.annualOperations.fallbackPolicies
        ?.find((fallback) => fallback.id === 'fallback-designated-de')
        ?.positionIds.at(-1);
      if (!deferredFallbackOpportunity)
        throw new Error('Source designated-DE opportunity required for synthetic fallback case');
      const credentialIds = new Map<string, number>();
      const packetPath = process.env.MBFD_CURRENT_OPPORTUNITY_PACKET;
      if (!packetPath) throw new Error('Verified source packet required for source catalog');
      const sourcePacket = JSON.parse(readFileSync(packetPath, 'utf8'));
      expect(sourcePacket.version.content_sha256).toBe(sourceSha256);
      const sealedEvaluation = JSON.parse(
        decodeBidEvidenceDocument(sourcePacket.freeze.evaluation_json),
      );
      for (const name of sealedEvaluation.authoringCredentialNames) {
        const id = 92000 + credentialIds.size;
        credentialIds.set(name, id);
        h.sqlite.prepare('INSERT INTO credentials(id,name) VALUES (?,?)').run(id, name);
      }
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
            credentialEvaluationOn: '2026-09-30',
            personnelEvaluationOn: '2026-09-30',
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
          custom?: string[];
          service?: { serviceCode: string; minimumMonths: number }[];
        } = JSON.parse(rule.requiredCriteriaJson);
        for (const name of new Set([
          ...required.credentials,
          ...(required.custom?.includes('paramedic') ? ['Paramedic'] : []),
          ...(seat.id === juniorInvestigatorOpportunity
            ? [
                'Certified Fire Investigator (IAAI-CFI)',
                'Fire Investigator (FL cert issued 2015 or later)',
                'Firesafety Inspector I',
              ]
            : []),
        ])) {
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
      // The current source excludes Division Chief seats. No synthetic DC
      // stage and no guard bypass are permitted. Each rank cohort includes
      // the synthetic Days award holders in its ordinary stage; canonical
      // progression skips members already awarded during the Days stage.
      expect(active.some((position) => position.rankRequired === 'DC')).toBe(false);
      const stages = policyInput.stages.map((stage) => ({
        ...stage,
        memberIds: [...memberSeats]
          .filter(([, position]) =>
            stage.kind === 'D_SHIFT'
              ? stage.opportunityPositionIds.includes(position.id)
              : position.rankRequired ===
                (stage.kind === 'CAPTAIN' ? 'CPT' : stage.kind === 'LIEUTENANT' ? 'LT' : 'FF'),
          )
          .map(([id]) => id),
      }));
      const sourceADay = JSON.stringify(policyInput.annualOperations?.aDay);
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
            ?.map((f) => ({
              ...f,
              positionIds: f.positionIds.filter((id) => activeIds.has(id)),
              activation: {
                v: 1 as const,
                prerequisite:
                  f.id === 'fallback-designated-de' || f.id === 'fallback-rescue-float'
                    ? ('ORDINARY_OPPORTUNITY_PATH_EXHAUSTED' as const)
                    : ('NO_QUALIFIED_VOLUNTEER_REMAINS' as const),
                sourceRef: `Synthetic timing case based on ${f.sourceRef}`,
              },
            }))
            .filter((f) => f.positionIds.length > 0),
          membershipDistributions: policyInput.annualOperations?.membershipDistributions?.map(
            (membership) => ({
              ...membership,
              memberIds: membership.shifts.flatMap((shift) =>
                [...memberSeats]
                  .filter(
                    ([, position]) => position.rankRequired === 'FF' && position.shift === shift,
                  )
                  .slice(0, membership.minimumPerShift)
                  .map(([id]) => id),
              ),
            }),
          ),
          stageOrder: stages.map((s) => s.id),
          contact: {
            minimumAttempts: 3,
            timingMode: 'OPERATOR_DISCRETION',
            durationSeconds: null,
            evidenceRequired: true,
          },
          aDay: policyInput.annualOperations?.aDay,
        },
      });
      expect(JSON.stringify(policy.annualOperations?.aDay)).toBe(sourceADay);
      content.pendingPolicy = undefined;
      content.settings = {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2026-09-30',
        personnelEvaluationOn: '2026-09-30',
        livePolicy: policy,
      };
      content.policy = {
        policyText: pending.policyText,
        stageParticipantSources: stages.map((stage) => ({
          stageId: stage.id,
          sourceRef:
            'Explicit synthetic opportunity-load cohort; source stage opportunities preserved',
          participantSource: { type: 'EXPLICIT_MEMBERS' as const, memberIds: stage.memberIds },
          ordering: [
            {
              key:
                stage.kind === 'FIREFIGHTER'
                  ? ('DEPARTMENT_SERVICE_BID_ORDINAL' as const)
                  : ('TIME_IN_GRADE_BID_ORDINAL' as const),
              direction: 'ASC' as const,
            },
          ],
        })),
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
      // Synthetic evidence is deliberately not represented as the sealed
      // production cutoff. The original source document remains unchanged.
      content.sourceDecisions = content.sourceDecisions
        .filter((decision) => decision.issueId !== '2026-eligibility-cutoff-evidence')
        .map((d) =>
          d.status === 'OPEN'
            ? {
                ...d,
                status: 'RESOLVED',
                decision:
                  'Synthetic rehearsal assumption only; source activation fact remains unresolved.',
                sourceRef: `Synthetic fixture override of ${d.issueId}`,
                effectiveOn: '2026-09-30',
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
      if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT) {
        writeFileSync(
          `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.bootstrap.sqlite`,
          h.sqlite.serialize(),
        );
        writeFileSync(
          `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.bootstrap-definition.json`,
          JSON.stringify(content),
        );
      }
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
      const acceptedCommands: Record<string, unknown>[] = [];
      async function command(
        type: string,
        fields: Record<string, unknown> = {},
        knownState?: BidSessionState,
      ) {
        const state = knownState ?? (await loadCanonicalBidSessionState(h.env.DB, sessionId));
        if (!state) throw new Error('Missing state');
        const payload = {
          v: 1,
          type,
          commandId: randomUUID(),
          expectedSeq: state.lastSeq,
          reason: 'Synthetic full source rehearsal',
          evidenceReference: 'synthetic:operator-choice',
          ...fields,
        };
        const response = await request(`bid-session/${sessionId}/commands/live`, payload);
        const result = (await response.json()) as { kind: string; code?: string; error?: string };
        if (result.kind === 'accepted') acceptedCommands.push(payload);
        if (result.kind === 'rejected' && process.env.MBFD_CURRENT_OPPORTUNITY_REPORT) {
          writeFileSync(
            `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.last-rejection`,
            JSON.stringify(
              {
                type,
                fields,
                result,
                member: frozenSnapshot?.members.find((m) => m.memberId === fields.memberId),
                rule: frozenSnapshot?.ruleBookMaterial.rules.find(
                  (r) => r.positionId === fields.positionId,
                ),
              },
              null,
              2,
            ),
          );
        }
        attempts.push({
          type,
          code: result.code,
          memberId: fields.memberId as number | undefined,
          positionId: fields.positionId as string | undefined,
        });
        if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT && attempts.length % 20 === 0)
          writeFileSync(
            `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.progress`,
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
      async function availableADay(
        memberId: number,
        positionId: string,
        forced = false,
        knownState?: BidSessionState,
      ) {
        const state = knownState ?? (await loadCanonicalBidSessionState(h.env.DB, sessionId));
        if (!state || !frozenSnapshot) throw new Error('Frozen projection required');
        const position = frozenSnapshot.ruleBookMaterial.positions.find((p) => p.id === positionId);
        const choices =
          position?.shift === 'D' ? (['MON'] as const) : (['G1', 'G2', 'G3', 'G4'] as const);
        const rejectedCodes: string[] = [];
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
          const validation = evaluateFrozenADays(frozenSnapshot, candidate, {
            nowMs: Date.now(),
            actorId: actor,
            forced,
            finalize: false,
          });
          if (validation.ok) return [aDay];
          rejectedCodes.push(validation.code);
        }
        throw new Error(`No server-approved A-Day for ${positionId}: ${rejectedCodes.join(',')}`);
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
      let pendingFallbackPositionId: string | null = null;
      let amended = false;
      let specialtyInterruptions = 0;
      for (let step = 0; step < 330; step++) {
        const state = await loadCanonicalBidSessionState(h.env.DB, sessionId);
        if (!state) throw new Error('Missing state');
        if (state.currentPhase === 'complete') break;
        const memberId = state.annual?.returningMemberId ?? state.currentBidderId;
        const seat = memberId === null ? undefined : memberSeats.get(memberId);
        if (memberId === null || !seat) throw new Error(`Unexpected bidder ${memberId}`);
        const existingAward = Object.entries(state.fills).find(
          ([, fill]) => fill.memberId === memberId,
        );
        if (
          state.currentPhase === 'a_day_bid' ||
          (existingAward !== undefined && existingAward[1].aDay === undefined)
        ) {
          const awardedPositionId = existingAward?.[0];
          if (!awardedPositionId) throw new Error('Deferred A-Day award required');
          const choices = await availableADay(memberId, awardedPositionId, false, state);
          expect(
            (await command('live.record_a_day', { memberId, aDay: choices[0] }, state)).kind,
          ).toBe('accepted');
          continue;
        }
        const pool = policy.annualOperations?.opportunityPools?.find((p) =>
          p.positionIds.includes(seat.id),
        );
        const specialty = policy.annualOperations?.specialties?.find((s) =>
          s.opportunityPositionIds.includes(seat.id),
        );
        const positionId =
          pool?.positionIds.find((id) => !state.fills[id] && id !== pendingFallbackPositionId) ??
          specialty?.opportunityPositionIds.find((id) => !state.fills[id]) ??
          seat.id;
        // Keep the pool's first-open reservation order intact. Leave only its
        // last configured designated-DE slot for the final fallback phase.
        if (!forcedFallback && seat.id === deferredFallbackOpportunity) {
          expect(
            await command('live.force_selection', {
              memberId,
              positionId,
              ...(pool ? { pool: { poolId: pool.id } } : {}),
              fallback: { policyId: 'fallback-designated-de', tierId: 'minimum-qualified' },
              aDay: 'G1',
            }),
          ).toMatchObject({ kind: 'rejected', code: 'FALLBACK_ORDINARY_PATH_NOT_EXHAUSTED' });
          expect((await command('live.disposition', { disposition: 'DECLINED' })).kind).toBe(
            'accepted',
          );
          pendingFallbackPositionId = positionId;
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
            let pendingState = await loadCanonicalBidSessionState(h.env.DB, sessionId);
            // Synthetic engineering preferences keep an existing award. A
            // higher-priority candidate who already has a seat explicitly
            // declines this new offer; eligibility and ordering stay canonical.
            while (pendingState?.live?.specialty) {
              const interruption = pendingState.live.specialty;
              const candidate = interruption.candidateMemberIds[interruption.candidateCursor];
              if (candidate === undefined) throw new Error('Candidate required');
              if (!Object.values(pendingState.fills).some((fill) => fill.memberId === candidate))
                break;
              const declined = await command(
                'live.resolve_specialty_candidate',
                {
                  memberId: candidate,
                  outcome: 'DECLINE',
                  evidenceReference: 'synthetic:retain-existing-award-preference',
                },
                pendingState,
              );
              expect(declined.kind, JSON.stringify(declined)).toBe('accepted');
              pendingState = await loadCanonicalBidSessionState(h.env.DB, sessionId);
            }
            if (!pendingState) throw new Error('Canonical resumed state required');
            const interruption = pendingState.live?.specialty;
            const candidate =
              interruption?.candidateMemberIds[interruption.candidateCursor] ?? memberId;
            const execution = policy.annualOperations?.aDay.execution;
            const timing =
              execution?.timingExceptions?.find((entry) => entry.positionIds.includes(positionId))
                ?.timing ?? execution?.timing;
            // An early specialty award under deferred source timing must carry
            // no A-Day. Its ordinary turn above submits the separate canonical
            // A-Day command. Simultaneous timing still uses the server preflight.
            const choices =
              interruption && timing === 'AFTER_POSITION_SELECTION'
                ? [undefined]
                : await availableADay(candidate, positionId, false, pendingState);
            for (const aDay of choices) {
              const result = await command(
                interruption ? 'live.resolve_specialty_candidate' : 'live.record_selection',
                {
                  memberId: candidate,
                  ...(interruption ? { outcome: 'ACCEPT' } : { positionId }),
                  ...(aDay === undefined ? {} : { aDay }),
                },
                pendingState,
              );
              if (result.kind === 'accepted') {
                selected = true;
                break;
              }
              expect(result.code).toMatch(/A_DAY/);
            }
          }
        }
        // The loop's state is unchanged: preceding negative cases must reject.
        // HTTP and canonical-service guards still independently reload and verify it.
        else
          for (const aDay of await availableADay(memberId, positionId, false, state)) {
            const result = await command(
              'live.record_selection',
              {
                memberId,
                positionId,
                ...(pool ? { pool: { poolId: pool.id } } : {}),
                aDay,
              },
              state,
            );
            if (result.kind === 'accepted') {
              selected = true;
              break;
            }
            expect(result.code, JSON.stringify(result)).toMatch(/A_DAY/);
          }
        expect(selected, `No server-approved A-Day for ${positionId}`).toBe(true);
        if (!amended && seat.id === 'A101') {
          const later = [...memberSeats].find(([, p]) => p.id === 'B101');
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
      if (!pendingFallbackPositionId)
        throw new Error('Synthetic unbid fallback opportunity required');
      const finalFallbackPositionId = pendingFallbackPositionId;
      const projected = (await (
        await request(`bid-session/${sessionId}/specialty-live`)
      ).json()) as {
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
          row.ok &&
          row.positionId === pendingFallbackPositionId &&
          row.policyId === 'fallback-designated-de',
      );
      if (!fallback?.candidateMemberIds[0])
        throw new Error('Server ordered final-stage fallback candidate required');
      const fallbackPool = policy.annualOperations?.opportunityPools?.find((p) =>
        p.positionIds.includes(finalFallbackPositionId),
      );
      for (const aDay of await availableADay(
        fallback.candidateMemberIds[0],
        pendingFallbackPositionId,
        true,
      )) {
        const result = await command('live.force_selection', {
          memberId: fallback.candidateMemberIds[0],
          positionId: pendingFallbackPositionId,
          ...(fallbackPool ? { pool: { poolId: fallbackPool.id } } : {}),
          fallback: { policyId: fallback.policyId, tierId: fallback.tierId },
          aDay,
        });
        if (result.kind === 'accepted') {
          forcedFallback = true;
          break;
        }
        expect(result.code).toMatch(/A_DAY/);
      }
      expect(forcedFallback).toBe(true);
      const completed = await command('live.complete_session');
      expect(completed.kind, JSON.stringify(completed)).toBe('accepted');
      const final = await loadCanonicalBidSessionState(h.env.DB, sessionId);
      expect(Object.keys(final?.fills ?? {})).toHaveLength(223);
      expect(forcedFallback).toBe(true);
      expect(amended).toBe(true);
      expect(specialtyInterruptions).toBeGreaterThan(0);
      if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT)
        writeFileSync(
          `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.progress`,
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
      const exportEvidence: Record<string, { rows: number; sha256: string }> = {};
      for (const [kind, path, expectedRows] of [
        ['placements', `placements/export?bid_session_id=${sessionId}`, 223],
        ['progress', `exports/${sessionId}/progress.csv`, 1],
        [
          'audit',
          `audit/export?bid_session_id=${sessionId}`,
          Number(
            (
              h.sqlite
                .prepare('SELECT count(*) AS n FROM audit_log WHERE bid_session_id=?')
                .get(sessionId) as { n: number }
            ).n,
          ),
        ],
      ] as const) {
        const response = await request(path);
        expect(response.status, await response.clone().text()).toBe(200);
        const text = await response.text();
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        expect(parsed.errors).toEqual([]);
        expect(parsed.data).toHaveLength(expectedRows);
        if (kind === 'placements') {
          const csvAwards = parsed.data
            .map((row) => [row.position_id, Number(row.member_id), row.a_day])
            .sort();
          const stateAwards = Object.entries(final?.fills ?? {})
            .map(([positionId, fill]) => [
              positionId,
              fill.memberId,
              final?.aDay?.picks.find((pick) => pick.memberId === fill.memberId)?.aDay ??
                fill.aDay ??
                '',
            ])
            .sort();
          expect(csvAwards).toEqual(stateAwards);
        }
        if (kind === 'progress')
          expect(parsed.data[0]).toMatchObject({
            awards_committed: '223',
            last_committed_command_sequence: String(final?.lastSeq),
          });
        exportEvidence[kind] = {
          rows: parsed.data.length,
          sha256: createHash('sha256').update(text).digest('hex'),
        };
        if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT)
          writeFileSync(`${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.${kind}.csv`, text);
      }
      const after = h.sqlite.serialize();
      expect(
        after.length === before.length && after.every((byte, index) => byte === before[index]),
      ).toBe(true);
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM bids').get()).toEqual({ n: 0 });
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM member_assignments').get()).toEqual({
        n: 0,
      });
      if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT)
        writeFileSync(
          `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.sqlite`,
          h.sqlite.serialize(),
        );
      if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT)
        writeFileSync(
          process.env.MBFD_CURRENT_OPPORTUNITY_REPORT,
          JSON.stringify(
            {
              sourceSha256,
              coverageKind: 'SYNTHETIC_OPPORTUNITY_LOAD',
              actualV11CohortClaimed: false,
              sourceADayUnchanged: true,
              stageOpportunitySetsUnchanged: true,
              candidateSha: process.env.MBFD_CURRENT_OPPORTUNITY_CANDIDATE_SHA,
              syntheticPolicySha256: createHash('sha256')
                .update(JSON.stringify(policy))
                .digest('hex'),
              syntheticCohortSha256: createHash('sha256')
                .update(JSON.stringify([...memberSeats]))
                .digest('hex'),
              saved,
              sessionId,
              positions: 231,
              awards: 223,
              commandAttempts: attempts,
              acceptedCommands,
              readOnlyProjection: true,
              departmentWrites: 0,
              legacyBidWrites: 0,
              exportEvidence,
              localDatabaseSha256: createHash('sha256').update(h.sqlite.serialize()).digest('hex'),
              syntheticOverrides: [
                'identity/credentials/service/ordinal evidence',
                'operator permissions',
                'production sealed cutoff omitted; explicitly synthetic local evidence',
                'staffing bindings',
                'pending activation decisions',
                'reviewed membership identity replacement only; source distribution limits preserved',
              ],
              transport: 'loopback DO; actual canonical service and HTTP adapters',
            },
            null,
            2,
          ),
        );
    } finally {
      if (process.env.MBFD_CURRENT_OPPORTUNITY_REPORT)
        writeFileSync(
          `${process.env.MBFD_CURRENT_OPPORTUNITY_REPORT}.last-state.sqlite`,
          h.sqlite.serialize(),
        );
      vi.useRealTimers();
      await teardownTestD1(h);
    }
  },
  1800000,
);
