import ts from 'typescript';

export interface PreparedSource { source: string; notes: string[] }

const MAX_SIZE = 200;

/** Safe, behavior-preserving edits for shapes the model repeats:
 * undefined is not a legal state value, setup numbers are not in scope in
 * update, api.get can miss, and one entity cannot be taller or wider than 200.
 */
export function prepareGeneratedSource(source: string): PreparedSource {
  const parsed = ts.createSourceFile('game.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const parseDiagnostics = (parsed as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return { source, notes: [] };
  const notes: string[] = [];
  const renamed = renameTopBindings(parsed);
  const hoisted = hoistSetupFunctions(renamed.file);
  const captured = bindHelperCaptures(hoisted.file);
  const kinds = alignPipeKinds(captured.file);
  const tree = kinds.file;
  const create = functionBody(tree, 'create');
  const update = functionBody(tree, 'update');
  if (!create || !update) return renamed.changed || hoisted.changed || captured.changed || kinds.changed ? { source: printFile(tree), notes } : { source, notes };
  const shared = constsToCopy(create, update, notes);
  const playerLink = missingPlayerLink(create, update);
  const timers = spawnTimers(update);
  const numberKeys = initializedNumberKeys(create);
  let changed = renamed.changed || hoisted.changed || captured.changed || kinds.changed || shared.length > 0 || playerLink !== undefined || timers.size > 0;
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
  const printed = printFile(factory.updateSourceFile(tree, nextFunctions));
  return { source: printed, notes };
}

function printFile(file: ts.SourceFile): string {
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(file);
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
    let statement = statements[index]!;
    if (isUndefinedStateAssignment(statement)) { changed = true; continue; }
    const expressions = fixStateExpressions(statement);
    if (expressions.changed) { statement = expressions.statement; changed = true; }
    const loop = entitiesForEach(statement);
    if (loop) {
      const inner = rewriteStatements(loop.body, new Map(constants), false, true);
      output.push(ts.factory.createForOfStatement(
        undefined,
        ts.factory.createVariableDeclarationList([ts.factory.createVariableDeclaration(loop.parameter, undefined, undefined, undefined)], ts.NodeFlags.Const),
        loop.list,
        ts.factory.createBlock(inner.statements, true),
      ));
      changed = true;
      continue;
    }
    const arrow = rewriteArrowBody(statement, constants, inLoop);
    if (arrow) {
      output.push(arrow);
      changed = true;
      rememberConst(arrow, constants);
      continue;
    }
    const nested = rewriteNested(statement, constants, canReturn, inLoop);
    if (nested) {
      output.push(...nested.statements);
      if (nested.changed) changed = true;
      rememberConst(statement, constants);
      continue;
    }
    const recovered = recoverStackedSpawn(statements, index, constants, inLoop);
    if (recovered) {
      output.push(recovered.statement);
      index = recovered.last;
      changed = true;
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

function recoverStackedSpawn(statements: readonly ts.Statement[], index: number, constants: ReadonlyMap<string, number>, inLoop: boolean): { statement: ts.Statement; last: number } | undefined {
  if (inLoop) return undefined;
  const statement = statements[index];
  const decl = statement ? constDecl(statement) : undefined;
  if (!statement || !decl) return undefined;
  const stacked = dynamicStack(decl.initializer, constants, false);
  if (!stacked) return undefined;
  const skip = new Set<number>([index]);
  for (let next = index + 1; next < statements.length && isRedundantHp(statements[next]!, decl.name); next += 1) skip.add(next);
  if (skip.size === 1 || identifierUsed(statements, decl.name, skip)) return undefined;
  return { statement: stacked, last: Math.max(...skip) };
}

function isRedundantHp(statement: ts.Statement, name: string): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false;
  const assignment = statement.expression;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isNumericLiteral(assignment.right) || assignment.right.text !== '1') return false;
  const target = assignment.left;
  return ts.isPropertyAccessExpression(target) && target.name.text === 'hp' && ts.isIdentifier(target.expression) && target.expression.text === name;
}

function identifierUsed(statements: readonly ts.Statement[], name: string, skip: ReadonlySet<number>): boolean {
  let used = false;
  const visit = (node: ts.Node): void => {
    if (used) return;
    if (ts.isPropertyAccessExpression(node)) { visit(node.expression); return; }
    if (ts.isIdentifier(node) && node.text === name) used = true;
    else ts.forEachChild(node, visit);
  };
  statements.forEach((statement, index) => { if (!skip.has(index)) visit(statement); });
  return used;
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
  if (!parent) return false;
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
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === current) return;
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
      if (!(parent && ts.isPropertyAccessExpression(parent) && parent.name === current)) names.push(current.text);
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

function renameTopBindings(tree: ts.SourceFile): { file: ts.SourceFile; changed: boolean } {
  if (!declaresName(tree, 'top')) return { file: tree, changed: false };
  let changed = false;
  const result = ts.transform(tree, [(context) => (file) => {
    const visit = (node: ts.Node): ts.Node => {
      if (isFunctionLike(node) && declaresName(node, 'top')) {
        changed = true;
        return renameTopIn(node, context);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(file, visit) as ts.SourceFile;
  }]);
  const file = result.transformed[0];
  result.dispose();
  return changed && file && ts.isSourceFile(file) ? { file, changed: true } : { file: tree, changed: false };
}

function renameTopIn(node: ts.Node, context: ts.TransformationContext): ts.Node {
  const replacement = bindingNames(node).has('upperPipe') ? 'pipeTop' : 'upperPipe';
  const visit = (child: ts.Node): ts.Node => {
    if (child !== node && isFunctionLike(child) && declaresName(child, 'top')) return renameTopIn(child, context);
    if (ts.isIdentifier(child) && child.text === 'top' && !isPropertyName(child)) return context.factory.createIdentifier(replacement);
    return ts.visitEachChild(child, visit, context);
  };
  return visit(node);
}

function unboundNames(statements: readonly ts.Statement[]): string[] {
  const local = bindings(ts.factory.createBlock(statements));
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) { visit(node.expression); return; }
    if (ts.isIdentifier(node)) names.push(node.text);
    else ts.forEachChild(node, visit);
  };
  statements.forEach(visit);
  return [...new Set(names)].filter((name) => name !== 'api' && name !== 'Math' && !local.has(name));
}

function bindHelperCaptures(tree: ts.SourceFile): { file: ts.SourceFile; changed: boolean } {
  const create = functionBody(tree, 'create');
  const numbers = create ? createNumbers(create) : { consts: new Map<string, number>(), state: new Map<string, number>() };
  let changed = false;
  const statements = tree.statements.map((statement) => {
    if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.name) return statement;
    if (statement.name.text === 'create' || statement.name.text === 'update') return statement;
    const typed = typeApiParameter(statement);
    const target = typed ?? statement;
    const replaced = replaceCapturedNumbers(target, numbers);
    if (!typed && !replaced) return statement;
    changed = true;
    return replaced ?? typed ?? statement;
  });
  return changed ? { file: ts.factory.updateSourceFile(tree, statements), changed } : { file: tree, changed: false };
}

function createNumbers(create: ts.Block): { consts: Map<string, number>; state: Map<string, number> } {
  const consts = new Map<string, number>();
  const state = new Map<string, number>();
  for (const statement of create.statements) {
    const decl = constDecl(statement);
    if (decl) {
      const value = resolveNumber(decl.initializer, consts);
      if (value !== undefined) consts.set(decl.name, value);
    }
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
    const expression = statement.expression;
    if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const key = stateKeyName(expression.left);
    const value = key ? resolveNumber(expression.right, consts) : undefined;
    if (key && value !== undefined) state.set(key, value);
  }
  return { consts, state };
}

function typeApiParameter(fn: ts.FunctionDeclaration): ts.FunctionDeclaration | undefined {
  if (!fn.name || !fn.body) return undefined;
  let changed = false;
  const parameters = fn.parameters.map((parameter) => {
    if (!ts.isIdentifier(parameter.name) || parameter.name.text !== 'api' || parameter.type) return parameter;
    changed = true;
    return ts.factory.createParameterDeclaration(undefined, undefined, parameter.name, undefined, ts.factory.createTypeReferenceNode('GameAPI'), undefined);
  });
  return changed ? ts.factory.updateFunctionDeclaration(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.typeParameters, parameters, fn.type, fn.body) : undefined;
}

function replaceCapturedNumbers(fn: ts.FunctionDeclaration, numbers: { consts: Map<string, number>; state: Map<string, number> }): ts.FunctionDeclaration | undefined {
  if (!fn.body || !fn.name) return undefined;
  const local = bindings(fn);
  let changed = false;
  const result = ts.transform(fn.body, [(context): ts.Transformer<ts.Block> => (node) => {
    const visit = (child: ts.Node): ts.Node => {
      if (child !== node && isFunctionLike(child)) return child;
      if (ts.isIdentifier(child) && !local.has(child.text) && !isPropertyName(child) && !isDeclarationName(child)) {
        const literal = numbers.consts.get(child.text);
        if (literal !== undefined) { changed = true; return context.factory.createNumericLiteral(String(literal)); }
        if (numbers.state.has(child.text)) { changed = true; return context.factory.createParenthesizedExpression(context.factory.createBinaryExpression(stateAccess(child.text), ts.SyntaxKind.QuestionQuestionToken, numeric(0))); }
      }
      return ts.visitEachChild(child, visit, context);
    };
    return ts.visitNode(node, visit) as ts.Block;
  }]);
  const body = result.transformed[0];
  result.dispose();
  if (!changed || !body || !ts.isBlock(body)) return undefined;
  return ts.factory.updateFunctionDeclaration(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, body);
}

function alignPipeKinds(tree: ts.SourceFile): { file: ts.SourceFile; changed: boolean } {
  const pipeSpawns = pipeSpawnCalls(tree);
  if (pipeSpawns.length !== 2 || !unreachableKindComparison(tree, 'pipe', 'upperPipe')) return { file: tree, changed: false };
  let index = 0;
  const result = ts.transform(tree, [(context): ts.Transformer<ts.SourceFile> => (node) => {
    const visit = (child: ts.Node): ts.Node => {
      if (ts.isCallExpression(child) && pipeSpawns.includes(child)) {
        const kind = index === 0 ? 'upperPipe' : 'lowerPipe';
        index += 1;
        const args = [...child.arguments];
        args[0] = context.factory.createStringLiteral(kind);
        return context.factory.updateCallExpression(child, child.expression, child.typeArguments, args);
      }
      if (isKindComparison(child, 'pipe')) return kindEither(context.factory, child);
      return ts.visitEachChild(child, visit, context);
    };
    return ts.visitNode(node, visit) as ts.SourceFile;
  }]);
  const file = result.transformed[0];
  result.dispose();
  return file && ts.isSourceFile(file) ? { file, changed: true } : { file: tree, changed: false };
}

function pipeSpawnCalls(tree: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'spawn' && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'api') {
      const kind = node.arguments[0];
      if (kind && ts.isStringLiteral(kind) && kind.text === 'pipe') calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return calls;
}

function unreachableKindComparison(tree: ts.SourceFile, narrowed: string, other: string): boolean {
  let found = false;
  const visit = (node: ts.Node, active: boolean): void => {
    if (ts.isIfStatement(node) && isKindComparison(node.expression, narrowed)) {
      visit(node.thenStatement, true);
      if (node.elseStatement) visit(node.elseStatement, active);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (isKindComparison(node.left, narrowed)) visit(node.right, true);
      else if (isKindComparison(node.right, narrowed)) visit(node.left, true);
      else { visit(node.left, active); visit(node.right, active); }
      return;
    }
    if (active && isKindComparison(node, other)) found = true;
    ts.forEachChild(node, (child) => visit(child, active));
  };
  visit(tree, false);
  return found;
}

function isKindComparison(node: ts.Node, kind: string): node is ts.BinaryExpression {
  if (!ts.isBinaryExpression(node)) return false;
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken) return false;
  const left = unwrap(node.left);
  const right = unwrap(node.right);
  const literal = ts.isStringLiteral(right) ? right : ts.isStringLiteral(left) ? left : undefined;
  const access = literal === right ? left : literal === left ? right : undefined;
  return !!literal && literal.text === kind && !!access && ts.isPropertyAccessExpression(access) && access.name.text === 'kind';
}

function kindEither(factory: ts.NodeFactory, comparison: ts.BinaryExpression): ts.Expression {
  const access = ts.isPropertyAccessExpression(unwrap(comparison.left)) ? comparison.left : comparison.right;
  const one = (kind: string) => factory.createBinaryExpression(cloneExpression(access), ts.SyntaxKind.EqualsEqualsEqualsToken, factory.createStringLiteral(kind));
  return factory.createParenthesizedExpression(factory.createBinaryExpression(one('upperPipe'), ts.SyntaxKind.BarBarToken, one('lowerPipe')));
}

function hoistSetupFunctions(tree: ts.SourceFile): { file: ts.SourceFile; changed: boolean } {
  const create = functionBody(tree, 'create');
  const update = functionBody(tree, 'update');
  if (!create || !update) return { file: tree, changed: false };
  const taken = bindings(update);
  const values = new Map<string, number>();
  const lifted: ts.Statement[] = [];
  const names = new Set<string>();
  const kept: ts.Statement[] = [];
  for (const statement of create.statements) {
    const arrow = hoistCandidate(statement, taken, values);
    const decl = constDecl(statement);
    if (decl) {
      const value = resolveNumber(decl.initializer, values);
      if (value !== undefined) values.set(decl.name, value);
    }
    if (!arrow || !callsAreZeroArg(tree, arrow.name)) { kept.push(statement); continue; }
    const body = substituteNumbers(arrow.body, arrow.values);
    const rewritten = rewriteStatements([...body.statements], new Map(), false, false);
    if (unboundNames(rewritten.statements).length > 0) { kept.push(statement); continue; }
    lifted.push(hoistedFunction(arrow.name, rewritten.statements));
    names.add(arrow.name);
  }
  if (names.size === 0) return { file: tree, changed: false };
  const factory = ts.factory;
  const statements = tree.statements.map((statement) => {
    if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.name) return statement;
    const body = statement.name.text === 'create' ? kept : [...statement.body.statements];
    const calls = rewriteZeroArgCalls(statement.name.text === 'create' ? body : [...statement.body.statements], names);
    if (statement.name.text !== 'create' && statement.name.text !== 'update') return statement;
    return factory.updateFunctionDeclaration(statement, statement.modifiers, statement.asteriskToken, statement.name, statement.typeParameters, statement.parameters, statement.type, factory.updateBlock(statement.body, calls));
  });
  return { file: factory.updateSourceFile(tree, [...statements, ...lifted]), changed: true };
}

function hoistCandidate(statement: ts.Statement, taken: ReadonlySet<string>, values: ReadonlyMap<string, number>): { name: string; body: ts.Block; values: Map<string, number> } | undefined {
  const decl = constDecl(statement);
  if (!decl || taken.has(decl.name)) return undefined;
  const fn = unwrap(decl.initializer);
  if ((!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) || fn.parameters.length > 0 || !ts.isBlock(fn.body)) return undefined;
  const locals = bindings(fn);
  const captured = new Map<string, number>();
  for (const name of identifiers(fn.body)) {
    if (name === 'api' || name === 'Math' || locals.has(name) || decl.name === name) continue;
    const value = values.get(name);
    if (value === undefined) return undefined;
    captured.set(name, value);
  }
  return { name: decl.name, body: fn.body, values: captured };
}

function callsAreZeroArg(root: ts.Node, name: string): boolean {
  let seen = false;
  let ok = true;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      seen = true;
      if (node.arguments.length !== 0) ok = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return seen && ok;
}

function rewriteZeroArgCalls(statements: readonly ts.Statement[], names: ReadonlySet<string>): ts.Statement[] {
  return statements.map((statement) => rewriteCallStatement(statement, names));
}

function rewriteCallStatement(statement: ts.Statement, names: ReadonlySet<string>): ts.Statement {
  const factory = ts.factory;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && ts.isIdentifier(statement.expression.expression) && names.has(statement.expression.expression.text) && statement.expression.arguments.length === 0) {
    return factory.createExpressionStatement(factory.createCallExpression(factory.createIdentifier(statement.expression.expression.text), undefined, [factory.createIdentifier('api')]));
  }
  if (ts.isBlock(statement)) return factory.updateBlock(statement, rewriteZeroArgCalls(statement.statements, names));
  if (ts.isIfStatement(statement)) {
    return factory.updateIfStatement(statement, statement.expression, rewriteCallStatement(statement.thenStatement, names), statement.elseStatement ? rewriteCallStatement(statement.elseStatement, names) : undefined);
  }
  if (ts.isForOfStatement(statement)) return factory.updateForOfStatement(statement, statement.awaitModifier, statement.initializer, statement.expression, rewriteCallStatement(statement.statement, names));
  if (ts.isForStatement(statement)) return factory.updateForStatement(statement, statement.initializer, statement.condition, statement.incrementor, rewriteCallStatement(statement.statement, names));
  if (ts.isWhileStatement(statement)) return factory.updateWhileStatement(statement, statement.expression, rewriteCallStatement(statement.statement, names));
  if (ts.isDoStatement(statement)) return factory.updateDoStatement(statement, rewriteCallStatement(statement.statement, names), statement.expression);
  return statement;
}

function hoistedFunction(name: string, statements: readonly ts.Statement[]): ts.FunctionDeclaration {
  const factory = ts.factory;
  return factory.createFunctionDeclaration(
    undefined,
    undefined,
    factory.createIdentifier(name),
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier('api'), undefined, factory.createTypeReferenceNode('GameAPI'), undefined)],
    factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
    factory.createBlock(statements, true),
  );
}

function substituteNumbers(body: ts.Block, values: ReadonlyMap<string, number>): ts.Block {
  if (values.size === 0) return body;
  const result = ts.transform(body, [(context): ts.Transformer<ts.Block> => (node) => {
    const visit = (child: ts.Node): ts.Node => {
      if (child !== node && isFunctionLike(child)) return child;
      if (ts.isIdentifier(child) && values.has(child.text) && !isPropertyName(child) && !isDeclarationName(child)) {
        return context.factory.createNumericLiteral(String(values.get(child.text)));
      }
      return ts.visitEachChild(child, visit, context);
    };
    return ts.visitNode(node, visit) as ts.Block;
  }]);
  const block = result.transformed[0];
  result.dispose();
  return block && ts.isBlock(block) ? block : body;
}

function fixStateExpressions(statement: ts.Statement): { statement: ts.Statement; changed: boolean } {
  if (ts.isExpressionStatement(statement)) {
    const expression = mapStateExpression(statement.expression);
    if (!expression.changed) return { statement, changed: false };
    return { statement: ts.factory.createExpressionStatement(expression.node), changed: true };
  }
  if (ts.isIfStatement(statement)) {
    const expression = mapStateExpression(statement.expression);
    if (!expression.changed) return { statement, changed: false };
    return { statement: ts.factory.updateIfStatement(statement, expression.node, statement.thenStatement, statement.elseStatement), changed: true };
  }
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0]!;
    if (!declaration.initializer) return { statement, changed: false };
    const expression = mapStateExpression(declaration.initializer);
    if (!expression.changed || !ts.isIdentifier(declaration.name)) return { statement, changed: false };
    return {
      statement: ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
        ts.factory.createVariableDeclaration(declaration.name.text, undefined, undefined, expression.node),
      ], statement.declarationList.flags)),
      changed: true,
    };
  }
  return { statement, changed: false };
}

function mapStateExpression(node: ts.Expression): { node: ts.Expression; changed: boolean } {
  const factory = ts.factory;
  if (ts.isParenthesizedExpression(node)) {
    const inner = mapStateExpression(node.expression);
    return inner.changed ? { node: factory.createParenthesizedExpression(inner.node), changed: true } : { node, changed: false };
  }
  if (!ts.isBinaryExpression(node)) return { node, changed: false };
  if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && neverNullish(node.left)) {
    const inner = mapStateExpression(node.left);
    return { node: inner.node, changed: true };
  }
  const compared = stateBooleanLiteral(node);
  if (compared) return { node: compared, changed: true };
  const left = mapStateExpression(node.left);
  const right = mapStateExpression(node.right);
  if (!left.changed && !right.changed) return { node, changed: false };
  return { node: factory.createBinaryExpression(left.node, node.operatorToken.kind, right.node), changed: true };
}

function stateBooleanLiteral(node: ts.BinaryExpression): ts.Expression | undefined {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken && node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken && node.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken && node.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken) return undefined;
  if (!stateKeyName(node.left)) return undefined;
  const value = node.right.kind === ts.SyntaxKind.TrueKeyword ? 1 : node.right.kind === ts.SyntaxKind.FalseKeyword ? 0 : undefined;
  if (value === undefined) return undefined;
  return ts.factory.createBinaryExpression(cloneExpression(node.left), node.operatorToken.kind, numeric(value));
}

function neverNullish(node: ts.Expression): boolean {
  const current = unwrap(node);
  if (ts.isNumericLiteral(current) || current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (!ts.isBinaryExpression(current)) return false;
  const kind = current.operatorToken.kind;
  return kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.LessThanToken || kind === ts.SyntaxKind.GreaterThanToken || kind === ts.SyntaxKind.LessThanEqualsToken || kind === ts.SyntaxKind.GreaterThanEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsToken;
}

function entitiesForEach(statement: ts.Statement): { parameter: string; list: ts.Expression; body: ts.Statement[] } | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return undefined;
  const call = statement.expression;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'forEach' || call.arguments.length !== 1) return undefined;
  const list = unwrap(callee.expression);
  if (!ts.isPropertyAccessExpression(list) || list.name.text !== 'entities' || !ts.isIdentifier(list.expression) || list.expression.text !== 'api') return undefined;
  const callback = unwrap(call.arguments[0]!);
  const parameter = callback && ts.isArrowFunction(callback) ? callback.parameters[0] : undefined;
  if (!ts.isArrowFunction(callback) || !parameter || !ts.isIdentifier(parameter.name)) return undefined;
  if (ts.isBlock(callback.body)) {
    if (containsReturn(callback.body)) return undefined;
    return { parameter: parameter.name.text, list: callee.expression, body: [...callback.body.statements] };
  }
  return { parameter: parameter.name.text, list: callee.expression, body: [ts.factory.createExpressionStatement(callback.body)] };
}

function rewriteArrowBody(statement: ts.Statement, constants: Map<string, number>, inLoop: boolean): ts.Statement | undefined {
  const decl = constDecl(statement);
  if (!decl) return undefined;
  const fn = unwrap(decl.initializer);
  if (!ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) return undefined;
  const inner = rewriteStatements([...fn.body.statements], new Map(constants), false, inLoop);
  if (!inner.changed) return undefined;
  const factory = ts.factory;
  const next = factory.createArrowFunction(undefined, undefined, fn.parameters.map((parameter) => factory.createParameterDeclaration(undefined, undefined, parameter.name, undefined, parameter.type, undefined)), undefined, factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), factory.createBlock(inner.statements, true));
  return factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
    factory.createVariableDeclaration(decl.name, undefined, undefined, next),
  ], ts.NodeFlags.Const));
}

function containsReturn(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found || (child !== node && isFunctionLike(child))) return;
    if (ts.isReturnStatement(child)) found = true;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function declaresName(node: ts.Node, name: string): boolean {
  return bindingNames(node).has(name);
}

function bindingNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (child !== node && isFunctionLike(child)) return;
    if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) names.add(child.name.text);
    if (isFunctionLike(child)) child.parameters.forEach((parameter) => { if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text); });
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return !!parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return !!parent && ((ts.isVariableDeclaration(parent) && parent.name === node) || (isFunctionLike(parent) && parent.name === node));
}
