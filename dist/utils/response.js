export const success = (data) => ({
    success: true,
    data,
});
export const error = (message, code = 'ERROR') => ({
    success: false,
    error: message,
    code,
});
//# sourceMappingURL=response.js.map