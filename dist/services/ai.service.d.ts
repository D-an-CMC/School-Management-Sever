export declare class AiService {
    riskStats(): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: {
            high: number;
            medium: number;
            low: number;
            completionRate: number;
            avgGpa: number;
        };
    }>;
    riskWarnings(params: {
        classId?: number;
        studentId?: number;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    learningPredictions(studentId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    chatbotConversations(userId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    createConversation(userId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    addMessage(conversationId: number, message: {
        sender_type: string;
        message_content: string;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
}
export declare const aiService: AiService;
//# sourceMappingURL=ai.service.d.ts.map