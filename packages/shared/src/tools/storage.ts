/**
 * @module tools/storage
 * MCP tool definitions for MimDB storage operations.
 *
 * Registers up to ten tools against an MCP server:
 *
 * Always registered (read tools):
 * - `list_buckets` - enumerate all buckets in the project
 * - `list_objects` - list objects inside a bucket with optional prefix filter
 * - `download_object` - retrieve an object's content (text or base64)
 * - `get_signed_url` - generate a time-limited signed URL for a private object
 * - `get_public_url` - compute the public URL for an object in a public bucket
 *
 * Only registered when `readOnly` is `false` (write tools):
 * - `create_bucket` - create a new storage bucket
 * - `update_bucket` - update mutable bucket properties
 * - `delete_bucket` - permanently delete a bucket
 * - `upload_object` - upload a base64-encoded object to a bucket
 * - `delete_object` - permanently delete a single object
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
 * Registers storage MCP tools on `server`.
 *
 * Five read tools are always registered. Five write tools are skipped when
 * `readOnly` is `true`.
 *
 * @param server - MCP server instance to attach tools to.
 * @param client - MimDB client used to make API calls.
 * @param readOnly - When `true`, write tools are not registered.
 */
export function register(server: McpServer, client: MimDBClient, readOnly = false): void {
  // -------------------------------------------------------------------------
  // list_buckets
  // -------------------------------------------------------------------------

  server.tool(
    'list_buckets',
    'List all storage buckets in the project, including their visibility, file size limit, and creation time.',
    {
      cursor: z.string().optional().describe('Opaque pagination cursor from a previous response.'),
      limit: z.number().int().positive().optional().describe('Maximum number of buckets to return.'),
    },
    async ({ cursor, limit }): Promise<CallToolResult> => {
      try {
        const buckets = await client.storage.listBuckets({ cursor, limit })
        const table = formatMarkdownTable(buckets, ['name', 'public', 'file_size_limit', 'created_at'])
        return ok(`Found ${buckets.length} bucket(s):\n\n${table}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // list_objects
  // -------------------------------------------------------------------------

  server.tool(
    'list_objects',
    'List objects stored in a bucket, with optional prefix filtering and pagination.',
    {
      bucket: z.string().describe('Name of the bucket to list.'),
      prefix: z.string().optional().describe('Only return objects whose path starts with this prefix.'),
      cursor: z.string().optional().describe('Opaque pagination cursor from a previous response.'),
      limit: z.number().int().positive().optional().describe('Maximum number of objects to return.'),
    },
    async ({ bucket, prefix, cursor, limit }): Promise<CallToolResult> => {
      try {
        const objects = await client.storage.listObjects(bucket, { prefix, cursor, limit })
        const table = formatMarkdownTable(objects, ['name', 'size', 'content_type', 'updated_at'])
        return ok(`Found ${objects.length} object(s) in bucket "${bucket}":\n\n${table}`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // download_object
  // -------------------------------------------------------------------------

  server.tool(
    'download_object',
    'Download an object from a bucket. Text content types are returned as plain text; binary content types are returned as base64.',
    {
      bucket: z.string().describe('Name of the bucket that owns the object.'),
      path: z.string().describe('Object path within the bucket (e.g. "avatars/user-1.png").'),
    },
    async ({ bucket, path }): Promise<CallToolResult> => {
      try {
        const response = await client.storage.downloadObject(bucket, path)
        const contentType = response.headers.get('content-type') ?? ''
        const isText =
          contentType.startsWith('text/') ||
          contentType.includes('json') ||
          contentType.includes('xml') ||
          contentType.includes('javascript') ||
          contentType.includes('csv')

        if (isText) {
          const text = await response.text()
          return ok(`Content-Type: ${contentType}\n\n${text}`)
        } else {
          const buffer = await response.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')
          return ok(`Content-Type: ${contentType}\nEncoding: base64\n\n${base64}`)
        }
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // get_signed_url
  // -------------------------------------------------------------------------

  server.tool(
    'get_signed_url',
    'Generate a time-limited signed URL for temporary public access to a private object.',
    {
      bucket: z.string().describe('Name of the bucket that owns the object.'),
      path: z.string().describe('Object path within the bucket.'),
    },
    async ({ bucket, path }): Promise<CallToolResult> => {
      try {
        const signedUrl = await client.storage.getSignedUrl(bucket, path)
        return ok(signedUrl)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // get_public_url
  // -------------------------------------------------------------------------

  server.tool(
    'get_public_url',
    'Compute the public URL for an object in a public bucket. No API call is made; the URL is derived from the project configuration.',
    {
      bucket: z.string().describe('Name of the public bucket that owns the object.'),
      path: z.string().describe('Object path within the bucket.'),
    },
    async ({ bucket, path }): Promise<CallToolResult> => {
      const publicUrl = client.storage.getPublicUrl(bucket, path, client.baseUrl)
      return ok(publicUrl)
    },
  )

  // -------------------------------------------------------------------------
  // Write tools - skipped in read-only mode
  // -------------------------------------------------------------------------

  if (readOnly) return

  // -------------------------------------------------------------------------
  // create_bucket
  // -------------------------------------------------------------------------

  server.tool(
    'create_bucket',
    'Create a new storage bucket in the project.',
    {
      name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9.-]+$/)
        .describe('Bucket name. Must start with a lowercase letter or digit and contain only lowercase letters, digits, dots, and hyphens.'),
      public: z.boolean().optional().describe('When true, allows unauthenticated read access. Defaults to false.'),
    },
    async ({ name, public: isPublic }): Promise<CallToolResult> => {
      try {
        await client.storage.createBucket(name, isPublic)
        return ok(`Bucket "${name}" created successfully.`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // update_bucket
  // -------------------------------------------------------------------------

  server.tool(
    'update_bucket',
    'Update mutable properties on an existing bucket such as visibility, file size limit, or allowed MIME types.',
    {
      name: z.string().describe('Name of the bucket to update.'),
      public: z.boolean().optional().describe('Whether to allow unauthenticated read access.'),
      file_size_limit: z.number().int().positive().optional().describe('Maximum file size in bytes.'),
      allowed_types: z.array(z.string()).optional().describe('List of allowed MIME types (e.g. ["image/png", "image/jpeg"]).'),
    },
    async ({ name, public: isPublic, file_size_limit, allowed_types }): Promise<CallToolResult> => {
      try {
        await client.storage.updateBucket(name, {
          public: isPublic,
          file_size_limit,
          allowed_types,
        })
        return ok(`Bucket "${name}" updated successfully.`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // delete_bucket
  // -------------------------------------------------------------------------

  server.tool(
    'delete_bucket',
    'Permanently delete a bucket and all objects it contains. This action cannot be undone.',
    {
      name: z.string().describe('Name of the bucket to delete.'),
    },
    async ({ name }): Promise<CallToolResult> => {
      try {
        await client.storage.deleteBucket(name)
        return ok(`Bucket "${name}" deleted successfully.`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // upload_object
  // -------------------------------------------------------------------------

  server.tool(
    'upload_object',
    'Upload an object to a bucket. The content must be base64-encoded.',
    {
      bucket: z.string().describe('Name of the destination bucket.'),
      path: z.string().describe('Object path within the bucket (e.g. "avatars/user-1.png").'),
      content: z.string().describe('Base64-encoded file content to upload.'),
      content_type: z.string().optional().describe('MIME type of the file (e.g. "image/png"). Defaults to "application/octet-stream".'),
    },
    async ({ bucket, path, content, content_type }): Promise<CallToolResult> => {
      try {
        const buffer = Buffer.from(content, 'base64')
        await client.storage.uploadObject(bucket, path, buffer, content_type)
        return ok(`Object "${path}" uploaded to bucket "${bucket}" successfully.`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )

  // -------------------------------------------------------------------------
  // delete_object
  // -------------------------------------------------------------------------

  server.tool(
    'delete_object',
    'Permanently delete a single object from a bucket. This action cannot be undone.',
    {
      bucket: z.string().describe('Name of the bucket that owns the object.'),
      path: z.string().describe('Object path within the bucket.'),
    },
    async ({ bucket, path }): Promise<CallToolResult> => {
      try {
        await client.storage.deleteObject(bucket, path)
        return ok(`Object "${path}" deleted from bucket "${bucket}" successfully.`)
      } catch (err) {
        if (err instanceof MimDBApiError) {
          return errResult(formatToolError(err.status, err.apiError))
        }
        throw err
      }
    },
  )
}
