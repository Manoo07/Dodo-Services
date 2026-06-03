// ── Pagination ─────────────────────────────────────────────────────────────────

export interface PaginationOptions {
  page:  number   // 0-based
  limit: number   // max items per page
}

export interface PaginationResult<T> {
  data:    T[]
  total:   number
  page:    number
  hasMore: boolean
}

export function parsePagination(query: Record<string, unknown>): PaginationOptions {
  const page  = Math.max(0, parseInt(String(query.page  ?? 0),  10) || 0)
  const limit = Math.min(50, parseInt(String(query.limit ?? 20), 10) || 20)
  return { page, limit }
}

// ── Task filters ────────────────────────────────────────────────────────────────

export interface TaskFilters {
  listId?:    string
  status?:    string
  priority?:  string
  tag?:       string
  parentId?:  string | null
}

// ── Task query options ──────────────────────────────────────────────────────────

export const MAX_DEPTH = 3   // maximum subtask nesting levels to fetch
