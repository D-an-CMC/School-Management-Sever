export declare class TimetableService {
    findMany(params: {
        teacherId?: number;
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
    examSchedules(params: {
        classId?: number;
        semesterId?: number;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    subjects(): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    semesters(): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
}
export declare const timetableService: TimetableService;
//# sourceMappingURL=timetable.service.d.ts.map