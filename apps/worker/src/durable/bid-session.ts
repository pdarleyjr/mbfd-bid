import {
  type AuditEvent,
  BID_EVENT_VERSION,
  type BidEventEnvelope,
  ClientMessageSchema,
  type MockFreezeCommand,
  type MockFreezeCommandResult,
  MockFreezeCommandSchema,
  type PickRejectedEvent,
  type StateSnapshotEvent,
} from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { drainBidAuditOutbox } from '../audit/archive-outbox.js';
import { makeChainDb } from '../audit/chain-db-d1.js';
import { ChainEmitter } from '../audit/chain-emitter.js';
import {
  commitMockFreezeCommand,
  loadCanonicalBidSessionState,
} from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import {
  auditLog,
  bidSessions,
  bids,
  members,
  portalWritebackQueue,
  positions,
} from '../db/schema.js';
import {
  type AuditRowDraft,
  auditEntryForForcedPick,
  auditEntryForFreeze,
  auditEntryForPickMade,
  auditEntryForSkip,
} from '../lib/audit.js';
import {
  type VerifiedWebSocketIdentity,
  parseVerifiedWebSocketIdentity,
} from '../lib/websocket-identity.js';
import { buildPortalPayload } from '../portal-writeback/payload-builder.js';
import { isPortalPublicationEnabled } from '../portal-writeback/publication-policy.js';
import { enqueuePortalWriteback } from '../portal-writeback/queue-producer.js';
import type { WorkerEnv } from '../types/env.js';
import {
  type SubmitADayPickInput,
  type SubmitADayPickResult,
  type TransitionToPhase2Input,
  handleSubmitADayPick,
  transitionToPhase2,
} from './bid-session-aday-handlers.js';
import {
  type ForcePickInput,
  type FreezeInput,
  type HandlerEnv,
  type SkipInput,
  type SubmitPickInput,
  handleForcePick,
  handleFreeze,
  handleSkip,
  handleSubmitPick,
} from './bid-session-handlers.js';
import {
  type BidSessionState,
  type DOStorageLike,
  emptyBidSessionState,
  loadBidSessionState,
  persistBidSessionState,
} from './bid-session-state.js';

interface ConnectedClient {
  socket: WebSocket;
  memberId: number;
  role: 'member' | 'admin';
}

interface IdempotencyRecord {
  envelope: BidEventEnvelope;
}

type CanonicalMockIntent = 'pending' | 'active';

export class BidSessionDO implements DurableObject {
  private state: DurableObjectState;
  private env: WorkerEnv;
  private clients = new Map<string, ConnectedClient>();
  private memoryState: BidSessionState | null = null;
  /** Undefined until the private durable marker has been read for this DO instance. */
  private canonicalMockIntent: CanonicalMockIntent | null | undefined = undefined;
  /** Plan 08 — lazy per-DO chain emitter (one per Worker isolate). */
  private emitter: ChainEmitter | null = null;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state;
    this.env = env;
  }

  private get storage(): DOStorageLike {
    return this.state.storage as unknown as DOStorageLike;
  }

  private namedSessionId(): string {
    return this.state.id.name ?? this.state.id.toString();
  }

  /** Preserve the physical DO storage namespace while D1 stores the named id. */
  private projectCanonicalState(canonicalState: BidSessionState): BidSessionState {
    return { ...canonicalState, bidSessionId: this.state.id.toString() };
  }

  private canonicalMockIntentKey(): string {
    return `canonical-mock-intent:${this.state.id.toString()}`;
  }

  private async canonicalMockIntentState(): Promise<CanonicalMockIntent | null> {
    if (this.canonicalMockIntent === undefined) {
      const marker = await this.storage.get<unknown>(this.canonicalMockIntentKey());
      this.canonicalMockIntent =
        marker === 'pending' || marker === 'active' || marker === true ? 'active' : null;
    }
    return this.canonicalMockIntent;
  }

  private async markCanonicalMockIntent(): Promise<void> {
    await this.storage.put(this.canonicalMockIntentKey(), 'pending');
    this.canonicalMockIntent = 'pending';
  }

  private async activateCanonicalMockIntent(): Promise<void> {
    await this.storage.put(this.canonicalMockIntentKey(), 'active');
    this.canonicalMockIntent = 'active';
  }

  private async clearCanonicalMockIntent(): Promise<void> {
    await this.storage.delete(this.canonicalMockIntentKey());
    this.canonicalMockIntent = null;
  }

  private async getState(): Promise<BidSessionState> {
    if (!this.memoryState) {
      const id = this.state.id.toString();
      const persisted = await loadBidSessionState(this.storage, id);
      this.memoryState = persisted.bidSessionId === id ? persisted : emptyBidSessionState(id);
    }
    if ((await this.canonicalMockIntentState()) === null) return this.memoryState;
    return this.hydrateCanonicalMockState(this.memoryState);
  }

  /**
   * The canonical D1 state exists only for the rehearsal mock command. Keep
   * this recovery path out of ordinary snapshots and legacy commands so an
   * unavailable or not-yet-migrated D1 binding cannot alter their behavior.
   */
  private async hydrateCanonicalMockState(localState: BidSessionState): Promise<BidSessionState> {
    const canonicalState = await loadCanonicalBidSessionState(this.env.DB, this.namedSessionId());
    if (canonicalState === null) return localState;

    const projection = this.projectCanonicalState(canonicalState);
    await persistBidSessionState(this.storage, projection);
    this.memoryState = projection;
    return projection;
  }

  private handlerEnv(): HandlerEnv {
    return {
      nowMs: () => Date.now(),
      newBidId: () => ulid(),
      evaluateEligibility: () => ({
        eligible: true,
        reasons: [],
        points: 0,
        soPoints: 0,
        moPoints: 0,
        breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
      }),
    };
  }

  private envelope(
    type: BidEventEnvelope['type'],
    payload: unknown,
    seq: number,
  ): BidEventEnvelope {
    return { v: BID_EVENT_VERSION, seq, ts: Date.now(), type, payload };
  }

  private broadcast(env: BidEventEnvelope): void {
    const json = JSON.stringify(env);
    for (const c of this.clients.values()) {
      try {
        c.socket.send(json);
      } catch {}
    }
  }

  /**
   * Archive only after the canonical D1 command has committed and clients have
   * seen the realtime event. The retryable outbox absorbs R2 failures; it is
   * never part of the acceptance path.
   */
  private scheduleCanonicalAuditArchive(): void {
    if (!this.env.R2_AUDIT || typeof this.env.R2_AUDIT.put !== 'function') return;
    this.state.waitUntil(
      drainBidAuditOutbox({ db: this.env.DB, r2: this.env.R2_AUDIT }).catch((error) => {
        console.error('[BidSessionDO] canonical audit archive retry failed', error);
      }),
    );
  }

  private send(socket: WebSocket, env: BidEventEnvelope): void {
    try {
      socket.send(JSON.stringify(env));
    } catch {}
  }

  /**
   * Writes a flat audit_log row and (best-effort) emits into the R2 chain.
   *
   * For `pick` and `forced_pick` events the chain emit is performed
   * explicitly BEFORE state is persisted (§D10 strict variant) and the
   * caller passes `opts.skipChainEmit = true` so this method doesn't
   * double-emit. Non-pick events (skip, freeze, etc.) are emitted
   * best-effort: their D1 row is the authoritative record and any missing
   * chain entry is picked up by the reconciliation cron.
   */
  private async writeAudit(
    draft: AuditRowDraft,
    opts: { skipChainEmit?: boolean } = {},
  ): Promise<void> {
    try {
      await getDb(this.env.DB).insert(auditLog).values({
        id: draft.id,
        bidSessionId: draft.bidSessionId,
        seq: draft.seq,
        actorType: draft.actorType,
        actorId: draft.actorId,
        action: draft.action,
        targetKind: draft.targetKind,
        targetId: draft.targetId,
        beforeState: draft.beforeState,
        afterState: draft.afterState,
        reason: draft.reason,
        aiAdvisoryId: draft.aiAdvisoryId,
        clientMeta: draft.clientMeta,
        createdAt: draft.createdAt,
      });
    } catch (err) {
      // Audit failures must not break the DO state machine. The durable state
      // is the source of truth; failed audit writes are picked up by the
      // Plan 08 reconciliation job.
      console.error('[BidSessionDO] audit insert failed', err);
    }
    if (opts.skipChainEmit) return;
    try {
      await this.emitDraftToChain(draft);
    } catch (err) {
      console.error('[BidSessionDO] chain emit (best-effort) failed', err);
    }
  }

  /**
   * Plan 08 Task 21 — Look up the bid+member+position rows for an existing
   * D1 bid and enqueue the portal write-back. Returns silently when the
   * portal queue binding is absent (local/test).
   */
  private async enqueuePortalForBid(bidId: string): Promise<void> {
    if (!isPortalPublicationEnabled(this.env)) return;
    if (!this.env.PORTAL_QUEUE || typeof this.env.PORTAL_QUEUE.send !== 'function') return;
    const db = getDb(this.env.DB);
    const bid = await db.select().from(bids).where(eq(bids.id, bidId)).get();
    if (!bid) return;
    const session = await db
      .select({ isMock: bidSessions.isMock })
      .from(bidSessions)
      .where(eq(bidSessions.id, bid.bidSessionId))
      .get();
    if (!session || session.isMock) return;
    const member = await db.select().from(members).where(eq(members.id, bid.memberId)).get();
    if (!member) return;
    // Composite PK on positions means we have to fetch by id+template; since
    // only one active template is in use at a time we filter by id and pick
    // the first hit (Plan 03 invariant).
    const position = await db
      .select()
      .from(positions)
      .where(eq(positions.id, bid.positionId))
      .get();
    if (!position) return;
    const adminActor = bid.adminActorId
      ? ((await db.select().from(members).where(eq(members.id, bid.adminActorId)).get()) ?? null)
      : null;
    const payload = buildPortalPayload({
      bid: {
        id: bid.id,
        bidSessionId: bid.bidSessionId,
        memberId: bid.memberId,
        positionId: bid.positionId,
        aDay: bid.aDay,
        pickedAt: bid.pickedAt,
        forced: bid.forced,
        adminActorId: bid.adminActorId,
      },
      member: {
        id: member.id,
        employeeId: member.employeeId,
        rank: member.rank,
      },
      adminActor: adminActor ? { id: adminActor.id, employeeId: adminActor.employeeId } : null,
      position: {
        id: position.id,
        shift: position.shift,
        station: position.station,
        unit: position.unit,
      },
      bidYear: new Date().getUTCFullYear(),
    });
    await enqueuePortalWriteback({
      bidId: bid.id,
      employeeId: member.employeeId,
      payload,
      publicationEnabled: true,
      isMock: false,
      queue: this.env.PORTAL_QUEUE,
      insertQueueRow: async (row) => {
        await db.insert(portalWritebackQueue).values({
          id: row.id,
          bidId: row.bidId,
          enqueuedAt: row.enqueuedAt,
          nextAttemptAt: row.nextAttemptAt,
          attempts: row.attempts,
          status: row.status,
          payloadJson: row.payloadJson,
          lastError: row.lastError,
        });
      },
      now: () => Date.now(),
    });
  }

  /**
   * Plan 08 §D10 — strict variant for picks. Throws on R2 failure so the
   * caller can return pick_rejected. MUST be called BEFORE persisting the
   * new state — otherwise a successful pick will be unrecoverable if R2 is
   * down.
   */
  private async emitPickToChain(draft: AuditRowDraft): Promise<void> {
    const emitter = this.getEmitter();
    if (!emitter) return; // emitter disabled (no AUDIT_SIGNING_PRIVKEY) — degrade gracefully
    await emitter.emit(this.draftToEvent(draft));
    // W34 — arm the timeout flush. If the emit just triggered a threshold
    // flush (100 events), pendingSessions() is empty and we don't really
    // need an alarm — but we set it cheaply and the alarm() callback
    // will be a no-op via flushStale.
    await this.armAuditFlushAlarm();
  }

  private async emitDraftToChain(draft: AuditRowDraft): Promise<void> {
    const emitter = this.getEmitter();
    if (!emitter) return;
    await emitter.emit(this.draftToEvent(draft));
    await this.armAuditFlushAlarm();
  }

  private draftToEvent(draft: AuditRowDraft): AuditEvent {
    return {
      seq: draft.seq,
      bid_session_id: draft.bidSessionId,
      action: draft.action,
      actor_type: draft.actorType,
      actor_id: draft.actorId,
      target_kind: draft.targetKind ?? null,
      target_id: draft.targetId ?? null,
      before_state: draft.beforeState ?? null,
      after_state: draft.afterState ?? null,
      reason: draft.reason ?? null,
      ai_advisory_id: draft.aiAdvisoryId ?? null,
      client_meta: draft.clientMeta ?? null,
      created_at: draft.createdAt.toISOString(),
    };
  }

  /**
   * Returns the per-isolate ChainEmitter, or null if the audit-chain bindings
   * are not configured (e.g. unit tests with stub env). Constructed lazily so
   * DO instantiation does not fail when secrets are absent in local dev.
   */
  private getEmitter(): ChainEmitter | null {
    if (this.emitter) return this.emitter;
    if (!this.env.AUDIT_SIGNING_PRIVKEY || !this.env.AUDIT_SIGNING_PUBKEY) return null;
    if (!this.env.R2_AUDIT || typeof this.env.R2_AUDIT.put !== 'function') return null;
    this.emitter = new ChainEmitter({
      r2: this.env.R2_AUDIT,
      db: makeChainDb(this.env.DB),
      privKey: this.env.AUDIT_SIGNING_PRIVKEY,
      pubKey: this.env.AUDIT_SIGNING_PUBKEY,
      year: new Date().getUTCFullYear(),
      now: () => Date.now(),
    });
    return this.emitter;
  }

  /**
   * W34 — Arm a DO alarm to flush the audit chain in ~30s.
   *
   * Called after every `emitter.emit(...)` that buffers events (i.e. didn't
   * already trigger a threshold flush). The Worker-level 1-minute cron
   * can't reach per-DO emitter state, so we delegate stale-flush duty to
   * the DO itself.
   *
   * Best-effort: in unit tests `state.storage.setAlarm` doesn't exist on
   * the stubbed storage; we no-op silently. The threshold flush (100 events)
   * still works synchronously inside `emitter.emit`, so durability is
   * preserved even if the alarm path is unreachable.
   */
  private async armAuditFlushAlarm(): Promise<void> {
    const storage = this.state.storage as unknown as {
      setAlarm?: (whenMs: number) => Promise<void>;
      getAlarm?: () => Promise<number | null>;
    };
    if (typeof storage.setAlarm !== 'function') return;
    try {
      const desired = Date.now() + 30_000;
      const current = typeof storage.getAlarm === 'function' ? await storage.getAlarm() : null;
      // If an alarm is already pending and earlier than `desired`, keep it —
      // the existing alarm will fire first and re-arm if there's still work.
      if (current !== null && current <= desired) return;
      await storage.setAlarm(desired);
    } catch (err) {
      console.error('[BidSessionDO] setAlarm failed (best-effort)', err);
    }
  }

  /**
   * W34 — DO alarm callback. Cloudflare invokes this at the time we set via
   * `state.storage.setAlarm`. We flush any stale chunks (buffer age >= 30s)
   * and re-arm the alarm if there's still pending work waiting to age out.
   *
   * Safe to call repeatedly; `flushStale` is a no-op when no buffers have
   * crossed the timeout threshold.
   */
  async alarm(): Promise<void> {
    const emitter = this.getEmitter();
    if (!emitter) return;
    try {
      await emitter.flushStale();
    } catch (err) {
      console.error('[BidSessionDO] alarm flushStale failed', err);
    }
    // If anything still has pending events, re-arm so the next age-out gets
    // its flush. The chunker only flushes >=30s-old buffers, so the work
    // left here is "events buffered after the last alarm armed".
    if (emitter.pendingSessions().length > 0) {
      await this.armAuditFlushAlarm();
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/ws')) {
      return this.handleUpgrade(req);
    }
    if (url.pathname.endsWith('/snapshot')) {
      const state = await this.getState();
      return new Response(JSON.stringify(state), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/skip') {
      const body = (await req.json()) as SkipInput;
      const result = await this.adminSkip(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/force-pick') {
      const body = (await req.json()) as ForcePickInput;
      const result = await this.adminForcePick(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/freeze') {
      const body = (await req.json()) as FreezeInput;
      const result = await this.adminFreeze(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/commands/mock-freeze') {
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid_mock_freeze_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const parsed = MockFreezeCommandSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: 'invalid_mock_freeze_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const result = await this.adminMockFreezeCommand(parsed.data);
      return new Response(JSON.stringify(result), {
        status: result.kind === 'accepted' ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/submit-a-day-pick')) {
      const body = (await req.json()) as SubmitADayPickInput;
      const result = await this.submitADayPick(body);
      return new Response(JSON.stringify(result), {
        status: result.kind === 'accepted' ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/transition-to-phase-2')) {
      const body = (await req.json()) as TransitionToPhase2Input;
      const result = await this.transitionToPhase2(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/reset-mock')) {
      // Plan 09 / Rehearsal Tooling — Task R4. Wipes durable session state so
      // an admin can re-run a mock rehearsal from a clean slate without
      // destroying the audit chain.
      const reset = await this.resetMock();
      if (!reset) {
        return new Response(JSON.stringify({ error: 'canonical_reset_requires_new_epoch' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  /**
   * Plan 09 / Rehearsal Tooling — Task R4.
   *
   * Reset is intentionally disabled until a future audited reset-epoch command
   * can serialize it with canonical mock commands. A preflight-plus-delete
   * route is unsafe: a freeze may commit between those operations.
   */
  async resetMock(): Promise<boolean> {
    return false;
  }

  private async handleUpgrade(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const identity = parseVerifiedWebSocketIdentity(req.headers);
    if (identity === null) {
      return new Response('Forbidden', { status: 403 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    const clientId = ulid();

    server.addEventListener('message', async (ev) => {
      await this.onMessage(clientId, server, ev, identity);
    });
    server.addEventListener('close', () => {
      this.clients.delete(clientId);
    });
    server.addEventListener('error', () => {
      this.clients.delete(clientId);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(
    clientId: string,
    socket: WebSocket,
    ev: MessageEvent,
    identity: VerifiedWebSocketIdentity,
  ): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(String(ev.data));
    } catch {
      this.send(
        socket,
        this.envelope(
          'pick_rejected',
          {
            idempotencyKey: '00000000-0000-4000-8000-000000000000',
            code: 'PROTOCOL_ERROR',
            message: 'Invalid JSON',
          } satisfies PickRejectedEvent,
          0,
        ),
      );
      return;
    }
    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.send(
        socket,
        this.envelope(
          'pick_rejected',
          {
            idempotencyKey: '00000000-0000-4000-8000-000000000000',
            code: 'PROTOCOL_ERROR',
            message: parsed.error.message,
          } satisfies PickRejectedEvent,
          0,
        ),
      );
      return;
    }

    const msg = parsed.data;
    if (msg.type === 'hello') {
      // Never trust a client-provided identity or the hello JWT: the route
      // already verified the token and this identity crossed only the DO
      // service binding.
      this.clients.set(clientId, { socket, ...identity });
      const state = await this.getState();
      const snap: StateSnapshotEvent = {
        bidSessionId: state.bidSessionId,
        seq: state.lastSeq,
        currentPhase: state.currentPhase,
        currentBidderId: state.currentBidderId,
        turnStartedAtMs: state.turnStartedAtMs,
        turnTimerSeconds: state.turnTimerSeconds,
        frozenAt: state.frozenAt,
        fills: Object.entries(state.fills).map(([positionId, f]) => ({
          positionId,
          memberId: f.memberId,
          ordinal: f.ordinal,
        })),
        bidOrder: [...state.bidOrder],
      };
      this.send(socket, this.envelope('state_snapshot', snap, state.lastSeq));
      return;
    }

    if (msg.type === 'ping') {
      const state = await this.getState();
      this.send(socket, this.envelope('pong', { ts: msg.ts }, state.lastSeq));
      return;
    }

    if (msg.type === 'submit_pick') {
      await this.applySubmitPick(clientId, msg);
    }
  }

  private async applySubmitPick(
    clientId: string,
    msg: { positionId: string; aDay: string | null; idempotencyKey: string },
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    await this.state.blockConcurrencyWhile(async () => {
      const idemKey = `idem:${this.state.id.toString()}:${msg.idempotencyKey}`;
      const prior = await this.storage.get<IdempotencyRecord>(idemKey);
      if (prior) {
        this.send(client.socket, prior.envelope);
        return;
      }

      const state = await this.getState();
      const input: SubmitPickInput = {
        senderMemberId: client.memberId,
        positionId: msg.positionId,
        aDay: msg.aDay,
        idempotencyKey: msg.idempotencyKey,
      };
      const result = handleSubmitPick(state, this.handlerEnv(), input);

      let envelope: BidEventEnvelope;
      if (result.kind === 'accepted') {
        // Plan 08 §D10 — emit the R2 audit chunk BEFORE persisting durable
        // state. If R2 is unavailable we throw, the outer fetch handler
        // catches the error and the pick is rejected (the WS client sees
        // pick_rejected/AUDIT_UNAVAILABLE). This protects the legal-record
        // guarantee: every persisted pick has a chained R2 record.
        const pickDraft = auditEntryForPickMade({
          bidSessionId: result.event.payload.bidSessionId,
          seq: result.newState.lastSeq,
          bidId: result.event.payload.bidId,
          memberId: result.event.payload.memberId,
          positionId: result.event.payload.positionId,
          idempotencyKey: result.event.payload.idempotencyKey,
          nowMs: Date.now(),
        });
        try {
          await this.emitPickToChain(pickDraft);
        } catch (err) {
          console.error('[BidSessionDO] pick rejected — audit chain unavailable', err);
          envelope = this.envelope(
            'pick_rejected',
            {
              idempotencyKey: msg.idempotencyKey,
              code: 'AUDIT_UNAVAILABLE',
              message: 'Audit chain unavailable — pick rejected (Plan 08 §D10).',
            } satisfies PickRejectedEvent,
            state.lastSeq,
          );
          await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
          this.send(client.socket, envelope);
          return;
        }
        await persistBidSessionState(this.storage, result.newState);
        this.memoryState = result.newState;
        envelope = this.envelope('pick_made', result.event.payload, result.newState.lastSeq);
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        // D1 mirror — fire-and-forget; chain is already durable in R2.
        await this.writeAudit(pickDraft, { skipChainEmit: true });
        // Plan 08 Task 21 — enqueue portal write-back. Failures are
        // best-effort; reconciliation cron picks up unfinished rows.
        try {
          await this.enqueuePortalForBid(result.event.payload.bidId);
        } catch (err) {
          console.error('[BidSessionDO] portal enqueue failed (best-effort)', err);
        }
        this.broadcast(envelope);
      } else {
        envelope = this.envelope(
          'pick_rejected',
          {
            idempotencyKey: msg.idempotencyKey,
            code: result.code,
            message: result.message,
          } satisfies PickRejectedEvent,
          state.lastSeq,
        );
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        this.send(client.socket, envelope);
      }
    });
  }

  async adminSkip(input: SkipInput): Promise<{ ok: boolean; envelope?: BidEventEnvelope }> {
    return this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      const r = handleSkip(state, this.handlerEnv(), input);
      if (r.kind === 'rejected') {
        return { ok: false };
      }
      await persistBidSessionState(this.storage, r.newState);
      this.memoryState = r.newState;
      const envelope = this.envelope('skip', r.event.payload, r.newState.lastSeq);
      await this.writeAudit(
        auditEntryForSkip({
          bidSessionId: r.event.payload.bidSessionId,
          seq: r.newState.lastSeq,
          adminActorId: input.adminActorId,
          skippedMemberId: r.event.payload.skippedMemberId,
          reason: r.event.payload.reason,
          nowMs: Date.now(),
        }),
      );
      this.broadcast(envelope);
      return { ok: true, envelope };
    });
  }

  async adminForcePick(
    input: ForcePickInput,
  ): Promise<{ ok: boolean; envelope?: BidEventEnvelope }> {
    return this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      const r = handleForcePick(state, this.handlerEnv(), input);
      if (r.kind === 'rejected') {
        return { ok: false };
      }
      // Plan 08 §D10 — strict chain emit BEFORE persist so a forced pick
      // is never silently un-mirrored to R2.
      const forcedDraft = auditEntryForForcedPick({
        bidSessionId: r.event.payload.bidSessionId,
        seq: r.newState.lastSeq,
        bidId: r.event.payload.bidId,
        adminActorId: input.adminActorId,
        targetMemberId: r.event.payload.memberId,
        positionId: r.event.payload.positionId,
        reason: r.event.payload.reason,
        nowMs: Date.now(),
      });
      try {
        await this.emitPickToChain(forcedDraft);
      } catch (err) {
        console.error('[BidSessionDO] force-pick rejected — audit chain unavailable', err);
        return { ok: false };
      }
      await persistBidSessionState(this.storage, r.newState);
      this.memoryState = r.newState;
      const envelope = this.envelope('forced_pick', r.event.payload, r.newState.lastSeq);
      await this.writeAudit(forcedDraft, { skipChainEmit: true });
      this.broadcast(envelope);
      return { ok: true, envelope };
    });
  }

  async adminFreeze(input: FreezeInput): Promise<{ ok: boolean; envelope?: BidEventEnvelope }> {
    return this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      const r = handleFreeze(state, this.handlerEnv(), input);
      if (r.kind === 'rejected') {
        return { ok: false };
      }
      await persistBidSessionState(this.storage, r.newState);
      this.memoryState = r.newState;
      const envelope = this.envelope('freeze', r.event.payload, r.newState.lastSeq);
      await this.writeAudit(
        auditEntryForFreeze({
          bidSessionId: r.event.payload.bidSessionId,
          seq: r.newState.lastSeq,
          adminActorId: input.adminActorId,
          reason: r.event.payload.reason,
          nowMs: Date.now(),
        }),
      );
      this.broadcast(envelope);
      return { ok: true, envelope };
    });
  }

  /**
   * Rehearsal-only canonical command proof. The named DO supplies ordering,
   * while D1 atomically owns the state/receipt/event/audit/outbox bundle. DO
   * storage is only a reconstructible local projection after that commit.
   */
  async adminMockFreezeCommand(command: MockFreezeCommand): Promise<MockFreezeCommandResult> {
    return this.state.blockConcurrencyWhile(async () => {
      const localState = await this.getState();
      const namedSessionId = this.namedSessionId();
      if (command.bidSessionId !== namedSessionId) {
        return {
          kind: 'rejected',
          commandId: command.commandId,
          code: 'SESSION_ID_MISMATCH',
          currentSeq: localState.lastSeq,
        };
      }
      const commit = await commitMockFreezeCommand({
        db: this.env.DB,
        command,
        state: localState,
        // This durable marker is written immediately before the D1 batch. If
        // projection fails after an accepted batch, future snapshots/reconnects
        // know to rebuild from D1 without making legacy sessions D1-dependent.
        beforeD1Commit: () => this.markCanonicalMockIntent(),
      });
      const canonicalState =
        commit.canonicalState ??
        (await loadCanonicalBidSessionState(this.env.DB, this.namedSessionId()));
      if (canonicalState === null) {
        // A confirmed no-commit must not convert this DO into a D1-dependent
        // session. An exception above deliberately leaves the pending marker
        // intact because the D1 outcome is then unknown.
        await this.clearCanonicalMockIntent();
        return commit.result;
      }
      await this.activateCanonicalMockIntent();

      const projection = this.projectCanonicalState(canonicalState);
      // If this write is interrupted, D1 still has the accepted command and a
      // later hibernation/retry rebuilds this projection from that authority.
      await persistBidSessionState(this.storage, projection);
      this.memoryState = projection;
      if (commit.result.kind === 'accepted') {
        this.broadcast(commit.result.envelope);
        this.scheduleCanonicalAuditArchive();
      }
      return commit.result;
    });
  }

  async initSession(input: {
    bidOrder: BidSessionState['bidOrder'];
    turnTimerSeconds: number;
  }): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      if (state.currentPhase !== 'config') {
        return;
      }
      const first = input.bidOrder[0]?.memberId ?? null;
      const newState: BidSessionState = {
        ...state,
        bidOrder: input.bidOrder,
        queueCursor: 0,
        currentBidderId: first,
        currentPhase: first === null ? 'complete' : 'position_bid',
        turnTimerSeconds: input.turnTimerSeconds,
        turnStartedAtMs: first === null ? 0 : Date.now(),
        lastSeq: state.lastSeq + 1,
      };
      await persistBidSessionState(this.storage, newState);
      this.memoryState = newState;
    });
  }

  /**
   * Plan 07: transition the DO from `position_bid` to `a_day_bid`.
   * Caller (admin route or auto-detect job) supplies the Phase 1 results and
   * member roster. Atomic via blockConcurrencyWhile.
   */
  async transitionToPhase2(input: TransitionToPhase2Input): Promise<{ ok: boolean }> {
    return this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      if (state.frozenAt !== null) {
        return { ok: false };
      }
      if (state.currentPhase !== 'position_bid' && state.currentPhase !== 'paused') {
        return { ok: false };
      }
      const nowMs = Date.now();
      const newState = transitionToPhase2(state, input, nowMs);
      await persistBidSessionState(this.storage, newState);
      this.memoryState = newState;
      const envelope = this.envelope(
        'phase_changed',
        {
          from: state.currentPhase,
          to: newState.currentPhase,
          bidOrderPhase2: newState.aDay?.bidOrder ?? [],
        },
        newState.lastSeq,
      );
      this.broadcast(envelope);
      return { ok: true };
    });
  }

  /**
   * Plan 07: apply a Phase-2 A-Day pick (normal member submission OR admin force).
   * Mirrors applySubmitPick from Phase 1 — persist before broadcast, idempotent
   * via storage-keyed prior envelope.
   */
  async submitADayPick(input: SubmitADayPickInput): Promise<SubmitADayPickResult> {
    return this.state.blockConcurrencyWhile(async () => {
      const idemKey = `idem-aday:${this.state.id.toString()}:${input.idempotencyKey}`;
      const prior = await this.storage.get<IdempotencyRecord>(idemKey);
      if (prior) {
        // Replay the prior envelope to the caller via broadcast for parity, but
        // return a synthesized "accepted-like" result. For correctness we just
        // re-broadcast and let the caller treat this as a no-op.
        this.broadcast(prior.envelope);
        return {
          kind: 'rejected',
          code: 'ALREADY_PICKED',
          message: 'Idempotency key already used.',
          idempotencyKey: input.idempotencyKey,
        };
      }
      const state = await this.getState();
      const nowMs = Date.now();
      const result = handleSubmitADayPick(state, input, nowMs);
      if (result.kind === 'rejected') {
        return result;
      }
      await persistBidSessionState(this.storage, result.newState);
      this.memoryState = result.newState;
      const envelope = this.envelope(
        result.pick.forced ? 'forced_a_day_pick_made' : 'a_day_pick_made',
        {
          memberId: result.pick.memberId,
          shift: result.pick.shift,
          aDay: result.pick.aDay,
          pickedAtMs: result.pick.pickedAtMs,
          forced: result.pick.forced,
          adminActorId: result.pick.adminActorId,
          nextMemberId: result.nextMemberId,
        },
        result.newState.lastSeq,
      );
      await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
      this.broadcast(envelope);
      // If Phase 2 just completed, also broadcast phase_changed.
      if (result.newState.currentPhase === 'complete') {
        this.broadcast(
          this.envelope(
            'phase_changed',
            { from: 'a_day_bid', to: 'complete' },
            result.newState.lastSeq,
          ),
        );
      }
      return result;
    });
  }
}
