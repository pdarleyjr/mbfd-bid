import {
  BID_EVENT_VERSION,
  type BidEventEnvelope,
  ClientMessageSchema,
  type PickRejectedEvent,
  type StateSnapshotEvent,
} from '@mbfd/shared';
import { ulid } from 'ulid';
import { getDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import {
  type AuditRowDraft,
  auditEntryForForcedPick,
  auditEntryForFreeze,
  auditEntryForPickMade,
  auditEntryForSkip,
} from '../lib/audit.js';
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

export class BidSessionDO implements DurableObject {
  private state: DurableObjectState;
  private env: WorkerEnv;
  private clients = new Map<string, ConnectedClient>();
  private memoryState: BidSessionState | null = null;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state;
    this.env = env;
  }

  private get storage(): DOStorageLike {
    return this.state.storage as unknown as DOStorageLike;
  }

  private async getState(): Promise<BidSessionState> {
    if (!this.memoryState) {
      const id = this.state.id.toString();
      this.memoryState = await loadBidSessionState(this.storage, id);
      if (this.memoryState.bidSessionId !== id) {
        this.memoryState = emptyBidSessionState(id);
      }
    }
    return this.memoryState;
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

  private send(socket: WebSocket, env: BidEventEnvelope): void {
    try {
      socket.send(JSON.stringify(env));
    } catch {}
  }

  private async writeAudit(draft: AuditRowDraft): Promise<void> {
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
    return new Response('Not Found', { status: 404 });
  }

  private async handleUpgrade(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    const clientId = ulid();

    server.addEventListener('message', async (ev) => {
      await this.onMessage(clientId, server, ev);
    });
    server.addEventListener('close', () => {
      this.clients.delete(clientId);
    });
    server.addEventListener('error', () => {
      this.clients.delete(clientId);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(clientId: string, socket: WebSocket, ev: MessageEvent): Promise<void> {
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
      this.clients.set(clientId, { socket, memberId: 0, role: 'member' });
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
        await persistBidSessionState(this.storage, result.newState);
        this.memoryState = result.newState;
        envelope = this.envelope('pick_made', result.event.payload, result.newState.lastSeq);
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        await this.writeAudit(
          auditEntryForPickMade({
            bidSessionId: result.event.payload.bidSessionId,
            seq: result.newState.lastSeq,
            bidId: result.event.payload.bidId,
            memberId: result.event.payload.memberId,
            positionId: result.event.payload.positionId,
            idempotencyKey: result.event.payload.idempotencyKey,
            nowMs: Date.now(),
          }),
        );
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
      await persistBidSessionState(this.storage, r.newState);
      this.memoryState = r.newState;
      const envelope = this.envelope('forced_pick', r.event.payload, r.newState.lastSeq);
      await this.writeAudit(
        auditEntryForForcedPick({
          bidSessionId: r.event.payload.bidSessionId,
          seq: r.newState.lastSeq,
          bidId: r.event.payload.bidId,
          adminActorId: input.adminActorId,
          targetMemberId: r.event.payload.memberId,
          positionId: r.event.payload.positionId,
          reason: r.event.payload.reason,
          nowMs: Date.now(),
        }),
      );
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
