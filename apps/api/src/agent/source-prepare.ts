import ts from 'typescript';

export interface PreparedSource { source: string; notes: string[] }

const MAX_SIZE = 200;

/** Safe, behavior-preserving edits for shapes the model repeats:
 * undefined is not a legal state value, setup numbers are not in scope in
 * update, api.get can miss, and one entity cannot be taller or wider than 200.
 */
export function prepareGeneratedSource(source: string): PreparedSource {
  const tree = ts.createSourceFile('game.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const parseDiagnostics = (tree as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return { source, notes: [] };
  const notes: string[] = [];
  const create = functionBody(tree, 'create');
  const update = functionBody(tree, 'update');
  if (!create || !update) return { source, notes };
  const shared = constsToCopy(create, update, notes);
  const playerLink = missingPlayerLink(create, update);
  const timers = spawnTimers(update);
  const numberKeys = initializedNumberKeys(create);
  let changed = shared.length > 0 || playerLink !== undefined || timers.size > 0;
  const factory = ts.factory;
  const nextFunctions = tree.statements.map((statement) => {
    if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.name) return statement;
    const constants = new Map<string, number>();
    let body = statement.name.text === 'update' ? [...shared.map(cloneStatement), ...statement.body.statements] : [...statement.body.statements];
    const rewritten = rewriteStatements(body, constants, true, false);
    if (rewritten.changed) changed = true;
    body = stripUnusedConsts(rewritten.statements);
    if (statement.name.text === 'create' && playerLink) {
      const linked = insertPlayerLink(body, playerLink);
      if (linked.length !== body.length) { body = linked; changed = true; }
    }
    if (statement.name.text === 'create' && timers.size > 0) {
      const primed = primeSpawnTimers(body, timers);
      if (primed.changed) { body = primed.statements; changed = true; }
    }
    if (statement.name.text === 'update') {
      const coalesced = coalesceNumberLocals(body, numberKeys);
      if (coalesced.changed) { body = coalesced.statements; changed = true; }
    }
    if (body.length !== rewritten.statements.length) changed = true;
    if (!changed) return statement;
    return factory.updateFunctionDeclaration(statement, statement.modifiers, statement.asteriskToken, statement.name, statement.typeParameters, statement.parameters, statement.type, factory.updateBlock(statement.body, body));
  });
  if (!changed) return { source, notes };
  const printed = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(factory.updateSourceFile(tree, nextFunctions));
  return { source: printed, notes };
}

function functionBody(tree: ts.SourceFile, name: string): ts.Block | undefined {
  const statement = tree.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name && item.body);
  return statement && ts.isFunctionDeclaration(statement) ? statement.body : undefined;
}

interface ConstDecl { name: string; statement: ts.VariableStatement; initializer: ts.Expression }

function constsToCopy(create: ts.Block, update: ts.Block, notes: string[]): ts.Statement[] {
  const declared = bindings(update);
  const locals = new Map<string, ConstDecl>();
  for (const statement of create.statements) {
    const decl = constDecl(statement);
    if (decl) locals.set(decl.name, decl);
  }
  const known = new Set(locals.keys());
  const needed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (name: string): boolean => {
    if (declared.has(name) || needed.has(name)) return true;
    if (visiting.has(name)) return false;
    const decl = locals.get(name);
    if (!decl || !copyableNumber(decl.initializer, known)) return false;
    visiting.add(name);
    const dependencies = identifiers(decl.initializer).filter((child) => locals.has(child));
    const ready = dependencies.every(visit);
    visiting.delete(name);
    if (!ready) return false;
    needed.add(name);
    return true;
  };
  for (const name of new Set(identifiers(update))) {
    if (!locals.has(name) || declared.has(name) || visit(name)) continue;
    const decl = locals.get(name);
    const callable = decl !== undefined && (ts.isArrowFunction(unwrap(decl.initializer)) || ts.isFunctionExpression(unwrap(decl.initializer)));
    notes.push(callable
      ? `\`${name}\` is a function declared in setup, so update cannot call it. Move that function into helpers. Do not store it in api.state.`
      : `\`${name}\` is declared in setup and used in update, but it is not a shared number. Save api.state.${name} = <number> in setup, or repeat a numeric const in update. Do not assign undefined.`);
  }
  return [...locals.values()].filter((decl) => needed.has(decl.name)).map((decl) => decl.statement);
}

function rewriteStatements(statements: readonly ts.Statement[], constants: Map<string, number>, canReturn: boolean, inLoop: boolean): { statements: ts.Statement[]; changed: boolean } {
  const output: ts.Statement[] = [];
  let changed = false;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (isUndefinedStateAssignment(statement)) { changed = true; continue; }
    const nested = rewriteNested(statement, constants, canReturn, inLoop);
    if (nested) {
      output.push(...nested.statements);
      if (nested.changed) changed = true;
      rememberConst(statement, constants);
      continue;
    }
    const split = splitSpawnStatement(statement, constants, inLoop);
    if (split) {
      output.push(...split);
      changed = true;
      rememberConst(statement, constants);
      continue;
    }
    output.push(statement);
    rememberConst(statement, constants);
    const binding = getBinding(statement);
    if (binding && canReturn && needsEntityGuard(statements.slice(index + 1), binding)) {
      output.push(undefinedGuard(binding));
      changed = true;
    }
  }
  return { statements: output, changed };
}

function rewriteNested(statement: ts.Statement, constants: Map<string, number>, canReturn: boolean, inLoop: boolean): { statements: ts.Statement[]; changed: boolean } | undefined {
  const factory = ts.factory;
  if (ts.isBlock(statement)) {
    const inner = rewriteStatements(statement.statements, new Map(constants), canReturn, inLoop);
    if (!inner.changed) return { statements: [statement], changed: false };
    return { statements: [factory.updateBlock(statement, inner.statements)], changed: true };
  }
  if (ts.isIfStatement(statement)) {
    const thenResult = rewriteChild(statement.thenStatement, constants, canReturn, inLoop);
    const elseResult = statement.elseStatement ? rewriteChild(statement.elseStatement, constants, canReturn, inLoop) : undefined;
    if (!thenResult.changed && !elseResult?.changed) return { statements: [statement], changed: false };
    const thenStatement = thenResult.statements[0] ?? statement.thenStatement;
    const updated = statement.elseStatement
      ? factory.updateIfStatement(statement, statement.expression, thenStatement, elseResult?.statements[0] ?? statement.elseStatement)
      : factory.updateIfStatement(statement, statement.expression, thenStatement, undefined);
    return { statements: [updated], changed: true };
  }
  if (ts.isForOfStatement(statement) || ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    const body = rewriteChild(loopBody(statement), constants, false, true);
    if (!body.changed) return { statements: [statement], changed: false };
    const next = body.statements[0] ?? statement;
    if (ts.isForOfStatement(statement)) return { statements: [factory.updateForOfStatement(statement, statement.awaitModifier, statement.initializer, statement.expression, next)], changed: true };
    if (ts.isForStatement(statement)) return { statements: [factory.updateForStatement(statement, statement.initializer, statement.condition, statement.incrementor, next)], changed: true };
    if (ts.isWhileStatement(statement)) return { statements: [factory.updateWhileStatement(statement, statement.expression, next)], changed: true };
    return { statements: [factory.updateDoStatement(statement, next, statement.expression)], changed: true };
  }
  return undefined;
}

function rewriteChild(statement: ts.Statement, constants: Map<string, number>, canReturn: boolean, inLoop: boolean): { statements: ts.Statement[]; changed: boolean } {
  if (ts.isBlock(statement) || ts.isIfStatement(statement) || ts.isForOfStatement(statement) || ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    return rewriteNested(statement, constants, canReturn, inLoop) ?? { statements: [statement], changed: false };
  }
  const inner = rewriteStatements([statement], new Map(constants), canReturn, inLoop);
  if (!inner.changed) return { statements: [statement], changed: false };
  if (inner.statements.length <= 1) return { statements: inner.statements, changed: true };
  return { statements: [ts.factory.createBlock(inner.statements, true)], changed: true };
}

function loopBody(statement: ts.ForOfStatement | ts.ForStatement | ts.WhileStatement | ts.DoStatement): ts.Statement {
  return statement.statement;
}

function splitSpawnStatement(statement: ts.Statement, constants: ReadonlyMap<string, number>, inLoop: boolean): ts.Statement[] | undefined {
  if (ts.isExpressionStatement(statement)) {
    const calls = splitCall(statement.expression, constants);
    if (calls) return calls.map((call) => ts.factory.createExpressionStatement(call));
    const stacked = dynamicStack(statement.expression, constants, inLoop);
    return stacked ? [stacked] : undefined;
  }
  const decl = constDecl(statement);
  if (!decl) return undefined;
  const calls = splitCall(decl.initializer, constants);
  if (calls && calls.length > 0) {
    const [first, ...rest] = calls;
    const list = ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(decl.name, undefined, undefined, first),
    ], ts.NodeFlags.Const);
    return [ts.factory.createVariableStatement(undefined, list), ...rest.map((call) => ts.factory.createExpressionStatement(call))];
  }
  const stacked = dynamicStack(decl.initializer, constants, inLoop);
  if (!stacked || bindingUsedNearby(statement, decl.name)) return undefined;
  return [stacked];
}

function bindingUsedNearby(statement: ts.Statement, name: string): boolean {
  const parent = statement.parent;
  if (!parent) return true;
  let used = false;
  const visit = (node: ts.Node): void => {
    if (used || node === statement) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const owner = node.parent;
      if (!(owner && ts.isPropertyAccessExpression(owner) && owner.name === node)) used = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(parent);
  return used;
}

function splitCall(expression: ts.Expression, constants: ReadonlyMap<string, number>): ts.Expression[] | undefined {
  const call = unwrap(expression);
  if (!ts.isCallExpression(call) || call.arguments.length < 6) return undefined;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'spawn') return undefined;
  const width = resolveNumber(call.arguments[3]!, constants);
  const height = resolveNumber(call.arguments[4]!, constants);
  if (width === undefined || height === undefined) return undefined;
  const columns = pieces(width);
  const rows = pieces(height);
  if (!columns || !rows || (columns.length === 1 && rows.length === 1)) return undefined;
  const kind = call.arguments[0]!;
  const x = call.arguments[1]!;
  const y = call.arguments[2]!;
  const color = call.arguments[5]!;
  const calls: ts.Expression[] = [];
  let rowOffset = 0;
  for (const row of rows) {
    let columnOffset = 0;
    for (const column of columns) {
      calls.push(ts.factory.createCallExpression(cloneExpression(callee), undefined, [
        cloneExpression(kind),
        shift(x, columnOffset + column / 2 - width / 2),
        shift(y, rowOffset + row / 2 - height / 2),
        numeric(column),
        numeric(row),
        cloneExpression(color),
      ]));
      columnOffset += column;
    }
    rowOffset += row;
  }
  return calls;
}

function pieces(span: number): number[] | undefined {
  if (!(span >= 1) || !Number.isFinite(span)) return undefined;
  if (span <= MAX_SIZE) return [span];
  const parts: number[] = [];
  let left = span;
  while (left > MAX_SIZE) { parts.push(MAX_SIZE); left -= MAX_SIZE; }
  if (left >= 1) parts.push(left);
  else if (left > 0 && parts.length > 0) {
    parts[parts.length - 1] = MAX_SIZE - (1 - left);
    parts.push(1);
  }
  return parts;
}

function shift(base: ts.Expression, delta: number): ts.Expression {
  const copy = cloneExpression(base);
  if (Math.abs(delta) < 1e-6) return copy;
  return ts.factory.createParenthesizedExpression(ts.factory.createBinaryExpression(
    copy,
    delta > 0 ? ts.SyntaxKind.PlusToken : ts.SyntaxKind.MinusToken,
    numeric(Math.abs(delta)),
  ));
}

function numeric(value: number): ts.NumericLiteral {
  const rounded = Math.round(value * 1000) / 1000;
  return ts.factory.createNumericLiteral(String(rounded));
}

function needsEntityGuard(statements: readonly ts.Statement[], name: string): boolean {
  if (statements.some((statement) => ts.isIfStatement(statement) && returnsIn(statement.thenStatement) && isMissingCondition(statement.expression, name))) return false;
  let unsafe = false;
  const walk = (node: ts.Node): void => {
    if (unsafe || ts.isFunctionLike(node)) return;
    if (ts.isIfStatement(node) && isTruthyGuard(node.expression, name)) {
      if (node.elseStatement) walk(node.elseStatement);
      return;
    }
    if (ts.isIdentifier(node) && node.text === name && isUnsafeEntityUse(node)) unsafe = true;
    else ts.forEachChild(node, walk);
  };
  statements.forEach(walk);
  return unsafe;
}

function isUnsafeEntityUse(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return true;
  if (!ts.isCallExpression(parent)) return false;
  const argument = parent.arguments.find((item) => unwrap(item) === node);
  if (!argument) return false;
  const callee = parent.expression;
  return ts.isPropertyAccessExpression(callee) && (callee.name.text === 'overlaps' || callee.name.text === 'remove' || callee.name.text === 'setPlayer');
}

function isTruthyGuard(expression: ts.Expression, name: string): boolean {
  const current = unwrap(expression);
  if (ts.isIdentifier(current) && current.text === name) return true;
  if (!ts.isBinaryExpression(current)) return false;
  if (current.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken && current.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken) return false;
  const left = unwrap(current.left);
  const right = unwrap(current.right);
  return (ts.isIdentifier(left) && left.text === name && isUndefinedLike(right)) || (ts.isIdentifier(right) && right.text === name && isUndefinedLike(left));
}

function isMissingCondition(expression: ts.Expression, name: string): boolean {
  const current = unwrap(expression);
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = unwrap(current.operand);
    return ts.isIdentifier(inner) && inner.text === name;
  }
  if (ts.isBinaryExpression(current) && (current.operatorToken.kind === ts.SyntaxKind.BarBarToken || current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
    return isMissingCondition(current.left, name) || isMissingCondition(current.right, name);
  }
  if (ts.isBinaryExpression(current) && (current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
    const left = unwrap(current.left);
    const right = unwrap(current.right);
    return (ts.isIdentifier(left) && left.text === name && isUndefinedLike(right)) || (ts.isIdentifier(right) && right.text === name && isUndefinedLike(left));
  }
  return false;
}

function isUndefinedLike(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.UndefinedKeyword || node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined');
}

function returnsIn(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  return ts.isBlock(statement) && statement.statements.some((inner) => ts.isReturnStatement(inner));
}

function undefinedGuard(name: string): ts.Statement {
  return ts.factory.createIfStatement(
    ts.factory.createBinaryExpression(ts.factory.createIdentifier(name), ts.SyntaxKind.EqualsEqualsEqualsToken, ts.factory.createIdentifier('undefined')),
    ts.factory.createBlock([ts.factory.createReturnStatement()], true),
  );
}

function getBinding(statement: ts.Statement): string | undefined {
  const decl = constDecl(statement);
  if (!decl || !ts.isCallExpression(unwrap(decl.initializer))) return undefined;
  const call = unwrap(decl.initializer);
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'get') return undefined;
  return decl.name;
}

function isUndefinedStateAssignment(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false;
  const expression = statement.expression;
  if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !stateKey(expression.left)) return false;
  return isUndefinedLike(unwrap(expression.right));
}

function rememberConst(statement: ts.Statement, constants: Map<string, number>): void {
  const decl = constDecl(statement);
  if (!decl) return;
  const value = resolveNumber(decl.initializer, constants);
  if (value !== undefined) constants.set(decl.name, value);
}

function resolveNumber(node: ts.Expression, constants: ReadonlyMap<string, number>): number | undefined {
  const current = unwrap(node);
  if (ts.isNumericLiteral(current)) {
    const value = Number(current.text);
    return Number.isFinite(value) ? value : undefined;
  }
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.MinusToken) {
    const value = resolveNumber(current.operand, constants);
    return value === undefined ? undefined : -value;
  }
  if (ts.isIdentifier(current)) return constants.get(current.text);
  if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === 'api') {
    if (current.name.text === 'width') return 960;
    if (current.name.text === 'height') return 540;
  }
  if (!ts.isBinaryExpression(current)) return undefined;
  const left = resolveNumber(current.left, constants);
  const right = resolveNumber(current.right, constants);
  if (left === undefined || right === undefined) return undefined;
  if (current.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
  if (current.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
  if (current.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
  if (current.operatorToken.kind === ts.SyntaxKind.SlashToken && right !== 0) return left / right;
  return undefined;
}

const DETERMINISTIC_MATH = new Set(['floor', 'ceil', 'round', 'abs', 'min', 'max', 'sqrt', 'sin', 'cos', 'atan2', 'hypot']);

function copyableNumber(node: ts.Expression, locals: ReadonlySet<string>): boolean {
  let bad = false;
  const walk = (current: ts.Node): void => {
    if (bad || (current !== node && ts.isFunctionLike(current))) return;
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      const math = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Math' && DETERMINISTIC_MATH.has(callee.name.text);
      if (!math) bad = true;
    } else if (ts.isIdentifier(current)) {
      const parent = current.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === current) return;
      if (current.text !== 'api' && current.text !== 'Math' && !locals.has(current.text)) bad = true;
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return !bad && numericShape(node, locals);
}

function numericShape(node: ts.Expression, locals: ReadonlySet<string>): boolean {
  // resolveNumber needs real values; a const that only names another const is still copyable.
  const current = unwrap(node);
  if (ts.isNumericLiteral(current) || (ts.isIdentifier(current) && locals.has(current.text))) return true;
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.MinusToken) return numericShape(current.operand, locals);
  if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === 'api') {
    return current.name.text === 'width' || current.name.text === 'height';
  }
  if (ts.isBinaryExpression(current)) {
    const kind = current.operatorToken.kind;
    const arithmetic = kind === ts.SyntaxKind.PlusToken || kind === ts.SyntaxKind.MinusToken || kind === ts.SyntaxKind.AsteriskToken || kind === ts.SyntaxKind.SlashToken;
    return arithmetic && numericShape(current.left, locals) && numericShape(current.right, locals);
  }
  if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && ts.isIdentifier(current.expression.expression) && current.expression.expression.text === 'Math' && DETERMINISTIC_MATH.has(current.expression.name.text)) {
    return current.arguments.every((argument) => numericShape(argument, locals));
  }
  return false;
}

function stripUnusedConsts(statements: ts.Statement[]): ts.Statement[] {
  let current = statements;
  for (;;) {
    const used = new Set<string>();
    current.forEach((statement) => collectUses(statement, used));
    const next = current.filter((statement) => {
      const decl = constDecl(statement);
      if (!decl || used.has(decl.name)) return true;
      return !copyableNumber(decl.initializer, new Set());
    });
    if (next.length === current.length) return current;
    current = next;
  }
}

function collectUses(node: ts.Node, used: Set<string>): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    if (node.initializer) collectUses(node.initializer, used);
    return;
  }
  if (ts.isIdentifier(node)) {
    const parent = node.parent;
    if (!(parent && ts.isPropertyAccessExpression(parent) && parent.name === node)) used.add(node.text);
  }
  ts.forEachChild(node, (child) => collectUses(child, used));
}

function constDecl(statement: ts.Statement): ConstDecl | undefined {
  if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return undefined;
  if (statement.declarationList.declarations.length !== 1) return undefined;
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined;
  return { name: declaration.name.text, statement, initializer: declaration.initializer };
}

function bindings(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const walk = (current: ts.Node): void => {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) names.add(current.name.text);
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      current.parameters.forEach((parameter) => { if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text); });
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return names;
}

function identifiers(node: ts.Node): string[] {
  const names: string[] = [];
  const walk = (current: ts.Node): void => {
    if (current !== node && ts.isFunctionLike(current)) return;
    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      if (!(ts.isPropertyAccessExpression(parent) && parent.name === current)) names.push(current.text);
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return names;
}

function stateKey(node: ts.Expression): boolean {
  const current = unwrap(node);
  if (!ts.isPropertyAccessExpression(current) || !ts.isIdentifier(current.name)) return false;
  const state = current.expression;
  return ts.isPropertyAccessExpression(state) && ts.isIdentifier(state.name) && state.name.text === 'state'
    && ts.isIdentifier(state.expression) && state.expression.text === 'api';
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function missingPlayerLink(create: ts.Block, update: ts.Block): { key: string; local: string } | undefined {
  const locals = new Map<string, string>();
  for (const statement of update.statements) {
    const decl = constDecl(statement);
    const key = decl && stateKeyName(unwrap(decl.initializer));
    if (decl && key) locals.set(decl.name, key);
  }
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'get' && node.arguments[0]) {
      const argument = unwrap(node.arguments[0]);
      const direct = stateKeyName(argument);
      if (direct) keys.add(direct);
      if (ts.isIdentifier(argument)) {
        const key = locals.get(argument.text);
        if (key) keys.add(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(update);
  const missing = [...keys].filter((key) => !assignedKeys(create).has(key));
  if (missing.length !== 1) return undefined;
  const local = setPlayerLocal(create);
  if (!local) return undefined;
  return { key: missing[0]!, local };
}

function setPlayerLocal(create: ts.Block): string | undefined {
  const spawned = new Set<string>();
  const players: string[] = [];
  const visit = (node: ts.Node): void => {
    const decl = ts.isVariableStatement(node) ? constDecl(node) : undefined;
    if (decl && isSpawn(unwrap(decl.initializer))) spawned.add(decl.name);
    if (ts.isCallExpression(node) && isNamedCall(node, 'setPlayer') && node.arguments[0] && ts.isIdentifier(unwrap(node.arguments[0]))) {
      const name = unwrap(node.arguments[0]);
      if (ts.isIdentifier(name) && spawned.has(name.text)) players.push(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(create);
  return players.length === 1 ? players[0] : undefined;
}

function insertPlayerLink(statements: ts.Statement[], link: { key: string; local: string }): ts.Statement[] {
  const factory = ts.factory;
  const assignment = factory.createExpressionStatement(factory.createBinaryExpression(
    stateAccess(link.key),
    ts.SyntaxKind.EqualsToken,
    factory.createPropertyAccessExpression(factory.createIdentifier(link.local), 'id'),
  ));
  const index = statements.findIndex((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(unwrap(statement.expression)) && isNamedCall(unwrap(statement.expression) as ts.CallExpression, 'setPlayer'));
  if (index < 0) return [...statements, assignment];
  return [...statements.slice(0, index + 1), assignment, ...statements.slice(index + 1)];
}

function spawnTimers(update: ts.Block): Map<string, number> {
  const found = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const test = unwrap(node.expression);
      if (ts.isBinaryExpression(test) && (test.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken || test.operatorToken.kind === ts.SyntaxKind.GreaterThanToken)) {
        const left = unwrap(test.left);
        const key = ts.isBinaryExpression(left) && left.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? stateKeyName(left.left) : stateKeyName(left);
        const threshold = resolveNumber(test.right, new Map());
        if (key && threshold !== undefined && threshold >= 0.5 && threshold <= 30 && resetsAndSpawns(node.thenStatement, key)) found.set(key, threshold);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(update);
  return found;
}

function resetsAndSpawns(statement: ts.Statement, key: string): boolean {
  let reset = false;
  let spawn = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isNamedCall(node, 'spawn')) spawn = true;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && stateKeyName(node.left) === key && ts.isNumericLiteral(unwrap(node.right)) && Number(unwrap(node.right).getText()) === 0) reset = true;
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return reset && spawn;
}

function primeSpawnTimers(statements: ts.Statement[], timers: ReadonlyMap<string, number>): { statements: ts.Statement[]; changed: boolean } {
  let changed = false;
  const next = statements.map((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return statement;
    const expression = statement.expression;
    if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return statement;
    const key = stateKeyName(expression.left);
    const threshold = key ? timers.get(key) : undefined;
    if (!key || threshold === undefined || !ts.isNumericLiteral(unwrap(expression.right)) || Number(unwrap(expression.right).getText()) !== 0) return statement;
    changed = true;
    return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(stateAccess(key), ts.SyntaxKind.EqualsToken, numeric(threshold)));
  });
  return { statements: next, changed };
}

function initializedNumberKeys(create: ts.Block): Set<string> {
  const keys = new Set<string>();
  for (const statement of create.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
    const expression = statement.expression;
    if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const key = stateKeyName(expression.left);
    if (key && resolveNumber(expression.right, new Map()) !== undefined) keys.add(key);
  }
  return keys;
}

function coalesceNumberLocals(statements: ts.Statement[], keys: ReadonlySet<string>): { statements: ts.Statement[]; changed: boolean } {
  const root = ts.factory.createBlock(statements);
  return coalesceList(statements, keys, root);
}

function coalesceList(list: readonly ts.Statement[], keys: ReadonlySet<string>, root: ts.Node): { statements: ts.Statement[]; changed: boolean } {
  let changed = false;
  const statements = list.map((statement) => {
    const decl = constDecl(statement);
    const key = decl && stateKeyName(unwrap(decl.initializer));
    if (decl && key && keys.has(key) && !keepsUndefined(decl.name, root)) {
      changed = true;
      return ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
        ts.factory.createVariableDeclaration(decl.name, undefined, undefined, ts.factory.createParenthesizedExpression(ts.factory.createBinaryExpression(stateAccess(key), ts.SyntaxKind.QuestionQuestionToken, numeric(0)))),
      ], ts.NodeFlags.Const));
    }
    const nested = coalesceNested(statement, keys, root);
    if (!nested) return statement;
    changed = true;
    return nested;
  });
  return { statements, changed };
}

function coalesceNested(statement: ts.Statement, keys: ReadonlySet<string>, root: ts.Node): ts.Statement | undefined {
  const factory = ts.factory;
  if (ts.isBlock(statement)) {
    const inner = coalesceList(statement.statements, keys, root);
    return inner.changed ? factory.updateBlock(statement, inner.statements) : undefined;
  }
  if (ts.isIfStatement(statement)) {
    const thenStatement = statement.thenStatement;
    const thenResult = ts.isBlock(thenStatement) ? coalesceList(thenStatement.statements, keys, root) : undefined;
    const elseStatement = statement.elseStatement;
    const elseResult = elseStatement && ts.isBlock(elseStatement) ? coalesceList(elseStatement.statements, keys, root) : undefined;
    if (!thenResult?.changed && !elseResult?.changed) return undefined;
    const nextThen = thenResult?.changed ? factory.updateBlock(thenStatement as ts.Block, thenResult.statements) : thenStatement;
    const nextElse = elseResult?.changed && elseStatement && ts.isBlock(elseStatement) ? factory.updateBlock(elseStatement, elseResult.statements) : elseStatement;
    return factory.updateIfStatement(statement, statement.expression, nextThen, nextElse);
  }
  return undefined;
}

function keepsUndefined(name: string, root: ts.Node): boolean {
  let keep = false;
  const visit = (node: ts.Node): void => {
    if (keep) return;
    if (ts.isCallExpression(node) && isNamedCall(node, 'get') && node.arguments[0] && ts.isIdentifier(unwrap(node.arguments[0])) && unwrap(node.arguments[0]).getText() === name) keep = true;
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
      const left = unwrap(node.left);
      const right = unwrap(node.right);
      if ((ts.isIdentifier(left) && left.text === name && isUndefinedLike(right)) || (ts.isIdentifier(right) && right.text === name && isUndefinedLike(left))) keep = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return keep;
}

function dynamicStack(expression: ts.Expression, constants: ReadonlyMap<string, number>, inLoop: boolean): ts.Statement | undefined {
  if (inLoop) return undefined;
  const call = unwrap(expression);
  if (!ts.isCallExpression(call) || call.arguments.length < 6 || !isNamedCall(call, 'spawn')) return undefined;
  const width = resolveNumber(call.arguments[3]!, constants);
  const height = resolveNumber(call.arguments[4]!, constants);
  const widthKnown = width !== undefined && width >= 1 && width <= MAX_SIZE;
  const heightKnown = height !== undefined && height >= 1 && height <= MAX_SIZE;
  if (widthKnown && heightKnown) return undefined;
  if (widthKnown && height === undefined) return stackAxis(call, 'height', width);
  if (heightKnown && width === undefined) return stackAxis(call, 'width', height);
  return undefined;
}

function stackAxis(call: ts.CallExpression, axis: 'height' | 'width', known: number): ts.Statement {
  const factory = ts.factory;
  const vertical = axis === 'height';
  const span = vertical ? 'spanHeight' : 'spanWidth';
  const cursor = vertical ? 'spanTop' : 'spanLeft';
  const sizeArgument = vertical ? call.arguments[4]! : call.arguments[3]!;
  const centerArgument = vertical ? call.arguments[2]! : call.arguments[1]!;
  const piece = () => factory.createIdentifier('spanPiece');
  const remain = () => factory.createIdentifier('spanRemain');
  const cursorName = () => factory.createIdentifier(cursor);
  const spawn = factory.createCallExpression(cloneExpression(call.expression), undefined, [
    cloneExpression(call.arguments[0]!),
    vertical ? cloneExpression(call.arguments[1]!) : factory.createBinaryExpression(cursorName(), ts.SyntaxKind.PlusToken, factory.createBinaryExpression(piece(), ts.SyntaxKind.SlashToken, numeric(2))),
    vertical ? factory.createBinaryExpression(cursorName(), ts.SyntaxKind.PlusToken, factory.createBinaryExpression(piece(), ts.SyntaxKind.SlashToken, numeric(2))) : cloneExpression(call.arguments[2]!),
    vertical ? numeric(known) : piece(),
    vertical ? piece() : numeric(known),
    cloneExpression(call.arguments[5]!),
  ]);
  return factory.createBlock([
    constStatement(span, cloneExpression(sizeArgument)),
    letStatement(cursor, factory.createBinaryExpression(cloneExpression(centerArgument), ts.SyntaxKind.MinusToken, factory.createBinaryExpression(factory.createIdentifier(span), ts.SyntaxKind.SlashToken, numeric(2)))),
    letStatement('spanRemain', factory.createIdentifier(span)),
    factory.createWhileStatement(
      factory.createBinaryExpression(remain(), ts.SyntaxKind.GreaterThanEqualsToken, numeric(1)),
      factory.createBlock([
        constStatement('spanPiece', factory.createConditionalExpression(
          factory.createBinaryExpression(remain(), ts.SyntaxKind.GreaterThanToken, numeric(MAX_SIZE)),
          factory.createToken(ts.SyntaxKind.QuestionToken),
          numeric(MAX_SIZE),
          factory.createToken(ts.SyntaxKind.ColonToken),
          remain(),
        )),
        factory.createExpressionStatement(spawn),
        factory.createExpressionStatement(factory.createBinaryExpression(cursorName(), ts.SyntaxKind.EqualsToken, factory.createBinaryExpression(cursorName(), ts.SyntaxKind.PlusToken, piece()))),
        factory.createExpressionStatement(factory.createBinaryExpression(remain(), ts.SyntaxKind.EqualsToken, factory.createBinaryExpression(remain(), ts.SyntaxKind.MinusToken, piece()))),
      ], true),
    ),
  ], true);
}

function constStatement(name: string, initializer: ts.Expression): ts.VariableStatement {
  return ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
    ts.factory.createVariableDeclaration(name, undefined, undefined, initializer),
  ], ts.NodeFlags.Const));
}

function letStatement(name: string, initializer: ts.Expression): ts.VariableStatement {
  return ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
    ts.factory.createVariableDeclaration(name, undefined, undefined, initializer),
  ], ts.NodeFlags.Let));
}

function stateAccess(key: string): ts.PropertyAccessExpression {
  return ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('api'), 'state'), key);
}

function stateKeyName(node: ts.Expression): string | undefined {
  const current = unwrap(node);
  if (!ts.isPropertyAccessExpression(current) || !ts.isIdentifier(current.name)) return undefined;
  const state = current.expression;
  if (!ts.isPropertyAccessExpression(state) || !ts.isIdentifier(state.name) || state.name.text !== 'state') return undefined;
  if (!ts.isIdentifier(state.expression) || state.expression.text !== 'api') return undefined;
  return current.name.text;
}

function isSpawn(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && isNamedCall(node, 'spawn');
}

function isNamedCall(node: ts.CallExpression, name: string): boolean {
  return ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'api' && node.expression.name.text === name;
}

function assignedKeys(root: ts.Node): Set<string> {
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const key = stateKeyName(node.left);
      if (key && !isUndefinedLike(unwrap(node.right))) keys.add(key);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return keys;
}

function cloneExpression(node: ts.Expression): ts.Expression {
  const factory = ts.factory;
  if (ts.isIdentifier(node)) return factory.createIdentifier(node.text);
  if (ts.isNumericLiteral(node)) return factory.createNumericLiteral(node.text);
  if (ts.isStringLiteral(node)) return factory.createStringLiteral(node.text);
  if (ts.isNoSubstitutionTemplateLiteral(node)) return factory.createNoSubstitutionTemplateLiteral(node.text);
  if (ts.isPropertyAccessExpression(node)) return factory.createPropertyAccessExpression(cloneExpression(node.expression), node.name.text);
  if (ts.isParenthesizedExpression(node)) return factory.createParenthesizedExpression(cloneExpression(node.expression));
  if (ts.isBinaryExpression(node)) return factory.createBinaryExpression(cloneExpression(node.left), node.operatorToken.kind, cloneExpression(node.right));
  if (ts.isPrefixUnaryExpression(node)) return factory.createPrefixUnaryExpression(node.operator, cloneExpression(node.operand));
  if (ts.isCallExpression(node)) return factory.createCallExpression(cloneExpression(node.expression), undefined, node.arguments.map((argument) => cloneExpression(argument)));
  if (ts.isElementAccessExpression(node) && node.argumentExpression) return factory.createElementAccessExpression(cloneExpression(node.expression), cloneExpression(node.argumentExpression));
  return factory.createIdentifier(node.getText());
}

function cloneStatement(statement: ts.Statement): ts.Statement {
  if (!ts.isVariableStatement(statement)) return statement;
  const declaration = statement.declarationList.declarations[0];
  if (!declaration || !ts.isIdentifier(declaration.name) || !declaration.initializer) return statement;
  return ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
    ts.factory.createVariableDeclaration(declaration.name.text, undefined, undefined, cloneExpression(declaration.initializer)),
  ], statement.declarationList.flags));
}
