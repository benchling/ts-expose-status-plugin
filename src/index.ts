import { appendFileSync } from 'fs';
import { IPC } from 'node-ipc';
import { homedir } from 'os';
import ts from 'typescript';
import * as ts_module from 'typescript/lib/tsserverlibrary';

import { resolve } from 'path';
import { CALL_EVENT, RESPOND_EVENT, SERVER_ID, SimpleDiagnostic } from './Protocol';

const LOG_FILE = `${homedir()}/ts-expose-status-plugin-output.log`;
const LOGGING_ENABLED = false;

/**
 * Log a message for debugging purposes.
 *
 * Rather than using the built-in info.project.projectService.logger.info() logging,
 * we append to a file in a hard-coded location. This makes it possible to save log
 * messages before a project has been set up (since the IPC handler is
 * project-independent) and avoids the need to pass a TSS_LOG env variable.
 */
function log(message: string): void {
  if (LOGGING_ENABLED) {
    appendFileSync(LOG_FILE, `(pid ${process.pid}) ${new Date().toLocaleString()}: ${message}\n`);
  }
}

/**
 * Typechecking helper for a single project.
 */
class ProjectChecker {
  constructor(readonly ts: typeof ts_module, readonly info: ts.server.PluginCreateInfo) {}

  convertToSimpleDiagnostic(diagnostic: ts.Diagnostic): SimpleDiagnostic {
    return {
      filePath: diagnostic.file ? resolve(diagnostic.file.fileName) : null,
      start: diagnostic.start != null ? diagnostic.start : null,
      end:
        diagnostic.start != null && diagnostic.length != null ? diagnostic.start + diagnostic.length : null,
      message: this.ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      code: diagnostic.code,
    };
  }

  getAllErrors(): Array<SimpleDiagnostic> {
    const program = this.info.languageService.getProgram();
    if (!program) {
      return [];
    }
    // Ignore other diagnostic types for now, since they tend to not correspond to typical TS errors.
    const tsDiagnostics = [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
    return tsDiagnostics.map((diagnostic) => this.convertToSimpleDiagnostic(diagnostic));
  }

  getErrorsForFile(filename: string): Array<SimpleDiagnostic> {
    return [
      // Ignore other diagnostic types for now, since they tend to not correspond to typical TS errors.
      ...this.info.languageService.getSemanticDiagnostics(filename),
      ...this.info.languageService.getSyntacticDiagnostics(filename),
    ].map((diagnostic) => this.convertToSimpleDiagnostic(diagnostic));
  }

  fileInProject(filename: string): boolean {
    return Boolean(this.info.languageService.getProgram()?.getSourceFile(filename));
  }
}

/**
 * Typechecking helper that combines results for all open projects.
 */
class MultiProjectChecker {
  projectCheckers: Array<ProjectChecker> = [];

  registerProject(ts: typeof ts_module, info: ts.server.PluginCreateInfo) {
    log(`Initializing project ${info.project.getProjectName()}`);
    this.projectCheckers.push(new ProjectChecker(ts, info));
  }

  getAllErrors(): Array<SimpleDiagnostic> {
    return this.projectCheckers.flatMap((checker) => checker.getAllErrors());
  }

  getErrorsForFiles(filenames: Array<string>): Array<SimpleDiagnostic> {
    const diagnostics: Array<SimpleDiagnostic> = [];
    for (const filename of filenames) {
      let matchedAnyProject = false;
      // If we have multiple projects open, we don't know which project this
      // file is in, so check each one for file membership and only check the
      // one that passes so that we don't throw an exception for the others.
      // It's also possible that the file is in multiple projects, which may
      // give different error results (e.g. due to different tsconfig), so
      // combine results from all projects in that case.
      for (const projectChecker of this.projectCheckers) {
        if (projectChecker.fileInProject(filename)) {
          diagnostics.push(...projectChecker.getErrorsForFile(filename));
          matchedAnyProject = true;
        }
      }
      if (!matchedAnyProject) {
        diagnostics.push({
          filePath: filename,
          start: null,
          end: null,
          message: `\
File ${filename} was not found in any TypeScript project. \
Make sure the appropriate TypeScript project(s) are open in your editor.`,
          code: 20000,
        });
      }
    }
    return diagnostics;
  }
}

let checker = new MultiProjectChecker();
let isIPCSetUp: boolean = false;

/**
 * One-time initialization of the IPC listener to communicate with a
 * TSStatusClient in a different process.
 */
function setupIPC() {
  const ipc = new IPC();
  ipc.config.id = SERVER_ID;
  // We MUST silence logging, or else node-ipc will print to stdout. VSCode talks with the TS
  // language service over stdin/stdout, so any extraneous messages to stdout will break VSCode's
  // normal code intelligence features.
  ipc.config.silent = true;

  log(`Starting ts-expose-status-plugin IPC server`);
  ipc.serve(() => {
    ipc.server.on(CALL_EVENT, (data, socket) => {
      log(`Received method call: ${data.method}`);
      let response;
      try {
        if (data.method === 'getAllErrors') {
          response = checker.getAllErrors();
        } else if (data.method === 'getErrorsForFiles') {
          response = checker.getErrorsForFiles(data.filenames);
        } else {
          const errorMsg = `Unexpected method: ${data.method}`;
          log(errorMsg);
          response = errorMsg;
        }
      } catch (e) {
        response = `${e.stack}\n\n`;
      }
      ipc.server.emit(socket, RESPOND_EVENT, response);
    });
  });
  ipc.server.start();
}

/**
 * Extension point to initialize this plugin for a TS project. This function is
 * called once per project but we want to act on all projects at once, so we use
 * some module-level state to ensure that IPC is only set up once and to register
 * all projects that have been loaded.
 */
function init(modules: {typescript: typeof ts_module}): ts.server.PluginModule {
  if (!isIPCSetUp) {
    setupIPC();
    isIPCSetUp = true;
  }
  const ts = modules.typescript;
  return {
    create(info: ts.server.PluginCreateInfo): ts_module.LanguageService {
      checker.registerProject(ts, info);
      return info.languageService;
    },
  };
}

export = init;
