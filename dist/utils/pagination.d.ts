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
export declare function buildPagination(params: PaginationParams): {
    offset: number;
    limit: number;
};
export declare function paginate<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T>;
//# sourceMappingURL=pagination.d.ts.map