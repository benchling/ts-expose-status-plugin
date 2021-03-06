import NodeIPC from 'node-ipc';
import {resolve} from 'path';

import {CALL_EVENT, RESPOND_EVENT, SERVER_ID, SimpleDiagnostic} from './Protocol';

// The node-ipc types don't export its class types, but we can still hack them out.
type IPC = InstanceType<typeof NodeIPC.IPC>;
type NodeIPCServer = typeof NodeIPC.server;
type NodeIPCClient = ReturnType<NodeIPCServer['emit']>;

/**
 * Client code for communicating with ts-expose-status-plugin.
 *
 * This client exposes async methods for interfacing with the TS language service. With the current
 * implementation, only one simultaneous method call is allowed.
 */
export default class TSStatusClient {
  // tslint:disable-next-line no-any
  private responseCallback: ((response: any) => void) | null = null;

  private constructor(readonly ipc: IPC, readonly connection: NodeIPCClient) {
    // tslint:disable-next-line no-any
    this.connection.on(RESPOND_EVENT, (data: any) => {
      if (this.responseCallback == null) {
        throw new Error('Expected response callback to be set');
      }
      const callback = this.responseCallback;
      this.responseCallback = null;
      callback(data);
    });
  }

  static async withClient<T>({
    onSuccess,
    onError,
  }: {
    onSuccess: (client: TSStatusClient) => Promise<T>;
    onError: (e: Error) => Promise<T>;
  }): Promise<T> {
    let client;
    try {
      client = await this.connect();
    } catch (e) {
      return onError(e);
    }
    let result;
    try {
      result = await onSuccess(client);
    } finally {
      client.disconnect();
    }
    return result;
  }

  private static connect(): Promise<TSStatusClient> {
    return new Promise((resolvePromise, rejectPromise) => {
      const ipc = new NodeIPC.IPC();
      ipc.config.id = 'ts-expose-status-plugin-client';
      ipc.config.silent = true;
      // Don't retry, since it's likely that a language service just isn't running.
      // maxRetries has a bad TS type, so work around using any.
      // tslint:disable-next-line no-any
      (ipc.config.maxRetries as any) = 0;
      ipc.connectTo(SERVER_ID, () => {
        const connection = ipc.of[SERVER_ID];
        connection.on('error', (e: Error) => {
          rejectPromise(e);
        });
        connection.on('connect', () => {
          resolvePromise(new TSStatusClient(ipc, connection));
        });
      });
    });
  }

  private disconnect(): void {
    this.ipc.disconnect(SERVER_ID);
  }

  getAllErrors(): Promise<Array<SimpleDiagnostic>> {
    return this.call({method: 'getAllErrors'});
  }

  getErrorsForFiles(filenames: Array<string>): Promise<Array<SimpleDiagnostic>> {
    // We can't rely on the working directory of the TS language service, so make sure to convert
    // all filenames to absolute! If we don't do this, TSLint ends up not returning any errors.
    const absoluteFilenames = filenames.map((filename) => resolve(filename));
    return this.call({method: 'getErrorsForFiles', filenames: absoluteFilenames});
  }

  // tslint:disable-next-line no-any
  private async call(payload: any): Promise<any> {
    if (this.responseCallback != null) {
      throw new Error('Expected responseCallback to be unset. May only make one concurrent call.');
    }
    const response = await new Promise((resolvePromise) => {
      this.responseCallback = resolvePromise;
      this.connection.emit(CALL_EVENT, payload);
    });
    if (typeof response === 'string') {
      throw new Error(`Error from TS language service: ${response}`);
    }
    return response;
  }
}
