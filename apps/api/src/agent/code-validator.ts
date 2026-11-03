import ts from 'typescript';
import { CODE_MAX_BYTES, GAME_CODE_API } from '@game-creator/contracts';

const LIB = `
interface Object {} interface Function {} interface CallableFunction {} interface NewableFunction {}
interface IArguments { length: number; [n: number]: unknown; }
interface String { readonly length: number; } interface Number {} interface Boolean {} interface RegExp {}
interface SymbolConstructor { readonly iterator: unique symbol; } declare const Symbol: SymbolConstructor;
interface Iterator<T, TReturn = undefined, TNext = undefined> { next(value?: TNext): { value: T; done?: false } | { value: TReturn; done: true }; }
interface Array<T> { readonly length: number; [n: number]: T; [Symbol.iterator](): Iterator<T>; push(...items: T[]): number; pop(): T | undefined; splice(start: number, count: number): T[]; }
interface ReadonlyArray<T> { readonly length: number; readonly [n: number]: T; [Symbol.iterator](): Iterator<T>; }
declare const Math: { readonly random: () => number; readonly floor: (n: number) => number; readonly ceil: (n: number) => number; readonly round: (n: number) => number; readonly abs: (n: number) => number; readonly min: (...v: number[]) => number; readonly max: (...v: number[]) => number; readonly sqrt: (n: number) => number; readonly sin: (n: number) => number; readonly cos: (n: number) => number; readonly atan2: (y: number, x: number) => number; readonly hypot: (...v: number[]) => number; readonly PI: number; };
${GAME_CODE_API}
`;
const forbidden = new Set([
  'constructor', 'prototype', '__proto__', 'call', 'apply', 'bind', 'caller', 'callee', 'arguments',
  'window', 'document', 'globalThis', 'self', 'parent', 'top', 'frames', 'location', 'navigator',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'Worker', 'SharedWorker', 'importScripts',
  'eval', 'Function', 'Reflect', 'Proxy', 'Object', 'Symbol', 'Promise', 'JSON', 'Date', 'RegExp',
  'process', 'require', 'module', 'exports', 'localStorage', 'sessionStorage', 'indexedDB',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'postMessage', 'open', 'alert',
  'toString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
]);
export interface ValidationResult { javascript?: string; errors: string[] }

export class CodeValidator {
  validate(source: string): ValidationResult {
    if (Buffer.byteLength(source, 'utf8') > CODE_MAX_BYTES) return { errors: ['Chỉ cho phép một file game.ts, tối đa 24 KB.'] };
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true, noLib: true,
      noUncheckedIndexedAccess: true, noImplicitReturns: true, noEmitOnError: true, removeComments: true,
    };
    const files: Record<string, string> = { 'game.ts': source, 'game-api.d.ts': LIB,
      'contract.ts': 'const createContract: (api: GameAPI) => void = create; const updateContract: (api: GameAPI, dt: number) => void = update;' };
    let javascript = '';
    const host: ts.CompilerHost = {
      getSourceFile: (name, languageVersion) => files[name] === undefined ? undefined : ts.createSourceFile(name, files[name], languageVersion, true),
      getDefaultLibFileName: () => 'game-api.d.ts', writeFile: (name, content) => { if (name === 'game.js') javascript = content; },
      getCurrentDirectory: () => '', getDirectories: () => [], fileExists: (name) => name in files,
      readFile: (name) => files[name], getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    };
    const program = ts.createProgram(Object.keys(files), options, host);
    const tree = program.getSourceFile('game.ts')!;
    const checker = program.getTypeChecker();
    const errors: string[] = [];
    const error = (node: ts.Node, message: string) => {
      if (errors.length < 10) errors.push(`game.ts:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${message}`);
    };
    for (const statement of tree.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body || statement.modifiers?.length) {
        error(statement, 'Chỉ khai báo function ở cấp file; không import/export, biến toàn cục hoặc lệnh khởi chạy.');
      }
    }
    if (!tree.statements.some((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'create')
      || !tree.statements.some((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'update')) error(tree, 'Cần function create(api: GameAPI) và update(api: GameAPI, dt: number).');
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && (forbidden.has(node.text) || node.text.startsWith('__'))) error(node, `Không được truy cập ${node.text}.`);
      if (ts.isStringLiteralLike(node) && node.text.length > 500) error(node, 'Chuỗi tối đa 500 ký tự.');
      if (ts.isArrayLiteralExpression(node) && node.elements.length > 256) error(node, 'Mảng literal tối đa 256 phần tử.');
      if (ts.isElementAccessExpression(node)) {
        const key = node.argumentExpression;
        if (ts.isStringLiteralLike(key)) {
          if (forbidden.has(key.text) || key.text.startsWith('__')) error(node, 'Thuộc tính bị cấm.');
        } else if (!checker.isArrayType(checker.getTypeAtLocation(node.expression))
          || !(checker.getTypeAtLocation(key).flags & ts.TypeFlags.NumberLike)) error(node, 'Chỉ index động bằng số trên mảng; không truy cập thuộc tính động.');
      }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind)
        && ((checker.getTypeAtLocation(node.left).flags | checker.getTypeAtLocation(node.right).flags) & ts.TypeFlags.StringLike)) {
        error(node, 'Không nối chuỗi động; dùng status với chuỗi cố định, điểm do host hiển thị.');
      }
      if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
        if (!ts.isBlock(node.statement)) error(node, 'Thân vòng lặp phải có dấu ngoặc nhọn.');
      }
      if ([ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.AsyncKeyword, ts.SyntaxKind.AwaitExpression, ts.SyntaxKind.YieldExpression,
        ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.SuperKeyword].includes(node.kind)
        || ts.isNewExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
        || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)
        || ts.isExportDeclaration(node) || ts.isExportAssignment(node) || ts.isModuleDeclaration(node)
        || ts.isTryStatement(node) || ts.isForInStatement(node) || ts.isWithStatement(node)
        || ts.isSpreadElement(node) || ts.isSpreadAssignment(node) || ts.isComputedPropertyName(node)
        || ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node) || ts.isRegularExpressionLiteral(node)
        || ts.isTemplateExpression(node) || (ts.isFunctionLike(node) && 'asteriskToken' in node && node.asteriskToken)) {
        error(node, 'Cú pháp nằm ngoài tập TypeScript an toàn của Advanced MVP.');
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      if (errors.length >= 10) break;
      const line = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : 1;
      errors.push(`game.ts:${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').slice(0, 400)}`);
    }
    if (errors.length) return { errors };
    // Inject a private budget check on EVERY function entry and loop iteration.
    // try/catch is rejected, so generated code cannot swallow budget exceptions.
    const instrument: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const guard = () => ts.factory.createExpressionStatement(ts.factory.createCallExpression(ts.factory.createIdentifier('__budget'), undefined, []));
      const visitor: ts.Visitor = (node) => {
        const result = ts.visitEachChild(node, visitor, context);
        if (ts.isBlock(result) && (ts.isFunctionLike(node.parent) || ts.isIterationStatement(node.parent, false))) {
          return ts.factory.updateBlock(result, [guard(), ...result.statements]);
        }
        if (ts.isArrowFunction(result) && !ts.isBlock(result.body)) return ts.factory.updateArrowFunction(result, result.modifiers, result.typeParameters,
          result.parameters, result.type, result.equalsGreaterThanToken, ts.factory.createBlock([guard(), ts.factory.createReturnStatement(result.body)], true));
        return result;
      };
      return (file) => ts.visitNode(file, visitor) as ts.SourceFile;
    };
    program.emit(tree, undefined, undefined, false, { before: [instrument] });
    return javascript && javascript.length <= 65_536 ? { javascript, errors: [] } : { errors: ['Không thể biên dịch game.ts trong giới hạn đầu ra.'] };
  }
}
