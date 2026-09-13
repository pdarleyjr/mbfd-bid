import { DepartmentPeopleWorkspace } from './people/DepartmentPeopleWorkspace';

export const dynamic = 'force-dynamic';

export default function DepartmentPage() {
  const initialDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return <DepartmentPeopleWorkspace initialDate={initialDate} />;
}
