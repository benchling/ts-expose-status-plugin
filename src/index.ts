import {IPC} from 'node-ipc';
import * as ts_module from "typescript/lib/tsserverlibrary";

import {CALL_EVENT, SERVER_ID, SimpleDiagnostic} from './Protocol';
import {resolve} from "path";

function init(modules: {typescript: typeof ts_module}): ts.server.PluginModule {
  const ts = modules.typescript;
  function create(info: ts.server.PluginCreateInfo): ts_module.LanguageService {
    const ipc = new IPC();
    ipc.config.id = SERVER_ID;
    // We MUST silence logging, or else node-ipc will print to stdout. VSCode talks with the TS
    // language service over stdin/stdout, so any extraneous messages to stdout will break VSCode's
    // normal code intelligence features.
    ipc.config.silent = true;

    function log(s: string): void {
      info.project.projectService.logger.info(s);
    }

    function logError(s: string): void {
      info.project.projectService.logger.msg(s, ts.server.Msg.Err);
    }

    function convertToSimpleDiagnostic(diagnostic: ts.Diagnostic): SimpleDiagnostic {
      return {
        filePath: diagnostic.file ? resolve(diagnostic.file.fileName) : null,
        start: diagnostic.start != null ? diagnostic.start : null,
        end:
          diagnostic.start != null && diagnostic.length != null ? diagnostic.start + diagnostic.length : null,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        code: diagnostic.code,
      };
    }

    function getAllErrors(): Array<SimpleDiagnostic> {
      const program = info.languageService.getProgram();
      if (!program) {
        return [];
      }
      // Ignore other diagnostic types for now, since they tend to not correspond to typical TS errors.
      const tsDiagnostics = [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
      return tsDiagnostics.map((diagnostic) => convertToSimpleDiagnostic(diagnostic));
    }

    function getErrorsForFiles(filenames: Array<string>): Array<SimpleDiagnostic> {
      const diagnostics = [];
      for (const filename of filenames) {
        // Ignore other diagnostic types for now, since they tend to not correspond to typical TS errors.
        const tsDiagnostics = [
          ...info.languageService.getSemanticDiagnostics(filename),
          ...info.languageService.getSyntacticDiagnostics(filename),
        ];
        diagnostics.push(...tsDiagnostics.map((diagnostic) => convertToSimpleDiagnostic(diagnostic)));
      }
      return diagnostics;
    }

    log('Starting ts-expose-status-plugin server');
    ipc.serve(() => {
      ipc.server.on(CALL_EVENT, (data, socket) => {
        log(`Received method call: ${data.method}`);
        let response;
        try {
          if (data.method === 'getAllErrors') {
            response = getAllErrors();
          } else if (data.method === 'getErrorsForFiles') {
            response = getErrorsForFiles(data.filenames);
          } else {
            const errorMsg = `Unexpected method: ${data.method}`;
            logError(errorMsg);
            response = errorMsg;
          }
        } catch (e) {
          response = e.message;
        }
        ipc.server.emit(socket, 'respond', response);
      });
    });
    ipc.server.start();

    return info.languageService;
  }
  return {create};
}

export = init;
