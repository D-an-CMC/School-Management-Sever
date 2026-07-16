export declare class GradeService {
    findByClass(classId: number): Promise<{
        success: true;
        data: {
            student_id: any;
            student_code: any;
            full_name: any;
            grades: any[];
        }[];
    }>;
    gradeTypes(): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    updateGrade(gradeItemId: number, score: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    batchUpdate(updates: {
        gradeItemId: number;
        score: number;
    }[]): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: ({
            success: false;
            error: string;
            code: string;
        } | {
            success: true;
            data: any;
        })[];
    }>;
}
export declare const gradeService: GradeService;
//# sourceMappingURL=grade.service.d.ts.map