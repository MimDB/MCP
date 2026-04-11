import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseClient, MimDBApiError } from '../src/client/base.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock Response object suitable for use with vi.stubGlobal('fetch').
 */
function makeMockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headers[key] ?? null,
    },
    json: async () => body,
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// BaseClient
// ---------------------------------------------------------------------------

describe('BaseClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  // -------------------------------------------------------------------------
  // Auth headers
  // -------------------------------------------------------------------------

  describe('auth headers', () => {
    it('sends apikey header for project requests when serviceRoleKey is configured', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: { ok: true }, error: null, meta: { request_id: 'r1' } }),
      )

      await client.get('/v1/test')

      const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['apikey']).toBe('srk-test-key')
      expect(headers['Authorization']).toBeUndefined()
    })

    it('sends Authorization: Bearer header when useAdmin is true and adminSecret is configured', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        adminSecret: 'admin-secret-token',
      })

      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: { result: 'ok' }, error: null, meta: { request_id: 'r2' } }),
      )

      await client.get('/v1/admin/test', { useAdmin: true })

      const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer admin-secret-token')
      expect(headers['apikey']).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws MimDBApiError with parsed error body on non-ok response', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      const apiError = { code: 'ERR_NOT_FOUND', message: 'Resource not found' }
      mockFetch.mockResolvedValueOnce(
        makeMockResponse(404, {
          data: null,
          error: apiError,
          meta: { request_id: 'r3' },
        }),
      )

      let thrown: unknown
      try {
        await client.get('/v1/missing')
      } catch (err) {
        thrown = err
      }

      expect(thrown).toBeInstanceOf(MimDBApiError)
      const error = thrown as MimDBApiError
      expect(error.status).toBe(404)
      expect(error.apiError).toEqual(apiError)
      expect(error.requestId).toBe('r3')
    })

    it('throws MimDBApiError with status 0 on network error (fetch throws)', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      let thrown: unknown
      try {
        await client.get('/v1/test')
      } catch (err) {
        thrown = err
      }

      expect(thrown).toBeInstanceOf(MimDBApiError)
      const error = thrown as MimDBApiError
      expect(error.status).toBe(0)
      expect(error.message).toContain('Network error')
    })
  })

  // -------------------------------------------------------------------------
  // Successful responses
  // -------------------------------------------------------------------------

  describe('successful responses', () => {
    it('returns parsed data on 200', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      const payload = { id: '123', name: 'test' }
      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: payload, error: null, meta: { request_id: 'r4' } }),
      )

      const result = await client.get<typeof payload>('/v1/resource')
      expect(result).toEqual(payload)
    })

    it('returns undefined for 204 No Content', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      mockFetch.mockResolvedValueOnce(makeMockResponse(204, null))

      const result = await client.delete('/v1/resource/123')
      expect(result).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // URL construction
  // -------------------------------------------------------------------------

  describe('URL construction', () => {
    it('strips trailing slash from baseUrl', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io/',
        serviceRoleKey: 'srk-test-key',
      })

      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: null, error: null, meta: { request_id: 'r5' } }),
      )

      await client.get('/v1/test')

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.mimdb.io/v1/test')
    })

    it('appends query parameters to the URL', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: [], error: null, meta: { request_id: 'r6' } }),
      )

      await client.get('/v1/items', { query: { limit: 10, filter: 'active' } })

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('limit=10')
      expect(url).toContain('filter=active')
    })

    it('omits undefined query parameter values', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: [], error: null, meta: { request_id: 'r7' } }),
      )

      await client.get('/v1/items', { query: { limit: 10, cursor: undefined } })

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('limit=10')
      expect(url).not.toContain('cursor')
    })
  })

  // -------------------------------------------------------------------------
  // HTTP methods
  // -------------------------------------------------------------------------

  describe('HTTP methods', () => {
    it('uses GET method for get()', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })
      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: null, error: null, meta: { request_id: 'r8' } }),
      )
      await client.get('/v1/test')
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('GET')
    })

    it('uses POST method for post()', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })
      mockFetch.mockResolvedValueOnce(
        makeMockResponse(201, { data: { id: '1' }, error: null, meta: { request_id: 'r9' } }),
      )
      await client.post('/v1/items', { name: 'test' })
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ name: 'test' }))
    })

    it('uses PATCH method for patch()', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })
      mockFetch.mockResolvedValueOnce(
        makeMockResponse(200, { data: { id: '1' }, error: null, meta: { request_id: 'r10' } }),
      )
      await client.patch('/v1/items/1', { name: 'updated' })
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('PATCH')
    })

    it('uses DELETE method for delete()', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })
      mockFetch.mockResolvedValueOnce(makeMockResponse(204, null))
      await client.delete('/v1/items/1')
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('DELETE')
    })
  })

  // -------------------------------------------------------------------------
  // getRaw
  // -------------------------------------------------------------------------

  describe('getRaw', () => {
    it('returns the raw Response object', async () => {
      const client = new BaseClient({
        baseUrl: 'https://api.mimdb.io',
        serviceRoleKey: 'srk-test-key',
      })

      const fakeResponse = makeMockResponse(200, 'blob-data')
      mockFetch.mockResolvedValueOnce(fakeResponse)

      const result = await client.getRaw('/v1/download')
      expect(result).toBe(fakeResponse)
    })
  })
})
