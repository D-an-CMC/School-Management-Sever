export declare class TeacherService {
    findMany(params: {
        search?: string;
        page: number;
        limit: number;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        data: any[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        success: true;
    }>;
    findById(id: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    getStats(): Promise<{
        success: true;
        data: {
            totalTeachers: number;
            activeTeachers: number;
            offDutyTeachers: number;
        };
    }>;
}
export declare const teacherService: TeacherService;
//# sourceMappingURL=teacher.service.d.ts.map