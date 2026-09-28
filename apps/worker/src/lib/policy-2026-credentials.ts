/** Policy terms bound to existing stable catalog names after live catalog
 * review. A binding identifies the definition; each member still needs
 * effective, valid evidence. */
export const POLICY_2026_EXISTING_CREDENTIAL_BINDINGS = [
  { term: 'IAAI-CFI', name: 'Certified Fire Investigator (IAAI-CFI)', source: 'Procedure 3(e)' },
  { term: 'NFPA 1123', name: 'NFPA1123 Outdoor Fireworks', source: 'Procedure 3(b)' },
  { term: 'NFPA 1126', name: 'NFPA1126 Indoor Pyrotechnics', source: 'Procedure 3(b)' },
  { term: 'RN 8312', name: 'RN8312 Assembly Occupancies', source: 'Procedure 3(b)' },
  { term: 'RN 8313', name: 'Crowd Manager Certificate (RN8313)', source: 'Procedure 3(b)' },
  {
    term: 'RN8977 I',
    name: 'RN8977 Youth Fire Setter Prevention and Intervention course I',
    source: 'Procedure 3(c)',
  },
  {
    term: 'RN8977 II',
    name: 'RN8977 Youth Fire Setter Prevention and Intervention course II',
    source: 'Procedure 3(c)',
  },
  { term: 'DRI Public Safety Diver', name: 'DRI Public Safety Diver', source: 'Procedure 8(a-f)' },
  {
    term: 'PADI Public Safety Diver',
    name: 'PADI Public Safety Diver',
    source: 'Procedure 8(a-f)',
  },
] as const;

/** These precise evidence types were absent from the reviewed live catalog.
 * Creating them grants no member qualification or inferred alias. */
export const POLICY_2026_CREDENTIALS = [
  { name: 'Valid OUPV / Six Pack Authority', source: 'Procedure 8(a-e)' },
  { name: 'Passing IADRS Watermanship Test', source: 'Procedure 8(a-e)' },
] as const;

export const MARINE_OUPV_AUTHORITY = 'Valid OUPV / Six Pack Authority';
export const MARINE_PASSING_WATERMANSHIP = 'Passing IADRS Watermanship Test';
export const MARINE_PSD_DRI = 'DRI Public Safety Diver';
export const MARINE_PSD_PADI = 'PADI Public Safety Diver';
