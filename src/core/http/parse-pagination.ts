const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface PaginationQuery {
  page?: unknown;
  limit?: unknown;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(query: PaginationQuery = {}): PaginationResult {
  const page = Number(query.page);
  const limit = Number(query.limit);

  const safePage = Number.isInteger(page) && page >= 1 ? page : DEFAULT_PAGE;
  const safeLimit =
    Number.isInteger(limit) && limit >= 1 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT;

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit
  };
}
