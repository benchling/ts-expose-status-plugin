export interface SimpleDiagnostic {
  filePath: string | null;
  start: number | null;
  end: number | null;
  message: string;
  code: number;
}
