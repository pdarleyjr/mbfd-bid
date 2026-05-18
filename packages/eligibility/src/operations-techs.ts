export interface OpTechPair {
  ops: string;
  tech: string;
}

export const OP_TECH_PAIRS: readonly OpTechPair[] = [
  {
    ops: 'Hazardous Materials Operations',
    tech: 'State Certified Hazardous Materials Technician',
  },
  {
    ops: 'Rope Rescue Operations',
    tech: 'Rope Rescue Technician',
  },
  {
    ops: 'Confined Space Operations',
    tech: 'Confined Space Technician',
  },
  {
    ops: 'Structural Collapse Operations',
    tech: 'Structural Collapse Technician',
  },
  {
    ops: 'Trench Rescue Operations',
    tech: 'Trench Rescue Technician',
  },
  {
    ops: 'Vehicle & Machinery Rescue Operations',
    tech: 'Vehicle & Machinery Rescue Technician',
  },
] as const;

export function opCredNames(): string[] {
  return OP_TECH_PAIRS.map((p) => p.ops);
}

export function techCredNames(): string[] {
  return OP_TECH_PAIRS.map((p) => p.tech);
}

export function opsForTech(techName: string): string | undefined {
  return OP_TECH_PAIRS.find((p) => p.tech === techName)?.ops;
}

export function holdsAllOps(credentialNames: ReadonlySet<string>): boolean {
  return OP_TECH_PAIRS.every((p) => credentialNames.has(p.ops));
}
