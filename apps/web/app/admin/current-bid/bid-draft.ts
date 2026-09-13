import { type BidDefinitionContent, BidDefinitionContentSchema } from '@mbfd/shared';
import { z } from 'zod';
import { BidExpectedSchema, BidMockRequestSchema, CurrentBidSchema } from './bid-client';

/** Browser drafts may contain incomplete text or temporarily invalid ranges.
 * Preserve only the known schema shape. This is never used for API validation,
 * policy interpretation, readiness, content hashing, or execution authority. */
export function draftShape(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return draftShape(schema.innerType());
  if (schema instanceof z.ZodString) return z.string();
  if (schema instanceof z.ZodNumber) return z.number().finite();
  if (schema instanceof z.ZodObject)
    return z
      .object(
        Object.fromEntries(
          Object.entries(schema.shape).map(([key, value]) => [
            key,
            draftShape(value as z.ZodTypeAny),
          ]),
        ),
      )
      .strict();
  if (schema instanceof z.ZodArray) return z.array(draftShape(schema.element));
  if (schema instanceof z.ZodOptional) return draftShape(schema.unwrap()).optional();
  if (schema instanceof z.ZodNullable) return draftShape(schema.unwrap()).nullable();
  if (schema instanceof z.ZodDefault) return draftShape(schema.removeDefault());
  if (schema instanceof z.ZodDiscriminatedUnion)
    return z.union(
      schema.options.map(draftShape) as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
    );
  if (schema instanceof z.ZodUnion) return z.union(schema.options.map(draftShape));
  if (schema instanceof z.ZodTuple)
    return z.tuple(schema.items.map(draftShape) as [z.ZodTypeAny, ...z.ZodTypeAny[]]);
  if (schema instanceof z.ZodRecord)
    return z.record(schema.keySchema, draftShape(schema.valueSchema));
  return schema;
}
export const BidDraftContentSchema = draftShape(
  BidDefinitionContentSchema,
) as z.ZodType<BidDefinitionContent>;
export const PendingBidWriteSchema = z.discriminatedUnion('path', [
  z
    .object({
      path: z.literal('mock-sessions'),
      key: z.string().uuid(),
      body: BidMockRequestSchema,
    })
    .strict(),
  z
    .object({
      path: z.literal('versions'),
      key: z.string().uuid(),
      body: z
        .object({ expected: BidExpectedSchema, content: BidDraftContentSchema, reason: z.string() })
        .strict(),
    })
    .strict(),
  z
    .object({
      path: z.literal('restore'),
      key: z.string().uuid(),
      body: z
        .object({ expected: BidExpectedSchema, versionId: z.string().min(1), reason: z.string() })
        .strict(),
    })
    .strict(),
]);
export type PendingBidWrite = z.infer<typeof PendingBidWriteSchema>;
export const BidDraftSchema = z
  .object({
    v: z.literal(1),
    actorScope: z.string(),
    year: z.number().int(),
    base: CurrentBidSchema,
    content: BidDraftContentSchema,
    reason: z.string(),
    pending: PendingBidWriteSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.year !== value.base.bidYear ||
      value.year !== value.content.bidYear ||
      (value.pending?.path === 'versions' && value.pending.body.content.bidYear !== value.year)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The draft belongs to another Bid year.',
      });
    }
  });
export type BidDraft = z.infer<typeof BidDraftSchema>;
export function bidDraftKey(actorScope: string, year: number) {
  return `mbfd-current-bid:v1:${encodeURIComponent(actorScope)}:${year}`;
}
export function preserveBidDraft(storage: Storage, draft: BidDraft) {
  const parsed = BidDraftSchema.parse(draft);
  const key = bidDraftKey(parsed.actorScope, parsed.year);
  const serialized = JSON.stringify(parsed);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized)
    throw new Error('The browser did not preserve the complete Bid draft.');
}
export function readBidDraft(storage: Storage, actorScope: string, year: number): BidDraft | null {
  const raw = storage.getItem(bidDraftKey(actorScope, year));
  if (raw === null) return null;
  const value = BidDraftSchema.parse(JSON.parse(raw));
  if (value.actorScope !== actorScope || value.year !== year)
    throw new Error('The saved draft belongs to another administrator or Bid.');
  return value;
}
