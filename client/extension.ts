import { execSync, exec } from 'child_process';

import * as client from 'vscode-languageclient';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import ajv from 'ajv';
import * as vs from 'vscode';
import * as yaml from "js-yaml";
import betterAjvErrors from 'better-ajv-errors';
import * as im from 'immutable';
import * as lexical from '../compiler/lexical-analysis/lexical';

// var jsonSchemaCompiler = new ajv({ allErrors: true, jsonPointers: true });
// var validate = jsonSchemaCompiler.compile(schemaDefinition);

export function compileJsonnet(sourceFile: string): string {
  let codePaths = '';
  // Compile the preview Jsonnet file.
  const extStrsObj = rakamRecipe.buildVariables(sourceFile);
  const extCodes = Object.keys(extStrsObj)
    .map(key => `--ext-code "${key}"='${JSON.stringify(extStrsObj[key])}'`)
    .join(" ");

  const libPaths = workspace.libPaths();
  return execSync(`${jsonnet.executable} ${libPaths} ${extCodes} ${codePaths} ${sourceFile}`).toString();
}

const example_variable_values = {
  'model': 'model',
  'schema': { "database": "database", "schema": "schema" },
  'string': 'value',
  'table': { "database": "database", "schema": "schema", "table": "table" },
  'multiple-table': { "database": "database", "schema": "schema", "table": ["table1", "table2"] },
  'target': { "database": "database", "schema": "schema", "table": "table" },
  'table-multiple-column': { "column": { "type": "string", "column": "column" } },
  "table-column": { "column": { "type": "string", "column": "column" } },
  "numeric": 1,
  "sql": [],
  'boolean': true,
  'model-mapping': {}
}

// activate registers the Jsonnet language server with vscode, and
// configures it based on the contents of the workspace JSON file.
export const activate = (context: vs.ExtensionContext) => {
  register.jsonnetClient(context);
  const diagProvider = register.diagnostics(context);
  register.previewCommands(context, diagProvider);
}

export const deactivate = () => { }

namespace register {
  // jsonnetClient registers the Jsonnet language client with vscode.
  export const jsonnetClient = (context: vs.ExtensionContext): void => {
    // The server is implemented in node
    let languageClient = jsonnet.languageClient(context.asAbsolutePath(path.join('out', 'server', 'server.js')));


    // Push the disposable to the context's subscriptions so that the
    // client can be deactivated on extension deactivation
    context.subscriptions.push(languageClient.start());

    // Configure the workspace.
    workspace.configure(vs.workspace.getConfiguration('jsonnet'));
  }

  // diagnostics registers a `jsonnet.DiagnosticProvider` with vscode.
  // This will cause vscode to render errors and warnings for users as
  // they save their code.
  export const diagnostics = (
    context: vs.ExtensionContext,
  ): jsonnet.DiagnosticProvider => {
    const diagnostics = vs.languages.createDiagnosticCollection("jsonnet");
    context.subscriptions.push(diagnostics);
    return new jsonnet.DiagnosticProvider(diagnostics);
  }

  // previewCommands will register the commands that allow people to
  // open a "preview" pane that renders their Jsonnet, similar to the
  // markdown preview pane.
  export const previewCommands = (context: vs.ExtensionContext, diagProvider: jsonnet.DiagnosticProvider): void => {
    const activePanels = new Map<string, vs.TextEditor>();

    // const docProvider = new jsonnet.DocumentProvider();
    // Subscribe to document updates. This allows us to detect (e.g.)
    // when a document was saved.
    // context.subscriptions.push(vs.workspace.registerTextDocumentContentProvider(jsonnet.PREVIEW_SCHEME, docProvider));

    // Expand Jsonnet, register errors as diagnostics with vscode, and
    // generate preview if a preview tab is open.
    // const preview = async (doc: vs.TextDocument): Promise<void> => {
    //   if (doc.languageId === "jsonnet") {
    //     const result = docProvider.cachePreview(doc);
    //     if (jsonnet.isRuntimeFailure(result)) {
    //       diagProvider.report(doc.uri, result.error);
    //     } else {
    //       diagProvider.clear(doc.uri);
    //       const jsonResult = JSON.parse(result);
    //       const isValid = await validate(jsonResult);
    //       if (!isValid) {
    //         const b = betterAjvErrors(schemaDefinition, jsonResult, validate.errors, { format: 'js' })
    //         console.log(b);
    //       }

    const previewExisting = async (doc: vs.TextDocument): Promise<void> => {
      if (doc.uri.scheme === 'file' && doc.fileName.endsWith(".jsonnet")) {
        const panel = activePanels.get(doc.uri.fsPath)
        if (panel == null) {
          return
        }

        let newText
        try {
          newText = compileJsonnet(doc.uri.fsPath)
        } catch (error) {
          alert.couldNotRenderJsonnet(error.message)
          return
        }

        var firstLine = panel.document.lineAt(0);
        var lastLine = panel.document.lineAt(panel.document.lineCount - 1);
        var fullRange = new vs.Range(firstLine.range.start, lastLine.range.end);
        const fullRange2 = new vs.Range(0, 0, doc.lineCount, doc.eol)

        panel.edit(edit => edit.replace(fullRange, newText))
        // const textEdit = new vs.TextEdit(fullRange, newText)
        // const edit = new vs.WorkspaceEdit()
        // edit.set(panel.document.uri, [textEdit])
        // vs.workspace.applyEdit(edit)
      }
    }

    // Update the compiled json any time we save or open a document.
    context.subscriptions.push(vs.workspace.onDidSaveTextDocument(previewExisting));
    context.subscriptions.push(vs.workspace.onDidOpenTextDocument(previewExisting));
    context.subscriptions.push(vs.workspace.onDidCloseTextDocument(doc => {
      // TODO: not working
      if (doc.uri.scheme === jsonnet.PREVIEW_SCHEME) {
        delete activePanels[""]
      }
    }));

    // Register Jsonnet preview commands.
    context.subscriptions.push(vs.commands.registerCommand('jsonnet.previewToSide', async () => {
      const editor = vs.window.activeTextEditor;
      if (editor == null) {
        alert.noActiveWindow();
        return;
      }

      const fileName = editor.document.fileName.toLowerCase();
      if (!fileName.endsWith(".jsonnet")) {
        alert.documentNotJsonnet(fileName);
        return;
      }

      // compile to the same path with json extension
      const fsPath = editor.document.uri.fsPath
      const filePath = rakamRecipe.convertExt(fsPath, "jsonnet", "json")
      // let uri = vs.Uri.file(filePath).with({ scheme: jsonnet.PREVIEW_SCHEME });
      let uri = vs.Uri.file(filePath).with({ scheme: 'untitled' });

      if (activePanels[fsPath] == null) {
        const ff = await vs.workspace.openTextDocument(uri)
        activePanels.set(fsPath, await vs.window.showTextDocument(await vs.workspace.openTextDocument(uri), getViewColumn()))
        previewExisting(editor.document)
      }
    }));
  }

  const getViewColumn = (): vs.ViewColumn | undefined => {
    const active = vs.window.activeTextEditor;
    if (!active) {
      return vs.ViewColumn.One;
    }

    switch (active.viewColumn) {
      case vs.ViewColumn.One:
        return vs.ViewColumn.Two;
      case vs.ViewColumn.Two:
        return vs.ViewColumn.Three;
    }

    return active.viewColumn;
  }
}

namespace workspace {
  const execPathProp = "executablePath";

  export const libPaths = (): string => {
    const libPaths = vs.workspace.getConfiguration('jsonnet')["libPaths"];
    if (libPaths == null) {
      return "";
    }

    // Add executable to the beginning of the library paths, because
    // the Jsonnet CLI will look there first.
    //
    // TODO(hausdorff): Consider adding support for Jsonnet's
    // (undocumented) search paths `/usr/share/{jsonnet version}` and
    // `/usr/local/share/{jsonnet version}`. We don't support them
    // currently because (1) they're undocumented and therefore not
    // widely-used, and (2) it requires shelling out to the Jsonnet
    // command line, which complicates the extension.
    const jsonnetExecutable = vs.workspace.getConfiguration[execPathProp];
    if (jsonnetExecutable != null) {
      (<string[]>libPaths).unshift(jsonnetExecutable);
    }

    return libPaths
      .map(path => `-J ${path}`)
      .join(" ");
  }

  export const outputFormat = (): "json" | "yaml" => {
    return vs.workspace.getConfiguration('jsonnet')["outputFormat"];
  }

  export const configure = (config: vs.WorkspaceConfiguration): boolean => {
    if (os.type() === "Windows_NT") {
      return configureWindows(config);
    } else {
      return configureUnix(config);
    }
  }

  const configureUnix = (config: vs.WorkspaceConfiguration): boolean => {
    if (config[execPathProp] != null) {
      jsonnet.executable = config[execPathProp];
    } else {
      try {
        // If this doesn't throw, 'jsonnet' was found on
        // $PATH.
        //
        // TODO: Probably should find a good non-shell way of
        // doing this.
        execSync(`which jsonnet`);
      } catch (e) {
        alert.jsonnetCommandNotOnPath();
        return false;
      }
    }

    return true;
  }

  const configureWindows = (config: vs.WorkspaceConfiguration): boolean => {
    if (config[execPathProp] == null) {
      alert.jsonnetCommandIsNull();
      return false;
    }

    jsonnet.executable = config[execPathProp];
    return true;
  }
}

namespace alert {
  const alert = vs.window.showErrorMessage;

  export const noActiveWindow = () => {
    alert("Can't open Jsonnet preview because there is no active window");
  }

  export const documentNotJsonnet = (languageId) => {
    alert(`Can't generate Jsonnet document preview for document '${languageId}'`);
  }

  export const couldNotRenderJsonnet = (reason) => {
    alert(`Error: Could not render Jsonnet; ${reason}`);
  }

  export const jsonnetCommandNotOnPath = () => {
    alert(`Error: could not find 'jsonnet' command on path`);
  }

  export const jsonnetCommandIsNull = () => {
    alert(`Error: 'jsonnet.executablePath' must be set in vscode settings`);
  }
}

namespace jsonnet {
  export let executable = "jsonnet";
  export const PREVIEW_SCHEME = "jsonnet-preview";
  export const DOCUMENT_FILTER = {
    language: 'jsonnet',
    scheme: 'file'
  };

  export const languageClient = (serverModule: string) => {
    // If the extension is launched in debug mode then the debug
    // server options are used. Otherwise the run options are used
    let serverOptions: client.ServerOptions = {
      run: {
        module: serverModule,
        transport: client.TransportKind.ipc,
      },
      debug: {
        module: serverModule,
        transport: client.TransportKind.ipc,
        // The debug options for the server
        options: { execArgv: ["--nolazy", "--inspect=6009"] }
      }
    }

    // Options to control the language client
    let clientOptions: client.LanguageClientOptions = {
      // Register the server for plain text documents
      documentSelector: [jsonnet.DOCUMENT_FILTER.language],
      synchronize: {
        // Synchronize the workspace/user settings sections
        // prefixed with 'jsonnet' to the server.
        configurationSection: DOCUMENT_FILTER.language,
        // Notify the server about file changes to '.clientrc
        // files contain in the workspace.
        fileEvents: vs.workspace.createFileSystemWatcher('**/.clientrc')
      }
    }

    // Create the language client and start the client.
    return new client.LanguageClient(
      "JsonnetLanguageServer",
      'Jsonnet Language Server',
      serverOptions,
      clientOptions);
  }

  // RuntimeError represents a runtime failure in a Jsonnet program.
  export class RuntimeFailure {
    constructor(
      readonly error: string,
    ) { }
  }

  export const isRuntimeFailure = (thing): thing is RuntimeFailure => {
    return thing instanceof RuntimeFailure;
  }

  // Compiles Jsonnet code to JSON or YAML, and
  // provides that to vscode for rendering in the preview pane.
  //
  // DESIGN NOTES: This class optionally exposes `cachePreview` and
  // `delete` so that the caller can get the results of the document
  // compilation for purposes of (e.g.) reporting diagnostic issues.
  export class DocumentProvider implements vs.TextDocumentContentProvider {
    private _onDidChangeFile: vs.EventEmitter<vs.FileChangeEvent[]>;

    constructor() {
      this._onDidChangeFile = new vs.EventEmitter<vs.FileChangeEvent[]>();
    }

    public updateFile(uri: vs.Uri) {
      this._onDidChangeFile.fire([{
        type: vs.FileChangeType.Changed,
        uri: uri
      } as vs.FileChangeEvent]);
    }

    get onDidChangeFile(): vs.Event<vs.FileChangeEvent[]> {
      return this._onDidChangeFile.event;
    }

    public provideTextDocumentContent = (previewUri: vs.Uri): string => {
      // find the jsonnet file
      const key = rakamRecipe.convertExt(previewUri.fsPath, "json", "jsonnet")
      try {
        return compileJsonnet(key)
      } catch (error) {
        alert.couldNotRenderJsonnet(error.message)
      }
    }
  }

  // DiagnosticProvider will consume the output of the Jsonnet CLI and
  // either (1) report diagnostics issues (e.g., errors, warnings) to
  // the user, or (2) clear them if the compilation was successful.
  export class DiagnosticProvider {
    constructor(private readonly diagnostics: vs.DiagnosticCollection) { }

    public report = (fileUri: vs.Uri, message: string): void => {
      const messageLines = im.List<string>((<string>message).split(os.EOL)).rest();

      // Start over.
      this.diagnostics.clear();
      const errorMessage = messageLines.get(0);

      if (errorMessage.startsWith(lexical.staticErrorPrefix)) {
        return this.reportStaticErrorDiagnostics(errorMessage);
      } else if (errorMessage.startsWith(lexical.runtimeErrorPrefix)) {
        const stackTrace = messageLines.rest().toList();
        return this.reportRuntimeErrorDiagnostics(
          fileUri, errorMessage, stackTrace);
      }
    }

    public clear = (fileUri: vs.Uri): void => {
      this.diagnostics.delete(fileUri);
    }

    //
    // Private members.
    //

    private reportStaticErrorDiagnostics = (message: string): void => {
      const staticError = message.slice(lexical.staticErrorPrefix.length);
      const match = DiagnosticProvider.fileFromStackFrame(staticError);
      if (match == null) {
        console.log(`Could not parse filename from Jsonnet error: '${message}'`);
        return;
      }

      const locAndMessage = staticError.slice(match.fullMatch.length);
      const range = DiagnosticProvider.parseRange(locAndMessage);
      if (range == null) {
        console.log(`Could not parse location range from Jsonnet error: '${message}'`);
        return;
      }
      const diag = new vs.Diagnostic(range, locAndMessage, vs.DiagnosticSeverity.Error);
      this.diagnostics.set(vs.Uri.file(match.file), [diag]);
    }

    private reportRuntimeErrorDiagnostics = (fileUri: vs.Uri, message: string, messageLines: im.List<string>): void => {
      const diagnostics = messageLines
        .reduce((acc: im.Map<string, im.List<vs.Diagnostic>>, line: string) => {
          // Filter error lines that we know aren't stack frames.
          const trimmed = line.trim();
          if (trimmed == "" || trimmed.startsWith("During manifestation")) {
            return acc;
          }

          // Log when we think a line is a stack frame, but we can't
          // parse it.
          const match = DiagnosticProvider.fileFromStackFrame(line);
          if (match == null) {
            console.log(`Could not parse filename from Jsonnet error: '${line}'`);
            return acc;
          }

          const loc = line.slice(match.fileWithLeadingWhitespace.length);
          const range = DiagnosticProvider.parseRange(loc);
          if (range == null) {
            console.log(`Could not parse filename from Jsonnet error: '${line}'`);
            return acc;
          }

          // Generate and emit diagnostics.
          const diag = new vs.Diagnostic(
            range, `${message}`, vs.DiagnosticSeverity.Error);

          const prev = acc.get(match.file, undefined);
          return prev == null
            ? acc.set(match.file, im.List<vs.Diagnostic>([diag]))
            : acc.set(match.file, prev.push(diag));
        },
          im.Map<string, im.List<vs.Diagnostic>>());

      const fileDiags = diagnostics.get(fileUri.fsPath, undefined);
      fileDiags != null && this.diagnostics.set(fileUri, fileDiags.toArray());
    }

    private static parseRange = (range: string): vs.Range | null => {
      const lr = lexical.LocationRange.fromString("Dummy name", range);
      if (lr == null) {
        return null;
      }

      const start = new vs.Position(lr.begin.line - 1, lr.begin.column - 1);
      // NOTE: Don't subtract 1 from `lr.end.column` because the range
      // is exclusive at the end.
      const end = new vs.Position(lr.end.line - 1, lr.end.column);

      return new vs.Range(start, end);
    }

    private static fileFromStackFrame = (frameMessage: string): { fullMatch: string, fileWithLeadingWhitespace: string, file: string } | null => {
      const fileMatch = frameMessage.match(/(\s*)(.*?):/);
      return fileMatch == null
        ? null
        : {
          fullMatch: fileMatch[0],
          fileWithLeadingWhitespace: fileMatch[1] + fileMatch[2],
          file: fileMatch[2],
        }
    }
  }
}

export namespace rakamRecipe {
  export function convertExt(fsPath: string, from: string, to: string): string {
    return fsPath.substring(0, fsPath.length - from.length) + to
  }

  export function buildVariables(filePath: string): object {
    const workspacePath = vs.workspace.rootPath
    let currentPath = path.dirname(filePath);
    let configFile = null
    while (workspacePath != currentPath && currentPath !== '/') {
      const file = path.join(currentPath, "_config.jsonnet")
      if (fs.existsSync(file)) {
        configFile = file
        break
      }
      // get the parent path
      currentPath = path.join(currentPath, '..')
    }

    const extCodes = {}

    if (configFile != null) {
      try {
        const jsonOutput = execSync(`${jsonnet.executable} ${configFile}`).toString();
        const variables = JSON.parse(jsonOutput).variables || {}
        Object.keys(variables).forEach(variableName => {
          extCodes[variableName] = example_variable_values[variables[variableName].type]
        })
        return extCodes
      } catch (error) {
        // ignore it as config file is not valid
      }
    }

    return extCodes
  }
}