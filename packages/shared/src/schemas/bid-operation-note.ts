import { z } from 'zod';

/**
 * An operator may add context without slowing a Bid action down. Keep the
 * machine action, actor and before/after audit evidence independent of this
 * optional human note. Omitted notes are stored as empty text; the server
 * must not invent a rationale on the operator's behalf.
 */
export const BidOperationNoteSchema = z.string().trim().max(500).default('');

/**
 * Canonical command receipts hash the parsed request. These envelopes
 * historically preserved whitespace, so retain those exact bytes when an old
 * command is retried. New operator forms already trim their optional notes.
 */
export const BidCommandNoteSchema = z.string().max(500).default('');
