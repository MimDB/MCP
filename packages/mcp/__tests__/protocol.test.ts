/**
 * @module __tests__/protocol
 * End-to-end MCP protocol tests using in-memory transport.
 *
 * These tests verify that {@link registerToolGroups} correctly registers,
 * filters, and enforces read-only constraints on tools without requiring a
 * live MimDB instance or stdio transport.
 *
 * Each test:
 * 1. Creates an {@link McpServer} and a dummy {@link MimDBClient}
 * 2. Registers the desired tool groups with chosen options
 * 3. Wires up a linked {@link InMemoryTransport} pair
 * 4. Connects an MCP {@link Client} to verify visible tools
 * 5. Asserts on tool names and count
 */

import { describe, it, expect, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { MimDBClient, PUBLIC_TOOL_GROUPS, registerToolGroups } from 'shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh MCP server and a dummy MimDB client for use in a single test.
 *
 * The client points to a non-existent URL; no real API calls are made during
 * these protocol-level tests.
 *
 * @returns An object containing the MCP server and MimDB client.
 */
function createTestSetup(): { server: McpServer; client: MimDBClient } {
  const client = new MimDBClient({
    baseUrl: 'http://localhost:9000',
    serviceRoleKey: 'test-key',
    projectRef: '0000000000000000',
  })
  const server = new McpServer({ name: 'mimdb-test', version: '0.1.0' })
  return { server, client }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP protocol', () => {
  // Track open connections for cleanup
  const openConnections: Array<{ server: McpServer; mcpClient: Client }> = []

  afterEach(async () => {
    // Close all connections opened in this test
    const toClose = openConnections.splice(0)
    await Promise.all(
      toClose.map(async ({ server, mcpClient }) => {
        await mcpClient.close()
        await server.close()
      }),
    )
  })

  /**
   * Registers tool groups, wires up in-memory transport, and returns the list
   * of tool names visible to an MCP client.
   *
   * @param server - Configured MCP server to connect.
   * @param client - MimDB client passed to {@link registerToolGroups}.
   * @param enabledFeatures - Optional feature allowlist forwarded to {@link registerToolGroups}.
   * @param readOnly - Whether to register tools in read-only mode.
   * @returns Array of tool name strings visible to the MCP client.
   */
  async function getRegisteredToolNames(
    server: McpServer,
    client: MimDBClient,
    enabledFeatures?: string[],
    readOnly = false,
  ): Promise<string[]> {
    await registerToolGroups(server, client, PUBLIC_TOOL_GROUPS, enabledFeatures, readOnly)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()

    const mcpClient = new Client({ name: 'test-client', version: '0.1.0' })
    openConnections.push({ server, mcpClient })

    await server.connect(serverTransport)
    await mcpClient.connect(clientTransport)

    const { tools } = await mcpClient.listTools()
    return tools.map((t) => t.name)
  }

  // -------------------------------------------------------------------------
  // Test 1: all public tools registered when no feature filter is applied
  // -------------------------------------------------------------------------

  it('lists all public tools when no feature filter', async () => {
    const { server, client } = createTestSetup()
    const names = await getRegisteredToolNames(server, client, undefined, false)

    // Should include tools from every feature group
    expect(names).toContain('list_tables')
    expect(names).toContain('execute_sql')
    expect(names).toContain('execute_sql_dry_run')
    expect(names).toContain('list_buckets')
    expect(names).toContain('create_bucket')
    expect(names).toContain('list_jobs')
    expect(names).toContain('vector_search')
    expect(names).toContain('search_docs')
    expect(names).toContain('get_query_stats')
    expect(names).toContain('get_project_url')
    expect(names).toContain('generate_types')

    // Should NOT include admin tools
    expect(names).not.toContain('list_organizations')
    expect(names).not.toContain('get_logs')
    expect(names).not.toContain('get_api_keys')
    expect(names).not.toContain('list_policies')

    // Total public tools in write mode: 4 database + 10 storage + 5 cron +
    // 5 vectors + 1 debugging + 2 development + 1 docs = 28
    expect(names).toHaveLength(28)
  })

  // -------------------------------------------------------------------------
  // Test 2: feature filter restricts which groups are loaded
  // -------------------------------------------------------------------------

  it('filters tools by feature groups', async () => {
    const { server, client } = createTestSetup()
    const names = await getRegisteredToolNames(server, client, ['database', 'docs'], false)

    // Database tools should be present
    expect(names).toContain('list_tables')
    expect(names).toContain('execute_sql')
    expect(names).toContain('execute_sql_dry_run')
    expect(names).toContain('get_table_schema')

    // Docs tool should be present
    expect(names).toContain('search_docs')

    // Tools from excluded groups should not appear
    expect(names).not.toContain('list_buckets')
    expect(names).not.toContain('list_jobs')
    expect(names).not.toContain('vector_search')

    // 4 database + 1 docs = 5
    expect(names).toHaveLength(5)
  })

  // -------------------------------------------------------------------------
  // Test 3: read-only mode omits write tools across all groups
  // -------------------------------------------------------------------------

  it('excludes write tools in read-only mode', async () => {
    const { server, client } = createTestSetup()
    const names = await getRegisteredToolNames(server, client, undefined, true)

    // Read tools should still be registered
    expect(names).toContain('list_tables')
    expect(names).toContain('execute_sql')
    expect(names).toContain('execute_sql_dry_run')
    expect(names).toContain('list_buckets')
    expect(names).toContain('list_objects')
    expect(names).toContain('list_jobs')
    expect(names).toContain('get_job')
    expect(names).toContain('list_vector_tables')
    expect(names).toContain('vector_search')

    // Write tools should be absent
    expect(names).not.toContain('create_bucket')
    expect(names).not.toContain('delete_bucket')
    expect(names).not.toContain('upload_object')
    expect(names).not.toContain('delete_object')
    expect(names).not.toContain('update_bucket')
    expect(names).not.toContain('create_job')
    expect(names).not.toContain('delete_job')
    expect(names).not.toContain('create_vector_table')
    expect(names).not.toContain('delete_vector_table')
    expect(names).not.toContain('create_vector_index')

    // Read-only totals:
    // database=4, storage read=5, cron read=3, vectors read=2,
    // debugging=1, development=2, docs=1 = 18
    expect(names).toHaveLength(18)
  })
})
