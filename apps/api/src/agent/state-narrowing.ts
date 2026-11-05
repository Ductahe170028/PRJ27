import ts from 'typescript';
import { prepareGeneratedSource } from './source-prepare.js';

export interface StateNarrowing { source: string; notes: string[] }

const NUMERIC_FIELDS = new Set(['x', 'y', 'vx', 'vy', 'hp', 'width', 'height', 'id', 'color']);
const MATH_METHODS = new Set(['random', 'floor', 'ceil', 'round', 'abs', 'min', 'max', 'sqrt', 'sin', 'cos', 'atan2', 'hypot']);
const ASSIGNMENT = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
const COMPOUND = new Map<ts.SyntaxKind, ts.BinaryOperator>([
  [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
  [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
  [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
  [ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.SlashToken],
  [ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.PercentToken],
]);

interface Shared { context: ts.TransformationContext; notes: string[]; used: Set<string>; seen: Set<string> }
interface ExprCtx { shared: Shared; ready: ReadonlySet<string>; pending: ts.Statement[]; hoist: boolean; discard: boolean }
type Expectation = 'id' | 'number' | 'entity' | 'none';

// Rewrites only reads whose runtime result cannot change: a compound update of
// a missing counter is NaN, a missing entity id passed to get() misses, and
// `?? 0` on a key assigned a number in setup is a type-only no-op. Anything
// else stays in the source and is described for the repair model.
// prepareGeneratedSource first removes assignments the runtime cannot store,
// copies numeric setup constants into update, guards api.get, and splits
// entities taller or wider than the runtime limit.
export function narrowStateReads(source: string): StateNarrowing {
  const prepared = prepareGeneratedSource(source);
  const narrowed = narrowPrepared(prepared.source);
  return { source: narrowed.source, notes: [...prepared.notes, ...narrowed.notes] };
}

function narrowPrepared(source: string): StateNarrowing {
  const tree = ts.createSourceFile('game.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const parseDiagnostics = (tree as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return { source, notes: [] };
  const notes: string[] = [];
  const used = new Set<string>();
  collectIdentifiers(tree, used);
  const readyAfterCreate = readyAtEndOfCreate(tree);
  let changed = false;
  const result = ts.transform(tree, [(context) => (file) => {
    const shared: Shared = { context, notes, used, seen: new Set() };
    const statements = file.statements.map((statement) => {
      if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) return statement;
      const initial = statement.name.text === 'update' ? readyAfterCreate : new Set<string>();
      const body = transformBlock(statement.body, initial, shared);
      if (body === statement.body) return statement;
      changed = true;
      return context.factory.updateFunctionDeclaration(statement, statement.modifiers, statement.asteriskToken, statement.name, statement.typeParameters, statement.parameters, statement.type, body);
    });
    return context.factory.updateSourceFile(file, statements);
  }]);
  const transformed = result.transformed[0];
  const printed = changed && transformed ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed) : source;
  result.dispose();
  return { source: printed, notes };
}

function readyAtEndOfCreate(tree: ts.SourceFile): Set<string> {
  const ready = new Set<string>();
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'create' && statement.body) {
      for (const inner of statement.body.statements) applyStatement(inner, ready);
    }
  }
  return ready;
}

function collectIdentifiers(node: ts.Node, used: Set<string>): void {
  if (ts.isIdentifier(node)) used.add(node.text);
  ts.forEachChild(node, (child) => collectIdentifiers(child, used));
}

function transformBlock(block: ts.Block, ready: ReadonlySet<string>, shared: Shared): ts.Block {
  const local = new Set(ready);
  const statements: ts.Statement[] = [];
  let different = false;
  for (const statement of block.statements) {
    const pending: ts.Statement[] = [];
    const next = transformStatement(statement, local, shared, pending);
    if (pending.length > 0 || next !== statement) different = true;
    statements.push(...pending, next);
    applyStatement(statement, local);
  }
  return different ? shared.context.factory.updateBlock(block, statements) : block;
}

function transformStatement(statement: ts.Statement, ready: ReadonlySet<string>, shared: Shared, pending: ts.Statement[]): ts.Statement {
  const ctx: ExprCtx = { shared, ready, pending, hoist: true, discard: false };
  const factory = shared.context.factory;
  if (ts.isBlock(statement)) return transformBlock(statement, new Set(ready), shared);
  if (ts.isIfStatement(statement)) {
    const expression = transformExpr(statement.expression, ctx);
    const thenStatement = transformNested(statement.thenStatement, ready, shared);
    const elseStatement = statement.elseStatement && transformNested(statement.elseStatement, ready, shared);
    if (expression === statement.expression && thenStatement === statement.thenStatement && elseStatement === statement.elseStatement) return statement;
    return factory.updateIfStatement(statement, expression, thenStatement, elseStatement);
  }
  if (ts.isForOfStatement(statement)) {
    const expression = transformExpr(statement.expression, ctx);
    const body = transformNested(statement.statement, ready, shared);
    if (expression === statement.expression && body === statement.statement) return statement;
    return factory.updateForOfStatement(statement, statement.awaitModifier, statement.initializer, expression, body);
  }
  if (ts.isForStatement(statement)) {
    const initializer = statement.initializer && transformForInitializer(statement.initializer, ctx);
    const condition = statement.condition && transformExpr(statement.condition, { ...ctx, hoist: false });
    const incrementor = statement.incrementor && transformExpr(statement.incrementor, { ...ctx, hoist: false, discard: true });
    const body = transformNested(statement.statement, ready, shared);
    if (initializer === statement.initializer && condition === statement.condition && incrementor === statement.incrementor && body === statement.statement) return statement;
    return factory.updateForStatement(statement, initializer, condition, incrementor, body);
  }
  if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    const expression = transformExpr(statement.expression, { ...ctx, hoist: false });
    const body = transformNested(statement.statement, ready, shared);
    if (expression === statement.expression && body === statement.statement) return statement;
    return ts.isWhileStatement(statement)
      ? factory.updateWhileStatement(statement, expression, body)
      : factory.updateDoStatement(statement, body, expression);
  }
  if (ts.isExpressionStatement(statement)) {
    const expression = transformExpr(statement.expression, { ...ctx, discard: true });
    return expression === statement.expression ? statement : factory.updateExpressionStatement(statement, expression);
  }
  if (ts.isVariableStatement(statement)) {
    const declarationList = transformDeclarationList(statement.declarationList, ctx);
    return declarationList === statement.declarationList ? statement : factory.updateVariableStatement(statement, statement.modifiers, declarationList);
  }
  if (ts.isReturnStatement(statement) && statement.expression) {
    const expression = transformExpr(statement.expression, ctx);
    return expression === statement.expression ? statement : factory.updateReturnStatement(statement, expression);
  }
  if (ts.isFunctionDeclaration(statement) && statement.body) {
    const body = transformBlock(statement.body, new Set(ready), shared);
    return body === statement.body ? statement : factory.updateFunctionDeclaration(statement, statement.modifiers, statement.asteriskToken, statement.name, statement.typeParameters, statement.parameters, statement.type, body);
  }
  return statement;
}

function transformNested(statement: ts.Statement, ready: ReadonlySet<string>, shared: Shared): ts.Statement {
  if (ts.isBlock(statement)) return transformBlock(statement, ready, shared);
  const pending: ts.Statement[] = [];
  const next = transformStatement(statement, ready, shared, pending);
  if (pending.length === 0) return next;
  return shared.context.factory.createBlock([...pending, next], true);
}

function transformForInitializer(initializer: ts.ForInitializer, ctx: ExprCtx): ts.ForInitializer {
  return ts.isVariableDeclarationList(initializer) ? transformDeclarationList(initializer, ctx) : transformExpr(initializer, ctx);
}

function transformDeclarationList(list: ts.VariableDeclarationList, ctx: ExprCtx): ts.VariableDeclarationList {
  let different = false;
  const declarations = list.declarations.map((declaration) => {
    if (!declaration.initializer) return declaration;
    const initializer = transformExpr(declaration.initializer, ctx);
    if (initializer === declaration.initializer) return declaration;
    different = true;
    return ctx.shared.context.factory.updateVariableDeclaration(declaration, declaration.name, declaration.exclamationToken, declaration.type, initializer);
  });
  return different ? ctx.shared.context.factory.updateVariableDeclarationList(list, declarations) : list;
}

function transformExpr(node: ts.Expression, ctx: ExprCtx): ts.Expression {
  const incDec = rewriteDiscardedIncDec(node, ctx);
  if (incDec) return incDec;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return transformNestedFunction(node, ctx);
  if (ts.isPropertyAccessExpression(node) && stateAccessKey(node)) return transformStateRead(node, ctx);
  if (ts.isBinaryExpression(node)) {
    const key = stateAccessKey(node.left);
    const operator = COMPOUND.get(node.operatorToken.kind);
    if (key && operator) {
      const right = transformExpr(node.right, descend(ctx));
      return ctx.shared.context.factory.createBinaryExpression(stateAccess(key), ts.SyntaxKind.EqualsToken, ctx.shared.context.factory.createBinaryExpression(coalesce(key, 0), operator, right));
    }
    if (isRelational(node.operatorToken.kind) && ctx.hoist && !containsAssignment(node) && hasUnreadyRead(node, ctx.ready)) return guardComparison(node, ctx);
  }
  return mapExpression(node, ctx.shared.context, (child) => transformExpr(child, descend(ctx)));
}

function rewriteDiscardedIncDec(node: ts.Expression, ctx: ExprCtx): ts.Expression | undefined {
  if (!ctx.discard || (!ts.isPrefixUnaryExpression(node) && !ts.isPostfixUnaryExpression(node))) return undefined;
  if (node.operator !== ts.SyntaxKind.PlusPlusToken && node.operator !== ts.SyntaxKind.MinusMinusToken) return undefined;
  const operand = ts.isParenthesizedExpression(node.operand) ? undefined : stateAccessKey(node.operand);
  if (!operand) return undefined;
  const operator = node.operator === ts.SyntaxKind.PlusPlusToken ? ts.SyntaxKind.PlusToken : ts.SyntaxKind.MinusToken;
  return ctx.shared.context.factory.createBinaryExpression(stateAccess(operand), ts.SyntaxKind.EqualsToken, ctx.shared.context.factory.createBinaryExpression(coalesce(operand, 0), operator, ctx.shared.context.factory.createNumericLiteral(1)));
}

function transformStateRead(node: ts.PropertyAccessExpression, ctx: ExprCtx): ts.Expression {
  const key = stateAccessKey(node);
  if (!key || isAssignmentTarget(node) || isCoalesceLeft(node) || isNonNullOperand(node)) return node;
  if (isUpdateTarget(node)) {
    note(ctx, `update:${key}`, `Expression \`${textOf(node.parent)}\` updates api.state.${key} (number | undefined), not an array. const timer = api.state.${key} ?? 0; api.state.${key} = timer + 1. Edit only this expression.`);
    return node;
  }
  if (isPropertyBase(node)) {
    note(ctx, `entity:${key}`, `Expression \`${textOf(node.parent)}\` reads a field on api.state.${key}. That slot is a number id, not an Entity or an array. const id = api.state.${key}; if (id !== undefined) { const entity = api.get(id); if (entity) { entity.y += entity.vy * dt; } }`);
    return node;
  }
  const expect = expectation(node);
  if (expect === 'entity') {
    note(ctx, `entity-arg:${key}`, `Expression \`${textOf(node)}\` is a number id, not an Entity. Pass the object from spawn or from api.get after checking the id. Do not store an Entity in api.state.`);
    return node;
  }
  if (expect === 'id') return coalesce(key, -1);
  if (expect === 'number' && ctx.ready.has(key)) return coalesce(key, 0);
  if (expect === 'number') {
    note(ctx, `number:${key}`, `Expression \`${textOf(node)}\` is number | undefined and api.state.${key} is not initialized with a number before this read. Not an array. Counter/timer: const timer = api.state.${key} ?? 0. Entity id, do not use ?? 0: const id = api.state.${key}; if (id !== undefined) { const entity = api.get(id); if (entity) {} } Edit only this expression.`);
  }
  return node;
}

function guardComparison(node: ts.BinaryExpression, ctx: ExprCtx): ts.Expression {
  const locals = new Map<string, ts.Identifier>();
  const left = rewriteGuardOperand(node.left, ctx, locals);
  const right = rewriteGuardOperand(node.right, ctx, locals);
  let expression: ts.Expression = ctx.shared.context.factory.createBinaryExpression(left, node.operatorToken, right);
  for (const name of locals.values()) {
    expression = ctx.shared.context.factory.createBinaryExpression(
      ctx.shared.context.factory.createBinaryExpression(name, ts.SyntaxKind.ExclamationEqualsEqualsToken, ctx.shared.context.factory.createIdentifier('undefined')),
      ts.SyntaxKind.AmpersandAmpersandToken,
      expression,
    );
  }
  return expression;
}

function rewriteGuardOperand(node: ts.Expression, ctx: ExprCtx, locals: Map<string, ts.Identifier>): ts.Expression {
  const key = stateAccessKey(node);
  if (key && !isSkippedRead(node)) {
    if (ctx.ready.has(key)) return coalesce(key, 0);
    const existing = locals.get(key);
    if (existing) return existing;
    const name = ctx.shared.context.factory.createIdentifier(fresh(key, ctx.shared.used));
    locals.set(key, name);
    ctx.pending.push(ctx.shared.context.factory.createVariableStatement(undefined, ctx.shared.context.factory.createVariableDeclarationList([
      ctx.shared.context.factory.createVariableDeclaration(name, undefined, undefined, stateAccess(key)),
    ], ts.NodeFlags.Const)));
    return name;
  }
  return mapExpression(node, ctx.shared.context, (child) => rewriteGuardOperand(child, ctx, locals));
}

function hasUnreadyRead(node: ts.Node, ready: ReadonlySet<string>): boolean {
  let found = false;
  const walk = (current: ts.Node): void => {
    if (found || (current !== node && ts.isFunctionLike(current))) return;
    const key = ts.isPropertyAccessExpression(current) ? stateAccessKey(current) : undefined;
    if (key && !ready.has(key) && !isSkippedRead(current)) found = true;
    else ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
}

function containsAssignment(node: ts.Node): boolean {
  let found = false;
  const walk = (current: ts.Node): void => {
    if (found || (current !== node && ts.isFunctionLike(current))) return;
    if (ts.isBinaryExpression(current) && ASSIGNMENT.has(current.operatorToken.kind)) found = true;
    else ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
}

function applyStatement(statement: ts.Statement, ready: Set<string>): void {
  if (!ts.isExpressionStatement(statement)) return;
  const expression = unwrap(statement.expression);
  if ((ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) && (expression.operator === ts.SyntaxKind.PlusPlusToken || expression.operator === ts.SyntaxKind.MinusMinusToken)) {
    const key = stateAccessKey(expression.operand);
    if (key) ready.add(key);
    return;
  }
  if (!ts.isBinaryExpression(expression)) return;
  const key = stateAccessKey(expression.left);
  if (!key) return;
  if (COMPOUND.has(expression.operatorToken.kind)) { ready.add(key); return; }
  if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken && expression.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionEqualsToken) return;
  if (rhsIsNumber(expression.right, ready)) ready.add(key);
  else ready.delete(key);
}

function rhsIsNumber(expression: ts.Expression, ready: ReadonlySet<string>): boolean {
  const node = unwrap(expression);
  if (ts.isNumericLiteral(node)) return true;
  if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken)) return rhsIsNumber(node.operand, ready);
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return rhsIsNumber(node.right, ready);
    if (isArithmetic(node.operatorToken.kind)) {
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken && (isStringLike(node.left) || isStringLike(node.right))) return false;
      return rhsIsNumber(node.left, ready) && rhsIsNumber(node.right, ready);
    }
    return false;
  }
  if (ts.isConditionalExpression(node)) return rhsIsNumber(node.whenTrue, ready) && rhsIsNumber(node.whenFalse, ready);
  if (ts.isIdentifier(node)) return node.text === 'dt';
  if (ts.isPropertyAccessExpression(node)) {
    const key = stateAccessKey(node);
    if (key) return ready.has(key);
    if (isApiNumber(node) || isInputNumber(node)) return true;
    return ts.isIdentifier(node.name) && NUMERIC_FIELDS.has(node.name.text) && !containsStateRead(node.expression);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Math' && MATH_METHODS.has(node.expression.name.text)) {
    return node.arguments.every((argument) => rhsIsNumber(argument, ready));
  }
  return false;
}

function expectation(node: ts.Node): Expectation {
  const current = skipUp(node);
  const parent = current.parent;
  if (!parent) return 'none';
  if (ts.isBinaryExpression(parent) && (parent.left === current || parent.right === current)) {
    if (isRelational(parent.operatorToken.kind) || isArithmetic(parent.operatorToken.kind)) return 'number';
    if (parent.right === current && COMPOUND.has(parent.operatorToken.kind)) return 'number';
    if (parent.right === current && (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken || parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken)) {
      if (stateAccessKey(parent.left)) return 'number';
      if (ts.isPropertyAccessExpression(parent.left) && ts.isIdentifier(parent.left.name) && NUMERIC_FIELDS.has(parent.left.name.text) && !containsStateRead(parent.left.expression)) return 'number';
    }
    return 'none';
  }
  if (ts.isPrefixUnaryExpression(parent) && (parent.operator === ts.SyntaxKind.PlusToken || parent.operator === ts.SyntaxKind.MinusToken) && parent.operand === current) return 'number';
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === current) return 'number';
  if (ts.isVariableDeclaration(parent) && parent.initializer === current && parent.type && isNumberType(parent.type)) return 'number';
  if (!ts.isCallExpression(parent)) return 'none';
  const index = parent.arguments.indexOf(current as ts.Expression);
  if (index < 0) return 'none';
  const callee = parent.expression;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
    const name = callee.name.text;
    if (ts.isIdentifier(callee.expression) && callee.expression.text === 'api') {
      if (name === 'get' && index === 0) return 'id';
      if (name === 'addScore' && index === 0) return 'number';
      if (name === 'spawn' && index >= 1) return 'number';
      if (name === 'setPlayer' || name === 'remove' || name === 'overlaps') return 'entity';
      return 'none';
    }
    if (ts.isIdentifier(callee.expression) && callee.expression.text === 'Math' && MATH_METHODS.has(name)) return 'number';
  }
  return ts.isIdentifier(callee) ? 'number' : 'none';
}

function isNumberType(node: ts.TypeNode): boolean {
  return node.kind === ts.SyntaxKind.NumberKeyword;
}

function mapExpression(node: ts.Expression, context: ts.TransformationContext, map: (expression: ts.Expression) => ts.Expression): ts.Expression {
  return ts.visitEachChild(node, (child) => ts.isExpression(child) ? map(child) : child, context);
}

function note(ctx: ExprCtx, key: string, message: string): void {
  if (ctx.shared.seen.has(key)) return;
  ctx.shared.seen.add(key);
  ctx.shared.notes.push(message.length <= 220 ? message : `${message.slice(0, 217)}...`);
}

function fresh(key: string, used: Set<string>): string {
  const raw = key.replace(/[^\w$]/g, '') || 'State';
  const base = `n${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;
  let name = base;
  let suffix = 2;
  while (used.has(name)) { name = `${base}${suffix}`; suffix += 1; }
  used.add(name);
  return name;
}

function coalesce(key: string, fallback: number): ts.Expression {
  const right = fallback < 0
    ? ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, ts.factory.createNumericLiteral(1))
    : ts.factory.createNumericLiteral(fallback);
  return ts.factory.createParenthesizedExpression(ts.factory.createBinaryExpression(stateAccess(key), ts.SyntaxKind.QuestionQuestionToken, right));
}

function stateAccess(key: string): ts.PropertyAccessExpression {
  return ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('api'), 'state'), key);
}

function containsStateRead(node: ts.Node): boolean {
  if (stateAccessKey(node)) return true;
  let found = false;
  ts.forEachChild(node, (child) => { if (!found && containsStateRead(child)) found = true; });
  return found;
}

function stateAccessKey(node: ts.Node): string | undefined {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.name)) return undefined;
  const state = node.expression;
  if (!ts.isPropertyAccessExpression(state) || !ts.isIdentifier(state.name) || state.name.text !== 'state') return undefined;
  if (!ts.isIdentifier(state.expression) || state.expression.text !== 'api') return undefined;
  return node.name.text;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function skipUp(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent) && current.parent.expression === current) current = current.parent;
  return current;
}

function isAssignmentTarget(node: ts.Node): boolean {
  const current = skipUp(node);
  return ts.isBinaryExpression(current.parent) && current.parent.left === current && ASSIGNMENT.has(current.parent.operatorToken.kind);
}

function isUpdateTarget(node: ts.Node): boolean {
  const current = skipUp(node);
  const parent = current.parent;
  return (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken) && parent.operand === current;
}

function isCoalesceLeft(node: ts.Node): boolean {
  const current = skipUp(node);
  return ts.isBinaryExpression(current.parent) && current.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && current.parent.left === current;
}

function isNonNullOperand(node: ts.Node): boolean {
  const current = skipUp(node);
  return ts.isNonNullExpression(current.parent) && current.parent.expression === current;
}

function isPropertyBase(node: ts.Node): boolean {
  const current = skipUp(node);
  return ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current;
}

function isSkippedRead(node: ts.Node): boolean {
  return isAssignmentTarget(node) || isUpdateTarget(node) || isCoalesceLeft(node) || isNonNullOperand(node) || isPropertyBase(node);
}

function isRelational(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.LessThanToken || kind === ts.SyntaxKind.GreaterThanToken || kind === ts.SyntaxKind.LessThanEqualsToken || kind === ts.SyntaxKind.GreaterThanEqualsToken;
}

function isArithmetic(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.PlusToken || kind === ts.SyntaxKind.MinusToken || kind === ts.SyntaxKind.AsteriskToken || kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.PercentToken;
}

function isStringLike(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);
}

function isApiNumber(node: ts.PropertyAccessExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === 'api' && (node.name.text === 'width' || node.name.text === 'height' || node.name.text === 'time');
}

function isInputNumber(node: ts.PropertyAccessExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'api' && node.expression.name.text === 'input' && (node.name.text === 'pointerX' || node.name.text === 'pointerY');
}

function transformNestedFunction(node: ts.ArrowFunction | ts.FunctionExpression, ctx: ExprCtx): ts.Expression {
  const factory = ctx.shared.context.factory;
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
    const body = transformExpr(node.body, { ...ctx, pending: [], hoist: false, discard: false });
    return body === node.body ? node : factory.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, body);
  }
  if (!node.body || !ts.isBlock(node.body)) return node;
  const body = transformBlock(node.body, ctx.ready, ctx.shared);
  if (body === node.body) return node;
  return ts.isArrowFunction(node)
    ? factory.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, body)
    : factory.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
}

function descend(ctx: ExprCtx): ExprCtx {
  return ctx.discard ? { ...ctx, discard: false } : ctx;
}

function textOf(node: ts.Node): string {
  return node.getText().replace(/\s+/g, ' ').replaceAll('`', '\'').slice(0, 60);
}
