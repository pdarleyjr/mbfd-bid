import { type LoginResponse, LoginResponseSchema } from '@mbfd/shared';

export interface VerifyCredentialsInput {
  portalBaseUrl: string;
  token: string;
  employee_id: string;
  password: string;
}

export async function verifyCredentials(
  input: VerifyCredentialsInput,
): Promise<LoginResponse | null> {
  const url = `${input.portalBaseUrl}/api/v2/verify-credentials`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
      'User-Agent': 'mbfd-bid-worker/1.0',
    },
    body: JSON.stringify({
      employee_id: input.employee_id,
      password: input.password,
    }),
  });

  if (res.status === 401) return null;
  if (res.status >= 500) throw new Error('portal_unavailable');
  if (!res.ok) throw new Error(`portal_error_${res.status}`);

  const json = (await res.json()) as unknown;
  return LoginResponseSchema.parse(json);
}
