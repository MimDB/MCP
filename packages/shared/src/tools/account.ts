/**
 * @module tools/account
 * MCP tool definitions for MimDB organization and project management.
 *
 * Registers up to seven tools against an MCP server:
 * - `list_organizations` - enumerate all platform organizations
 * - `get_organization` - fetch a single organization by UUID
 * - `list_projects` - enumerate all projects across all organizations
 * - `list_org_projects` - enumerate projects within a specific organization
 * - `get_project` - fetch a single project by UUID
 * - `create_organization` - create a new organization (write-only)
 * - `create_project` - create a new project and return its API keys (write-only)
 *
 * All tools require admin credentials via the platform client.
 * Write tools (`create_organization`, `create_project`) are only registered
 * when `readOnly` is false.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { MimDBClient } from '../client/index.js'
import { MimDBApiError } from '../client/base.js'
import { formatMarkdownTable } from '../formatters.js'
import { formatToolError } from '../errors.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps formatted text in a single-element {@link CallToolResult}.
 *
 * @param text - Pre-formatted text to return to the MCP client.
 * @returns A non-error {@link CallToolResult}.
 */
function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/**
 * Wraps a ToolResult-shaped object as a {@link CallToolResult}.
 *
 * @param result - A ToolResult from the errors module.
 * @returns The same value typed as {@link CallToolResult}.
 */
function errResult(result: { content: { type: 'text'; text: string }[]; isError?: boolean }): CallToolResult {
  return result as CallToolResult
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

/**
 * Registers organization and project MCP tools on `server`.
 *
 * Read tools are always registered. Write tools (`create_organization`,
 * `create_project`) are only registered when `readOnly` is false.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls.
 * @param readOnly - When `true`, write tools are not registered.
 */
export function register(server: McpServer, client: MimDBClient, readOnly = false): void {
  // -------------------------------------------------------------------------
  // list_organizations
  // -------------------------------------------------------------------------

  server.tool(
    'list_organizations',
    'List all organizations on the MimDB platform.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const orgs = await client.platform.listOrganizations()
        const table = formatMarkdownTable(orgs, ['id', 'name', 'slug', 'created_at'])
        return ok(`Found ${orgs.length} organization(s):\n\n${table}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // get_organization
  // -------------------------------------------------------------------------

  server.tool(
    'get_organization',
    'Get details for a single organization by its UUID.',
    {
      org_id: z.string().uuid().describe('UUID of the organization to retrieve.'),
    },
    async ({ org_id }): Promise<CallToolResult> => {
      try {
        const org = await client.platform.getOrganization(org_id)
        const table = formatMarkdownTable([org], ['id', 'name', 'slug', 'created_at'])
        return ok(table)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // list_projects
  // -------------------------------------------------------------------------

  server.tool(
    'list_projects',
    'List all projects across all organizations on the MimDB platform.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const projects = await client.platform.listProjects()
        const table = formatMarkdownTable(projects, ['id', 'name', 'ref', 'status', 'created_at'])
        return ok(`Found ${projects.length} project(s):\n\n${table}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // list_org_projects
  // -------------------------------------------------------------------------

  server.tool(
    'list_org_projects',
    'List all projects belonging to a specific organization.',
    {
      org_id: z.string().uuid().describe('UUID of the organization whose projects to list.'),
    },
    async ({ org_id }): Promise<CallToolResult> => {
      try {
        const projects = await client.platform.listOrgProjects(org_id)
        const table = formatMarkdownTable(projects, ['id', 'name', 'ref', 'status', 'created_at'])
        return ok(`Found ${projects.length} project(s) in organization ${org_id}:\n\n${table}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // get_project
  // -------------------------------------------------------------------------

  server.tool(
    'get_project',
    'Get details for a single project by its UUID.',
    {
      project_id: z.string().uuid().describe('UUID of the project to retrieve.'),
    },
    async ({ project_id }): Promise<CallToolResult> => {
      try {
        const project = await client.platform.getProject(project_id)
        const table = formatMarkdownTable([project], ['id', 'name', 'ref', 'status', 'created_at'])
        return ok(table)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // select_project - always registered, switches the active project context
  // -------------------------------------------------------------------------

  server.tool(
    'select_project',
    'Switch the active project context. Fetches the project\'s service role key and configures all project-scoped tools (database, storage, cron, vectors, etc.) to target this project. You must call this before using any project-scoped tools.',
    {
      project_ref: z
        .string()
        .regex(/^[0-9a-f]{16}$/)
        .describe('The 16-character hex project reference. Use list_projects to find available refs.'),
    },
    async ({ project_ref }): Promise<CallToolResult> => {
      try {
        // Resolve ref to UUID
        const projectId = await client.platform.resolveRefToId(project_ref)

        // Fetch the project's API keys (returns fresh JWTs)
        const keys = await client.platform.getApiKeys(projectId)

        if (!keys.service_role_key) {
          return errResult(formatToolError(500, {
            code: 'MCP-0001',
            message: 'Could not retrieve service role key for this project.',
          }))
        }

        // Switch the client to this project
        client.setProject(project_ref, keys.service_role_key)

        // Get project details for confirmation
        const project = await client.platform.getProject(projectId)

        return ok([
          `**Project selected: ${project.name}**`,
          '',
          `| Field | Value |`,
          `| --- | --- |`,
          `| Ref | \`${project.ref}\` |`,
          `| ID | \`${project.id}\` |`,
          `| Status | ${project.status} |`,
          '',
          'All project-scoped tools (database, storage, cron, vectors, debugging, development) are now targeting this project.',
          '',
          '> **Note:** You are connected with **service_role** access, which bypasses all Row Level Security (RLS) policies. Exercise caution with write operations.',
        ].join('\n'))
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        if (err instanceof Error && err.message.includes('not found')) {
          return errResult(formatToolError(404, {
            code: 'MCP-0002',
            message: err.message,
            detail: 'Use list_projects to see available project refs.',
          }))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // current_project - always registered, shows active project context
  // -------------------------------------------------------------------------

  server.tool(
    'current_project',
    'Show which project is currently selected, or indicate that no project is selected.',
    {},
    async (): Promise<CallToolResult> => {
      if (!client.hasProject) {
        return ok('No project is currently selected. Use select_project to choose a project.')
      }
      try {
        const projectId = await client.platform.resolveRefToId(client.projectRef!)
        const project = await client.platform.getProject(projectId)
        return ok([
          `**Active project: ${project.name}**`,
          '',
          `| Field | Value |`,
          `| --- | --- |`,
          `| Ref | \`${project.ref}\` |`,
          `| ID | \`${project.id}\` |`,
          `| Status | ${project.status} |`,
          '',
          'Connected with **service_role** access (bypasses RLS).',
        ].join('\n'))
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // Write tools (readOnly=false only)
  // -------------------------------------------------------------------------

  if (readOnly) return

  // -------------------------------------------------------------------------
  // create_organization
  // -------------------------------------------------------------------------

  server.tool(
    'create_organization',
    'Create a new organization on the MimDB platform.',
    {
      name: z.string().describe('Display name for the new organization.'),
      slug: z
        .string()
        .describe('URL-safe slug for the organization (must be unique across all organizations).'),
    },
    async ({ name, slug }): Promise<CallToolResult> => {
      try {
        const org = await client.platform.createOrganization(name, slug)
        const table = formatMarkdownTable([org], ['id', 'name', 'slug', 'created_at'])
        return ok(`Organization created successfully:\n\n${table}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // create_project
  // -------------------------------------------------------------------------

  server.tool(
    'create_project',
    'Create a new project within an organization and return its API keys.',
    {
      org_id: z.string().uuid().describe('UUID of the organization that will own the project.'),
      name: z.string().describe('Display name for the new project.'),
    },
    async ({ org_id, name }): Promise<CallToolResult> => {
      try {
        const project = await client.platform.createProject(org_id, name)
        const metaTable = formatMarkdownTable(
          [project],
          ['id', 'name', 'ref', 'status', 'created_at'],
        )
        const text = [
          'Project created successfully:',
          '',
          metaTable,
          '',
          '## API Keys',
          '',
          `**Anon key:** \`${project.anon_key}\``,
          '',
          `**Service role key:** \`${project.service_role_key}\``,
          '',
          '> **WARNING:** The service role key is shown only once and is not stored by',
          '> the platform. Save it now in a secure location. Anyone with this key has',
          '> full, unrestricted access to the project database, bypassing all RLS policies.',
        ].join('\n')
        return ok(text)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
