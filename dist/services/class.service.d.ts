export declare class ClassService {
    findMany(params: {
        teacherId?: number;
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
    findById(classId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    getStudents(classId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    getGradeStats(): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: {
            class_count: number;
            student_count: number;
            grade_level: number;
        }[];
    }>;
}
export declare const classService: ClassService;
//# sourceMappingURL=class.service.d.ts.map