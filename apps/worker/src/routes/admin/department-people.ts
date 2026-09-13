import type { DepartmentEmploymentStatus, JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';

import {
  DepartmentPeopleError,
  loadDepartmentPeople,
  loadDepartmentPerson,
} from '../../lib/department-people.js';
import { operationalDate } from '../../lib/operational-date.js';
import { EMPLOYMENT_STATUSES, isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
router.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
router.onError((error, c) => {
  if (error instanceof DepartmentPeopleError) return c.json({ error: error.code }, error.status);
  throw error;
});

function positiveInteger(value: string, error: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new DepartmentPeopleError(error, 400);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new DepartmentPeopleError(error, 400);
  return number;
}

router.get('/people', async (c) => {
  const asOf = c.req.query('as_of') ?? operationalDate();
  if (!isIsoCalendarDate(asOf)) throw new DepartmentPeopleError('invalid_as_of', 400);
  const employmentStatus = c.req.query('employment_status');
  if (
    employmentStatus !== undefined &&
    !(EMPLOYMENT_STATUSES as readonly string[]).includes(employmentStatus)
  ) {
    throw new DepartmentPeopleError('invalid_employment_status', 400);
  }
  const projection = await loadDepartmentPeople(c.env.DB, {
    asOf,
    page: positiveInteger(c.req.query('page') ?? '1', 'invalid_page'),
    pageSize: positiveInteger(c.req.query('page_size') ?? '50', 'invalid_page_size'),
    search: c.req.query('q') ?? '',
    ...(employmentStatus === undefined
      ? {}
      : { employmentStatus: employmentStatus as DepartmentEmploymentStatus }),
  });
  return c.json(projection);
});

router.get('/people/:id', async (c) => {
  const memberId = positiveInteger(c.req.param('id'), 'invalid_member_id');
  const asOf = c.req.query('as_of') ?? operationalDate();
  if (!isIsoCalendarDate(asOf)) throw new DepartmentPeopleError('invalid_as_of', 400);
  return c.json(await loadDepartmentPerson(c.env.DB, memberId, asOf));
});

export default router;
