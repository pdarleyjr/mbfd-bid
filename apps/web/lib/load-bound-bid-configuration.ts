import {
  type BidConfiguration,
  type BoundToolSearchParams,
  type BoundToolSelection,
  isBoundBidConfiguration,
  parseBoundToolSelection,
  selectionMatchesConfiguration,
} from './bid-configuration-selection';
import { serverWorkerFetch } from './server-worker-fetch';

export type BoundBidConfigurationResult =
  | {
      selection: BoundToolSelection;
      configuration: BidConfiguration & {
        ruleBookVersion: string;
        positionTemplateVersion: string;
      };
      error: null;
    }
  | { selection: null; configuration: null; error: string };

/**
 * Re-loads the annual configuration named by a Bid Setup link. A downstream
 * tool may not silently use a different (including merely newer) draft.
 */
export async function loadBoundBidConfiguration(
  searchParams: BoundToolSearchParams,
): Promise<BoundBidConfigurationResult> {
  const selection = parseBoundToolSelection(searchParams);
  if (selection === null) {
    return {
      selection: null,
      configuration: null,
      error:
        'Open this tool from Bid Setup. A complete year, rule-book, template, and configuration revision are required.',
    };
  }

  try {
    const response = await serverWorkerFetch(`/api/admin/bid-configuration/${selection.year}`);
    if (response.status === 404) {
      return {
        selection: null,
        configuration: null,
        error: `Bid year ${selection.year} no longer has a designated configuration.`,
      };
    }
    if (!response.ok) {
      return {
        selection: null,
        configuration: null,
        error: `Could not verify the selected configuration (${response.status}).`,
      };
    }

    const body = (await response.json()) as { configuration?: BidConfiguration };
    const configuration = body.configuration ?? null;
    if (!isBoundBidConfiguration(configuration)) {
      return {
        selection: null,
        configuration: null,
        error: `Bid year ${selection.year} does not have a complete designated configuration.`,
      };
    }
    if (!selectionMatchesConfiguration(selection, configuration)) {
      return {
        selection: null,
        configuration: null,
        error:
          'The selected configuration changed after this link was created. Return to Bid Setup and review the current designation before continuing.',
      };
    }
    return { selection, configuration, error: null };
  } catch (caught) {
    return {
      selection: null,
      configuration: null,
      error:
        caught instanceof Error ? caught.message : 'Could not verify the selected configuration.',
    };
  }
}
