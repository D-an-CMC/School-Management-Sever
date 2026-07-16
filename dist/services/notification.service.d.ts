export declare class NotificationService {
    findByUser(userId: number, params: {
        page: number;
        limit: number;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        data: {
            notification_id: any;
            title: any;
            content: any;
            target_type: any;
            created_at: any;
        }[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        success: true;
    }>;
    findAll(params: {
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
    markAsRead(notificationId: number, userId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: {
            success: boolean;
        };
    }>;
    create(input: {
        title: string;
        content?: string;
        targetType?: string;
        senderId?: number;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
}
export declare const notificationService: NotificationService;
//# sourceMappingURL=notification.service.d.ts.map