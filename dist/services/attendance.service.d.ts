export declare class AttendanceService {
    findSessions(params: {
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
    findWithRecords(sessionId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: {
            session: any;
            records: {
                attendance_id: any;
                session_id: any;
                student_id: any;
                status: any;
                check_time: any;
                note: any;
            }[];
        };
    }>;
    createSession(data: {
        teacherId?: number;
        sessionDate?: string;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    batchUpdate(records: {
        attendanceId: number;
        status: string;
        note?: string;
    }[]): Promise<{
        success: true;
        data: {
            attendanceId: number;
            data: any;
            error: import("@supabase/postgrest-js").PostgrestError | null;
        }[];
    }>;
}
export declare const attendanceService: AttendanceService;
//# sourceMappingURL=attendance.service.d.ts.map