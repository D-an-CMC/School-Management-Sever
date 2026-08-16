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
  // L2: NaN từ Number('abc')/z.coerce — clamp về mặc định thay vì lan NaN.
  const safePage = Number.isFinite(params.page) ? params.page : 1;
  const safeLimit = Number.isFinite(params.limit) ? params.limit : 10;
  const page = Math.max(1, safePage);
  const limit = Math.min(5000, Math.max(1, safeLimit));
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
