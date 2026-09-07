export const STATIONS = ['marine', 'trt', 'de', 'air-tech', 'captain-5', 'days'] as const;
export type Station = (typeof STATIONS)[number];
const TITLES: Record<Station, string> = {
  marine: 'Marine credential filter',
  trt: 'TRT credential filter',
  de: 'Driver / Engineer credential filter',
  'air-tech': 'Air Technician credential filter',
  'captain-5': 'Legacy Captain 5 filter',
  days: 'Historical 2025 Days filter',
};
export const LEGACY_ROSTER_FILTER_NOTICE =
  'Legacy roster filter only. This is not annual Bid eligibility and does not verify current qualifications, applicable policy, or participation. Use the designated annual plan or frozen session for eligibility.';
export function stationTitle(station: Station) {
  return TITLES[station];
}
export function stationRuleText(_station: Station) {
  return LEGACY_ROSTER_FILTER_NOTICE;
}
