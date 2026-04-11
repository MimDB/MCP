/**
 * @module tools/docs
 * MCP tool definitions for MimDB documentation retrieval.
 *
 * Registers one tool against an MCP server:
 * - `search_docs` - full-text search over the MimDB documentation site
 *
 * The tool is always registered (read-only and safe to expose in all modes).
 * The search index is fetched from the documentation site on first call and
 * cached for the lifetime of the process.
 */

import { z } from 'zod'
import MiniSearch from 'minisearch'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { MimDBApiError } from '../client/base.js'
import { formatToolError } from '../errors.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base URL for the MimDB documentation site. */
const DOCS_BASE_URL = 'https://docs.mimdb.dev'

/** URL of the pre-built search index served by the documentation site. */
const SEARCH_INDEX_URL = `${DOCS_BASE_URL}/search-index.json`

/** Maximum number of results to surface per search. */
const MAX_RESULTS = 10

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single entry in the documentation search index JSON file.
 */
interface SearchEntry {
  /** URL path relative to {@link DOCS_BASE_URL} (e.g. `/guides/quickstart`). */
  path: string
  /** Page title. */
  title: string
  /** Short description shown in search results. */
  description: string
  /** Keywords associated with the page for boosted matching. */
  keywords: string[]
  /** Section headings extracted from the page content. */
  headings: string[]
  /** Full page text content used for broad matching. */
  content: string
}

// ---------------------------------------------------------------------------
// Process-lifetime index cache
// ---------------------------------------------------------------------------

/** Cached MiniSearch instance. `null` means not yet initialised. */
let cachedIndex: MiniSearch<SearchEntry> | null = null

/**
 * Returns the process-lifetime MiniSearch instance, building it on first call
 * by fetching and indexing the remote search index.
 *
 * Subsequent calls return the cached instance with no additional network
 * requests.
 *
 * @returns Initialised and populated {@link MiniSearch} instance.
 * @throws {MimDBApiError} When the search index cannot be fetched.
 */
async function getIndex(): Promise<MiniSearch<SearchEntry>> {
  if (cachedIndex !== null) {
    return cachedIndex
  }

  let response: Response
  try {
    response = await fetch(SEARCH_INDEX_URL)
  } catch (err) {
    throw new MimDBApiError(
      `Failed to fetch documentation search index: ${err instanceof Error ? err.message : String(err)}`,
      0,
    )
  }

  if (!response.ok) {
    throw new MimDBApiError(
      `Failed to fetch documentation search index (HTTP ${response.status})`,
      response.status,
    )
  }

  let entries: SearchEntry[]
  try {
    entries = (await response.json()) as SearchEntry[]
  } catch {
    throw new MimDBApiError('Failed to parse documentation search index JSON', 0)
  }

  const index = new MiniSearch<SearchEntry>({
    fields: ['title', 'headings', 'keywords', 'content'],
    storeFields: ['path', 'title', 'description'],
    searchOptions: {
      boost: { title: 3, headings: 2, keywords: 2, content: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  })

  // MiniSearch requires each document to have an `id` field. We derive a
  // stable numeric id from the entry's array position since path uniqueness is
  // guaranteed by the docs build process.
  const docs = entries.map((entry, i) => ({ ...entry, id: i }))
  index.addAll(docs)

  cachedIndex = index
  return index
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps pre-formatted text in a single-element {@link CallToolResult}.
 *
 * @param text - Pre-formatted text to return to the MCP client.
 * @returns A non-error {@link CallToolResult}.
 */
function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/**
 * Casts a local `ToolResult`-shaped object to {@link CallToolResult}.
 *
 * @param result - A `ToolResult` from the errors module.
 * @returns The same value typed as {@link CallToolResult}.
 */
function errResult(result: { content: { type: 'text'; text: string }[]; isError?: boolean }): CallToolResult {
  return result as CallToolResult
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

/**
 * Registers documentation MCP tools on `server`.
 *
 * The `search_docs` tool is always registered because it is read-only and
 * safe to expose in all modes.
 *
 * @param server - MCP server instance to attach tools to.
 */
export function register(server: McpServer): void {
  // -------------------------------------------------------------------------
  // search_docs
  // -------------------------------------------------------------------------

  server.tool(
    'search_docs',
    'Search the MimDB documentation for guides, API references, and tutorials. ' +
      'Performs a client-side full-text search over the documentation index with ' +
      'fuzzy matching and prefix support. Returns the top matching pages with titles, ' +
      'descriptions, and direct links.',
    {
      query: z.string().describe('Search terms or question to look up in the documentation.'),
    },
    async ({ query }): Promise<CallToolResult> => {
      let index: MiniSearch<SearchEntry>
      try {
        index = await getIndex()
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }

      const results = index.search(query, {
        boost: { title: 3, headings: 2, keywords: 2, content: 1 },
        fuzzy: 0.2,
        prefix: true,
      })

      const top = results.slice(0, MAX_RESULTS)

      if (top.length === 0) {
        return ok(
          `No documentation found for "${query}". Try different search terms.`,
        )
      }

      const lines: string[] = []
      top.forEach((result, i) => {
        const url = `${DOCS_BASE_URL}${result.path}`
        lines.push(`${i + 1}. **${result.title}**`)
        if (result.description) {
          lines.push(`   ${result.description}`)
        }
        lines.push(`   ${url}`)
      })

      return ok(lines.join('\n'))
    },
  )
}
