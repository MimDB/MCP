/**
 * @module tools/cron
 * MCP tool definitions for MimDB pg_cron job management.
 *
 * Registers up to five tools against an MCP server:
 * - `list_jobs`        - enumerate all cron jobs in the project (always registered)
 * - `get_job`          - fetch full details for a single job (always registered)
 * - `get_job_history`  - fetch the run history for a job (always registered)
 * - `create_job`       - schedule a new pg_cron job (write-mode only)
 * - `delete_job`       - remove a pg_cron job (write-mode only)
 *
 * All tools follow the same pattern: validate input, call the domain client,
 * format the result for the AI, and surface {@link MimDBApiError} as a
 * structured result rather than letting it propagate.
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
 * Wraps the result of {@link formatToolError} as a {@link CallToolResult}
 * for the MCP protocol.
 *
 * Our local `ToolResult` type is structurally identical to `CallToolResult`
 * but lacks the SDK's index signature. This cast is safe.
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
 * Registers cron MCP tools on `server`.
 *
 * Read tools (`list_jobs`, `get_job`, `get_job_history`) are always registered.
 * Write tools (`create_job`, `delete_job`) are only registered when
 * `readOnly` is `false`.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls.
 * @param readOnly - When `true`, write tools are not registered.
 */
export function register(server: McpServer, client: MimDBClient, readOnly = false): void {
  // -------------------------------------------------------------------------
  // list_jobs
  // -------------------------------------------------------------------------

  server.tool(
    'list_jobs',
    'List all pg_cron jobs defined in the project, including their schedule, command, and active status.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const result = await client.cron.listJobs()
        const tableText = formatMarkdownTable(result.jobs, ['id', 'name', 'schedule', 'command', 'active'])
        return ok(
          `Found ${result.total} of ${result.max_allowed} allowed jobs:\n\n${tableText}`,
        )
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // get_job
  // -------------------------------------------------------------------------

  server.tool(
    'get_job',
    'Get the full definition of a single pg_cron job by ID: name, schedule, command, active status, and timestamps.',
    {
      job_id: z.number().int().positive().describe('Numeric pg_cron job ID.'),
    },
    async ({ job_id }): Promise<CallToolResult> => {
      try {
        const job = await client.cron.getJob(job_id)
        const text = [
          `## Job ${job.id}: ${job.name}`,
          '',
          `**Schedule:** ${job.schedule}`,
          `**Command:** ${job.command}`,
          `**Active:** ${job.active}`,
          `**Created:** ${job.created_at}`,
          `**Updated:** ${job.updated_at}`,
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

  // -------------------------------------------------------------------------
  // get_job_history
  // -------------------------------------------------------------------------

  server.tool(
    'get_job_history',
    'Get the execution history for a pg_cron job, including run status, start/finish times, and any return messages.',
    {
      job_id: z.number().int().positive().describe('Numeric pg_cron job ID.'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of history records to return.'),
    },
    async ({ job_id, limit }): Promise<CallToolResult> => {
      try {
        const result = await client.cron.getJobHistory(job_id, limit)
        const tableText = formatMarkdownTable(result.history, [
          'run_id',
          'status',
          'started_at',
          'finished_at',
          'return_message',
        ])
        return ok(`Job ${job_id} history (${result.total} total runs):\n\n${tableText}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // create_job (write-mode only)
  // -------------------------------------------------------------------------

  if (!readOnly) {
    server.tool(
      'create_job',
      'Create a new pg_cron job with the given name, cron schedule, and SQL command.',
      {
        name: z.string().describe('Human-readable job name (must be unique within the project).'),
        schedule: z.string().describe('Cron expression (e.g. "0 * * * *" for hourly).'),
        command: z.string().describe('SQL statement to execute on each trigger.'),
      },
      async ({ name, schedule, command }): Promise<CallToolResult> => {
        try {
          const job = await client.cron.createJob(name, schedule, command)
          return ok(`Cron job "${job.name}" created successfully (ID: ${job.id}).`)
        } catch (err) {
          if (err instanceof MimDBApiError) {
            return errResult(formatToolError(err.status, err.apiError))
          }
          throw err
        }
      },
    )

    // -------------------------------------------------------------------------
    // delete_job (write-mode only)
    // -------------------------------------------------------------------------

    server.tool(
      'delete_job',
      'Delete a pg_cron job by ID. The job will be unscheduled immediately.',
      {
        job_id: z.number().int().positive().describe('Numeric pg_cron job ID to delete.'),
      },
      async ({ job_id }): Promise<CallToolResult> => {
        try {
          await client.cron.deleteJob(job_id)
          return ok(`Cron job ${job_id} deleted successfully.`)
        } catch (err) {
          if (err instanceof MimDBApiError) {
            return errResult(formatToolError(err.status, err.apiError))
          }
          throw err
        }
      },
    )
  }
}
