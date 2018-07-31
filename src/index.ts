import {IPC} from 'node-ipc';
import {LanguageService} from 'typescript/lib/tsserverlibrary';

import {SimpleDiagnostic} from './Protocol';

function init(): ts.server.PluginModule {
  function create(info: ts.server.PluginCreateInfo): LanguageService {
    const ipc = new IPC();
    ipc.config.id = 'ts-expose-status-plugin-server';
    // We MUST silence logging, or else node-ipc will print to stdout. VSCode talks with the TS
    // language service over stdin/stdout, so any extraneous messages to stdout will break VSCode's
    // normal code intelligence features.
    ipc.config.silent = true;

    function log(s: string): void {
      info.project.projectService.logger.info(s);
    }

    function convertToSimpleDiagnostic(diagnostic: ts.Diagnostic): SimpleDiagnostic {
      return {
        filePath: diagnostic.file ? diagnostic.file.fileName : null,
        start: diagnostic.start != null ? diagnostic.start : null,
        end:
          diagnostic.start != null && diagnostic.length != null ? diagnostic.start + diagnostic.length : null,
        message:
          typeof diagnostic.messageText === 'string'
            ? diagnostic.messageText
            : diagnostic.messageText.messageText,
        code: diagnostic.code,
      };
    }

    function getAllErrors(): Array<SimpleDiagnostic> {
      const program = info.languageService.getProgram();
      if (!program) {
        return [];
      }
      const tsDiagnostics = [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
      return tsDiagnostics.map((diagnostic) => convertToSimpleDiagnostic(diagnostic));
    }

    function getErrorsForFiles(filenames: Array<string>): Array<SimpleDiagnostic> {
      const diagnostics = [];
      for (const filename of filenames) {
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
      ipc.server.on('call', (data, socket) => {
        log(`Received method call: ${data.method}`);
        let response;
        if (data.method === 'getAllErrors') {
          response = getAllErrors();
        } else if (data.method === 'getErrorsForFiles') {
          response = getErrorsForFiles(data.filenames);
        } else {
          throw new Error(`Unexpected method: ${data.method}`);
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
