export declare class StudentService {
    findMany(params: {
        search?: string;
        classId?: number;
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
            totalStudents: number;
            activeStudents: number;
        };
    }>;
}
export declare const studentService: StudentService;
//# sourceMappingURL=student.service.d.ts.map