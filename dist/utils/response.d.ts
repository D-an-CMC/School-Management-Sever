export declare const success: <T>(data: T) => {
    success: true;
    data: T;
};
export declare const error: (message: string, code?: string) => {
    success: false;
    error: string;
    code: string;
};
//# sourceMappingURL=response.d.ts.map