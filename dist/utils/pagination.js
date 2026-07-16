export function buildPagination(params) {
    const page = Math.max(1, params.page);
    const limit = Math.min(500, Math.max(1, params.limit));
    return { offset: (page - 1) * limit, limit };
}
export function paginate(data, total, page, limit) {
    return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    };
}
//# sourceMappingURL=pagination.js.map