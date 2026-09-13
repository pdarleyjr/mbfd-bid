import base from './playwright.config';

/** Run authoritative 521-member Blueprint impact checks independently. The
 * single worker prevents concurrent in-memory Worker evaluations from masking
 * a correct result as a timeout. */
export default {
  ...base,
  fullyParallel: false,
  grep: /\[bid-impact\]/,
  grepInvert: undefined,
  workers: 1,
};
