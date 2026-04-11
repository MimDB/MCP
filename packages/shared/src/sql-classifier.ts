/**
 * SQL statement classifier for read-only mode enforcement.
 *
 * This module provides a UX guardrail that gives the AI immediate feedback
 * when a write statement is submitted in read-only mode. The real security
 * boundary is `SET TRANSACTION READ ONLY` at the database level.
 */

/**
 * Classification of a SQL statement as either read-only or write.
 */
export enum SqlClassification {
  /** Statement only reads data and does not modify the database. */
  Read = 'read',
  /** Statement modifies data, schema, or session state. */
  Write = 'write',
}

/**
 * SQL keyword prefixes that are safe to run in read-only mode.
 * All other recognised prefixes are treated as Write.
 */
const READ_PREFIXES = new Set(['SELECT', 'SHOW', 'EXPLAIN'])

/**
 * SQL keyword prefixes that always write, modify state, or execute side-effects.
 * Listed explicitly so new unknowns default to Write rather than being missed.
 */
const WRITE_PREFIXES = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'CREATE',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'VACUUM',
  'REINDEX',
  'COMMENT',
  'LOCK',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SET',
  'DO',
  'CALL',
  'EXECUTE',
  'PREPARE',
  'DEALLOCATE',
  'DISCARD',
  'NOTIFY',
  'LISTEN',
  'UNLISTEN',
  'REASSIGN',
  'SECURITY',
  'REFRESH',
  'WITH', // handled separately for CTEs; listed here as fallback
])

/**
 * Strip SQL block comments (`/* ... *\/`) and line comments (`-- ...`) from
 * the input while preserving the content of single-quoted string literals.
 *
 * Comments are replaced with a single space to prevent adjacent tokens from
 * being merged (e.g. SELECT followed immediately by a block comment then 1
 * becomes `SELECT 1` rather than `SELECT1`).
 *
 * Escaped single-quotes inside strings (`''`) are handled correctly.
 *
 * @param sql - Raw SQL input.
 * @returns SQL with all comments replaced by spaces.
 */
function stripComments(sql: string): string {
  let result = ''
  let i = 0
  const len = sql.length

  while (i < len) {
    const ch = sql[i]!

    // Single-quoted string literal — copy verbatim until closing quote.
    if (ch === "'") {
      result += ch
      i++
      while (i < len) {
        const sc = sql[i]!
        result += sc
        i++
        if (sc === "'") {
          // '' is an escaped quote; peek ahead.
          if (i < len && sql[i] === "'") {
            result += sql[i]!
            i++
          } else {
            break // End of string literal.
          }
        }
      }
      continue
    }

    // Block comment: /* ... */
    if (ch === '/' && i + 1 < len && sql[i + 1] === '*') {
      i += 2
      while (i < len) {
        if (sql[i] === '*' && i + 1 < len && sql[i + 1] === '/') {
          i += 2
          break
        }
        i++
      }
      result += ' ' // Replace comment with a space.
      continue
    }

    // Line comment: -- ... \n
    if (ch === '-' && i + 1 < len && sql[i + 1] === '-') {
      i += 2
      while (i < len && sql[i] !== '\n') {
        i++
      }
      result += ' ' // Replace comment with a space.
      continue
    }

    result += ch
    i++
  }

  return result
}

/**
 * Detect whether `sql` (already comment-stripped) contains multiple statements
 * by looking for semicolons that appear outside single-quoted string literals.
 *
 * @param sql - Comment-stripped SQL string.
 * @returns `true` if more than one statement is present.
 */
function hasMultipleStatements(sql: string): boolean {
  let inString = false
  let i = 0
  const len = sql.length

  while (i < len) {
    const ch = sql[i]!

    if (ch === "'") {
      if (inString) {
        // Check for escaped quote ('').
        if (i + 1 < len && sql[i + 1] === "'") {
          i += 2
          continue
        }
        inString = false
      } else {
        inString = true
      }
      i++
      continue
    }

    if (!inString && ch === ';') {
      // A semicolon outside a string: check if there is non-whitespace after it.
      const rest = sql.slice(i + 1).trim()
      if (rest.length > 0) {
        return true
      }
    }

    i++
  }

  return false
}

/**
 * Extract the first SQL keyword token from a comment-stripped, trimmed string.
 *
 * @param sql - Trimmed, comment-stripped SQL.
 * @returns Uppercase first keyword, or an empty string if none found.
 */
function firstKeyword(sql: string): string {
  const match = /^([A-Za-z_][A-Za-z_]*)/.exec(sql)
  return match ? match[1]!.toUpperCase() : ''
}

/**
 * For a `WITH ... SELECT` CTE, find the final statement that follows the
 * outermost closing parenthesis (depth 0) of the CTE definitions.
 *
 * Returns the trimmed text after the last top-level `)`, or `null` if the
 * structure cannot be parsed.
 *
 * @param sql - Comment-stripped SQL starting with `WITH`.
 * @returns The trailing statement text, or `null`.
 */
function extractCteTrailingStatement(sql: string): string | null {
  // Skip the WITH keyword and find the start of the CTE body.
  let i = 4 // past "WITH"
  const len = sql.length
  let depth = 0
  let lastCloseAtDepthZero = -1

  while (i < len) {
    const ch = sql[i]!

    if (ch === "'") {
      // Skip string literals inside the CTE.
      i++
      while (i < len) {
        const sc = sql[i]!
        i++
        if (sc === "'") {
          if (i < len && sql[i] === "'") {
            i++
          } else {
            break
          }
        }
      }
      continue
    }

    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) {
        lastCloseAtDepthZero = i
      }
    }

    i++
  }

  if (lastCloseAtDepthZero === -1) {
    return null
  }

  return sql.slice(lastCloseAtDepthZero + 1).trim()
}

/**
 * Classify a SQL statement as either read-only or a write/mutating operation.
 *
 * The classifier strips comments (preserving string literals), checks for
 * multiple statements, and inspects the leading keyword. Special cases handle
 * CTEs (`WITH ... SELECT`), `EXPLAIN ANALYZE`, and `SELECT ... INTO`.
 *
 * This is a UX guardrail only. The authoritative read-only enforcement happens
 * at the database level via `SET TRANSACTION READ ONLY`.
 *
 * @param sql - The SQL statement to classify.
 * @returns `SqlClassification.Read` for safe read-only statements, or
 *          `SqlClassification.Write` for anything that may mutate state.
 *
 * @example
 * ```ts
 * classifySql('SELECT * FROM users')
 * // => SqlClassification.Read
 *
 * classifySql('DROP TABLE users')
 * // => SqlClassification.Write
 * ```
 */
export function classifySql(sql: string): SqlClassification {
  const stripped = stripComments(sql).trim()

  // Empty input defaults to Write (safe).
  if (stripped.length === 0) {
    return SqlClassification.Write
  }

  // Multiple statements are always Write.
  if (hasMultipleStatements(stripped)) {
    return SqlClassification.Write
  }

  const keyword = firstKeyword(stripped)

  // CTE: WITH ... must be inspected to find the final statement.
  if (keyword === 'WITH') {
    const trailing = extractCteTrailingStatement(stripped)
    if (trailing === null) {
      return SqlClassification.Write
    }
    const trailingKeyword = firstKeyword(trailing)
    return READ_PREFIXES.has(trailingKeyword)
      ? SqlClassification.Read
      : SqlClassification.Write
  }

  // EXPLAIN: read by default, but EXPLAIN ANALYZE/ANALYSE executes the query.
  if (keyword === 'EXPLAIN') {
    const rest = stripped.slice(7).trim().toUpperCase()
    if (rest.startsWith('ANALYZE') || rest.startsWith('ANALYSE')) {
      return SqlClassification.Write
    }
    return SqlClassification.Read
  }

  // SELECT: read by default, but SELECT ... INTO creates a table.
  if (keyword === 'SELECT') {
    if (selectHasIntoBeforeFrom(stripped)) {
      return SqlClassification.Write
    }
    return SqlClassification.Read
  }

  // SHOW is always Read.
  if (keyword === 'SHOW') {
    return SqlClassification.Read
  }

  // Any other known Write prefix -> Write.
  if (WRITE_PREFIXES.has(keyword)) {
    return SqlClassification.Write
  }

  // Unknown prefix -> Write (safe default).
  return SqlClassification.Write
}

/**
 * Determine whether a `SELECT` statement uses the `INTO` clause to create a
 * table (e.g. `SELECT * INTO new_table FROM ...`).
 *
 * We look for `INTO` appearing before the first `FROM` keyword, outside of
 * any parentheses or string literals, which distinguishes `SELECT INTO` from
 * subqueries that contain `INTO`.
 *
 * @param sql - Comment-stripped SQL starting with `SELECT`.
 * @returns `true` if `INTO` appears before `FROM` at the top level.
 */
function selectHasIntoBeforeFrom(sql: string): boolean {
  let i = 0
  const len = sql.length
  let depth = 0
  let foundInto = false

  while (i < len) {
    const ch = sql[i]!

    // Skip string literals.
    if (ch === "'") {
      i++
      while (i < len) {
        const sc = sql[i]!
        i++
        if (sc === "'") {
          if (i < len && sql[i] === "'") {
            i++
          } else {
            break
          }
        }
      }
      continue
    }

    if (ch === '(') {
      depth++
      i++
      continue
    }

    if (ch === ')') {
      depth--
      i++
      continue
    }

    // Only inspect top-level keywords.
    if (depth === 0 && /[A-Za-z]/.test(ch)) {
      const wordMatch = /^([A-Za-z_]+)/.exec(sql.slice(i))
      if (wordMatch) {
        const word = wordMatch[1]!.toUpperCase()
        if (word === 'INTO') {
          foundInto = true
        } else if (word === 'FROM') {
          // FROM found: return true only if INTO was seen first.
          return foundInto
        }
        i += wordMatch[1]!.length
        continue
      }
    }

    i++
  }

  return false
}
