export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function buildPagination(params: PaginationParams): {
  offset: number;
  limit: number;
} {
  const page = Math.max(1, params.page);
  const limit = Math.min(500, Math.max(1, params.limit));
  return { offset: (page - 1) * limit, limit };
}

export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResult<T> {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
