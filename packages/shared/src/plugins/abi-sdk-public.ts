// The SDK names types and functions from shared modules. Their declarations
// belong to its public surface too; emitting only the re-export statement
// would miss a signature change behind an unchanged module specifier.
import ts from "typescript";

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const publicFlags = ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias;

/** Resolve only shared declarations reachable from the SDK's public exports. */
export function sdkSharedPublicDeclarations(
  program: ts.Program,
  entryFiles: readonly string[],
  sharedRoot: string,
  relative: (path: string) => string,
): Array<[string, string]> {
  const checker = program.getTypeChecker();
  const pending: ts.Symbol[] = [];
  const seen = new Set<ts.Symbol>();
  const outputs = new Map<string, Map<string, string>>();
  const emittedFiles = new Map<string, ts.SourceFile>();
  const emit = (source: ts.SourceFile) => {
    const cached = emittedFiles.get(source.fileName);
    if (cached) return cached;
    let text = "";
    const result = program.emit(source, (path, output) => { if (path.endsWith(".d.ts")) text = output; });
    if (result.emitSkipped || !text) throw new Error(`Cannot emit SDK source ${source.fileName}`);
    const declarations = ts.createSourceFile(source.fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    emittedFiles.set(source.fileName, declarations);
    return declarations;
  };
  const isPublicDeclaration = (node: ts.Declaration) => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)
    || (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)
      && ts.isSourceFile(node.parent.parent.parent));
  const unalias = (symbol: ts.Symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const queue = (symbol: ts.Symbol | undefined) => {
    if (!symbol) return;
    const target = unalias(symbol);
    if (target.declarations?.some((declaration) => isPublicDeclaration(declaration) && declaration.getSourceFile().fileName.startsWith(sharedRoot))) pending.push(target);
  };
  const resolveEntity = (name: ts.EntityName | ts.Expression, scope: ts.Node): ts.Symbol | undefined => {
    if (ts.isIdentifier(name)) return checker.resolveName(name.text, scope, ts.SymbolFlags.Type | ts.SymbolFlags.Value | ts.SymbolFlags.Namespace, false);
    if (ts.isQualifiedName(name) || ts.isPropertyAccessExpression(name)) {
      const left = resolveEntity(ts.isQualifiedName(name) ? name.left : name.expression, scope);
      const right = ts.isQualifiedName(name) ? name.right.text : name.name.text;
      return left && checker.getExportsOfModule(unalias(left)).find((entry) => entry.name === right);
    }
    return undefined;
  };
  const moduleSymbols = new Map<string, ts.Symbol>();
  const packageSymbols = new Map<string, ts.Symbol | null>();
  for (const source of program.getSourceFiles()) {
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Module) {
          moduleSymbols.set(`${source.fileName}:${node.text}`, symbol);
          if (!node.text.startsWith(".")) {
            const existing = packageSymbols.get(node.text);
            packageSymbols.set(node.text, existing === undefined || existing === symbol ? symbol : null);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const dependencies = (node: ts.Node, scope: ts.Node) => {
    const visit = (child: ts.Node) => {
      // A named type, typeof query or heritage clause can hide a shared
      // declaration several hops behind a public alias. Never walk bodies.
      if (ts.isTypeReferenceNode(child) || ts.isTypeQueryNode(child) || ts.isExpressionWithTypeArguments(child)) {
        const name = ts.isTypeReferenceNode(child) ? child.typeName : ts.isTypeQueryNode(child) ? child.exprName : child.expression;
        queue(resolveEntity(name, scope));
      } else if (ts.isImportTypeNode(child) && ts.isLiteralTypeNode(child.argument) && ts.isStringLiteral(child.argument.literal)) {
        const specifier = child.argument.literal.text;
        let target = moduleSymbols.get(`${scope.getSourceFile().fileName}:${specifier}`)
          ?? packageSymbols.get(specifier) ?? undefined;
        // Synthesized import types have no source positions; read their
        // entity names structurally instead of depending on getText().
        const names = (name: ts.EntityName): string[] => ts.isIdentifier(name) ? [name.text] : [...names(name.left), name.right.text];
        for (const name of child.qualifier ? names(child.qualifier) : []) {
          target = target && checker.getExportsOfModule(unalias(target)).find((entry) => entry.name === name);
        }
        queue(target);
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
  };
  for (const file of entryFiles) {
    const source = program.getSourceFile(file);
    const module = source && checker.getSymbolAtLocation(source);
    if (!source || !module) throw new Error(`Cannot resolve SDK entry point ${file}`);
    for (const symbol of checker.getExportsOfModule(module)) queue(symbol);
    // Shared types can also occur only in an SDK-owned public signature.
    // Declaration emit contains that reachable surface without method bodies.
    for (const node of emit(source).statements) dependencies(node, source);
  }
  while (pending.length) {
    const symbol = pending.shift()!;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const declaration = symbol.declarations?.find((node) => isPublicDeclaration(node) && node.getSourceFile().fileName.startsWith(sharedRoot));
    if (!declaration) continue;
    const source = declaration.getSourceFile();
    let printSource = source;
    let nodes: ts.Node[];
    if (ts.isInterfaceDeclaration(declaration)) {
      // Interfaces preserve generic parameters, inheritance and recursive
      // names; their reachable declarations are queued below.
      nodes = [declaration];
    } else if (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration) || ts.isModuleDeclaration(declaration)) {
      printSource = emit(source);
      nodes = printSource.statements.filter((node) => "name" in node && node.name && ts.isIdentifier(node.name as ts.Node) && (node.name as ts.Identifier).text === symbol.name);
      if (!nodes.length) throw new Error(`Missing emitted SDK declaration ${symbol.name}`);
    } else if (ts.isTypeAliasDeclaration(declaration) && declaration.typeParameters?.length) {
      // Preserve generic expressions; instantiating them would erase the
      // relationship between their parameters and result.
      nodes = [declaration];
    } else if (symbol.flags & ts.SymbolFlags.Type) {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      const shape = checker.typeToTypeNode(type, declaration, publicFlags);
      if (!shape) throw new Error(`Cannot resolve public SDK type ${symbol.name}`);
      nodes = [ts.factory.createTypeAliasDeclaration(
        [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)], symbol.name,
        ts.isTypeAliasDeclaration(declaration) ? declaration.typeParameters : undefined, shape,
      )];
    } else {
      printSource = emit(source);
      nodes = printSource.statements.filter(ts.isVariableStatement).flatMap((statement) => {
        const declarations = statement.declarationList.declarations.filter((node) => ts.isIdentifier(node.name) && node.name.text === symbol.name);
        return declarations.length ? [ts.factory.updateVariableStatement(statement, statement.modifiers,
          ts.factory.updateVariableDeclarationList(statement.declarationList, declarations))] : [];
      });
      if (!nodes.length) throw new Error(`Missing emitted SDK value ${symbol.name}`);
    }
    const file = relative(source.fileName).replace(/\.tsx?$/, ".d.ts");
    const entries = outputs.get(file) ?? new Map<string, string>();
    for (const node of nodes) {
      dependencies(node, declaration);
      const printed = printer.printNode(ts.EmitHint.Unspecified, node, printSource).trim();
      entries.set(symbol.name, `${entries.has(symbol.name) ? `${entries.get(symbol.name)}\n` : ""}${printed}`);
    }
    outputs.set(file, entries);
  }
  return [...outputs].sort(([a], [b]) => a.localeCompare(b)).map(([file, entries]) => [
    file, [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join("\n") + "\n",
  ]);
}
