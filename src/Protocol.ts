export interface SimpleDiagnostic {
  filePath: string | null;
  start: number | null;
  end: number | null;
  message: string;
  code: number;
}

export const SERVER_ID = 'ts-expose-status-plugin-server';
export const CALL_EVENT = 'call';
export const RESPOND_EVENT = 'respond';
