/**
 * Reading closed sets out of shipped type declarations.
 *
 * A variant union is the single most valuable fact a library publishes: it is
 * what stops an agent inventing a value. It is also what libraries express in the
 * most different ways, and every indirection missed becomes a value an agent is
 * free to make up.
 *
 * Four notations are handled, all of them found in real packages:
 *
 *   'a' | 'b'                        inline
 *   type Variant = 'a' | 'b'         a local alias, referenced by name
 *   OverridableStringUnion<'a'|'b',…> MUI's extensible union
 *   (typeof _Types)[number]          Ant's tuple-derived union, where the values
 *                                    live in `declare const _Types: readonly [...]`
 *
 * Plus imports: an alias declared in a sibling file and imported by name. Ant
 * puts ButtonType one file away from the props that use it, so a resolver that
 * stops at file boundaries reads no unions for its most-used component.
 */

/**
 * Builds a resolver over a set of parsed declaration files.
 *
 * @param {object} ts the TypeScript module the target project ships
 * @param {Map<string, object>} sources absolute path → SourceFile
 * @param {(from: string, specifier: string) => string|undefined} resolveImport
 */
export function createResolver(ts, sources, resolveImport) {
  /** Per-file symbol tables, built once. */
  const tables = new Map()

  const tableFor = (file) => {
    if (tables.has(file)) return tables.get(file)
    const source = sources.get(file)
    const table = { aliases: new Map(), consts: new Map(), imports: new Map() }
    if (source) {
      source.forEachChild(node => {
        if (ts.isTypeAliasDeclaration(node)) table.aliases.set(node.name.text, node.type)
        if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (decl.name.escapedText && decl.type) table.consts.set(String(decl.name.escapedText), decl.type)
          }
        }
        if (ts.isImportDeclaration(node) && node.importClause?.namedBindings?.elements) {
          const specifier = node.moduleSpecifier.text
          for (const element of node.importClause.namedBindings.elements) {
            table.imports.set(element.name.text, { specifier, original: (element.propertyName ?? element.name).text })
          }
        }
      })
    }
    tables.set(file, table)
    return table
  }

  /** Literal members of a readonly tuple: `readonly ["a", "b"]`. */
  const tupleLiterals = (typeNode) => {
    let node = typeNode
    if (ts.isTypeOperatorNode?.(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) node = node.type
    if (!ts.isTupleTypeNode(node)) return undefined
    const values = node.elements
      .filter(e => ts.isLiteralTypeNode(e) && ts.isStringLiteral(e.literal))
      .map(e => e.literal.text)
    return values.length === node.elements.length && values.length ? values : undefined
  }

  /**
   * @returns {string[]|undefined} the closed set, or undefined when the type is
   * not one — which is different from an empty set and must stay different.
   */
  function literalValues(typeNode, file, seen = new Set()) {
    if (!typeNode) return undefined

    if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) return [typeNode.literal.text]

    if (ts.isUnionTypeNode(typeNode)) {
      const values = []
      for (const member of typeNode.types) {
        // `| undefined` and `| null` widen a type; they are not choices an author
        // picks, so they do not belong in the value list.
        if (member.kind === ts.SyntaxKind.UndefinedKeyword || member.kind === ts.SyntaxKind.NullKeyword) continue
        const inner = literalValues(member, file, seen)
        if (!inner) return undefined
        values.push(...inner)
      }
      return values.length ? [...new Set(values)] : undefined
    }

    if (ts.isParenthesizedTypeNode(typeNode)) return literalValues(typeNode.type, file, seen)

    // `(typeof _ButtonTypes)[number]` — the values live in the const's type.
    if (ts.isIndexedAccessTypeNode(typeNode)) {
      const target = typeNode.objectType
      const inner = ts.isParenthesizedTypeNode(target) ? target.type : target
      if (ts.isTypeQueryNode?.(inner)) {
        const name = inner.exprName.getText()
        const key = `${file}#const:${name}`
        if (seen.has(key)) return undefined
        const table = tableFor(file)
        const declared = table.consts.get(name)
        if (declared) return tupleLiterals(declared) ?? literalValues(declared, file, new Set([...seen, key]))
      }
      return undefined
    }

    if (ts.isTypeReferenceNode(typeNode)) {
      const name = typeNode.typeName.getText()

      // MUI declares an extensible union as OverridableStringUnion<Literals, Overrides>.
      if (name === 'OverridableStringUnion' && typeNode.typeArguments?.length) {
        return literalValues(typeNode.typeArguments[0], file, seen)
      }

      const key = `${file}#${name}`
      if (seen.has(key)) return undefined
      const next = new Set([...seen, key])
      const table = tableFor(file)

      const local = table.aliases.get(name)
      if (local) return literalValues(local, file, next)

      const constant = table.consts.get(name)
      if (constant) return tupleLiterals(constant)

      // Declared in a sibling file and imported by name.
      const imported = table.imports.get(name)
      if (imported && resolveImport) {
        const other = resolveImport(file, imported.specifier)
        if (other && sources.has(other)) {
          const otherTable = tableFor(other)
          const alias = otherTable.aliases.get(imported.original)
          if (alias) return literalValues(alias, other, next)
          const otherConst = otherTable.consts.get(imported.original)
          if (otherConst) return tupleLiterals(otherConst)
        }
      }
    }

    return undefined
  }

  return { literalValues }
}

/** First sentence of a JSDoc comment: the line an agent reads to choose. */
export function firstSentence(ts, node, source) {
  const ranges = ts.getLeadingCommentRanges(source.text, node.pos) ?? []
  for (const range of ranges) {
    const text = source.text.slice(range.pos, range.end)
    if (!text.startsWith('/**')) continue
    const body = text
      .replace(/^\/\*\*/, '').replace(/\*\/$/, '')
      .split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim())
      .filter(l => l && !l.startsWith('@') && !/^(Demos|API):/i.test(l))
      .join(' ')
      .trim()
    if (!body) continue
    const stop = body.search(/\.\s|\.$/)
    return (stop === -1 ? body : body.slice(0, stop + 1)).trim()
  }
  return undefined
}
