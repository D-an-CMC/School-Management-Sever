export declare class ActivityService {
    findMany(params: {
        classId?: number;
        semesterId?: number;
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
}
export declare const activityService: ActivityService;
//# sourceMappingURL=activity.service.d.ts.map