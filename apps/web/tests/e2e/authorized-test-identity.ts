import { existsSync } from 'node:fs';

export const PENDING_AUTHORIZED_TEST_IDENTITY = 'PENDING_AUTHORIZED_TEST_IDENTITY';

type StorageStatePaths<T extends readonly string[]> = {
  -readonly [Key in keyof T]: string;
};

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns an explicitly supplied member JWT only when the test runner also has
 * the corresponding server signing key. This intentionally never creates a
 * credential or falls back to a synthetic test key.
 */
export function authorizedJwt(environmentName: string): string | null {
  const signingKey = process.env.JWT_SIGNING_KEY;
  const jwt = process.env[environmentName];
  return hasValue(signingKey) && hasValue(jwt) ? jwt : null;
}

/**
 * An authenticated storage state must be supplied by the controlled test
 * environment. Existence is checked without opening or copying its contents.
 */
export function authorizedStorageState(environmentName: string): string | null {
  const signingKey = process.env.JWT_SIGNING_KEY;
  const statePath = process.env[environmentName];
  return hasValue(signingKey) && hasValue(statePath) && existsSync(statePath) ? statePath : null;
}

/**
 * The multi-member cycle uses explicitly supplied, pre-provisioned storage
 * states instead of synthesizing identities inside the test process.
 */
export function authorizedStorageStates<const T extends readonly string[]>(
  environmentNames: T,
): StorageStatePaths<T> | null {
  if (!hasValue(process.env.JWT_SIGNING_KEY)) return null;

  const statePaths: string[] = [];
  for (const environmentName of environmentNames) {
    const statePath = process.env[environmentName];
    if (!hasValue(statePath)) return null;
    statePaths.push(statePath);
  }

  return statePaths.every((statePath) => existsSync(statePath))
    ? (statePaths as StorageStatePaths<T>)
    : null;
}
