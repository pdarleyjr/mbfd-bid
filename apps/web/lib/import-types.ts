export type ImportError = {
  rowNumber: number;
  raw: unknown;
  message: string;
};

export type ImportResult =
  | {
      inserted: number;
      updated: number;
      errors: ImportError[];
    }
  | { error: string };
