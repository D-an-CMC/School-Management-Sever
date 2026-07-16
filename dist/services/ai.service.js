import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
export class AiService {
    async riskStats() {
        const result = await supabase
            .from('learning_predictions')
            .select('risk_level')
            .order('analysis_date', { ascending: false });
        if (result.error) {
            return error(result.error.message, 'DB_ERROR');
        }
        const rows = result.data ?? [];
        return success({
            high: rows.length,
            medium: 0,
            low: 0,
            completionRate: 0,
            avgGpa: 0,
        });
    }
    async riskWarnings(params) {
        let q = supabase.from('learning_predictions').select('*');
        if (params.studentId)
            q = q.eq('student_id', params.studentId);
        const result = await q.order('analysis_date', { ascending: false });
        if (result.error) {
            return error(result.error.message, 'DB_ERROR');
        }
        return success(result.data ?? []);
    }
    async learningPredictions(studentId) {
        const result = await supabase
            .from('learning_predictions')
            .select('*')
            .eq('student_id', studentId)
            .order('analysis_date', { ascending: false });
        if (result.error) {
            return error(result.error.message, 'DB_ERROR');
        }
        return success(result.data ?? []);
    }
    async chatbotConversations(userId) {
        const result = await supabase
            .from('chatbot_conversations')
            .select('*, chatbot_messages(*)')
            .eq('user_id', userId)
            .order('started_at', { ascending: false });
        if (result.error) {
            return error(result.error.message, 'DB_ERROR');
        }
        return success(result.data ?? []);
    }
    async createConversation(userId) {
        const result = await supabase
            .from('chatbot_conversations')
            .insert({ user_id: userId, topic: 'New chat' })
            .select()
            .single();
        if (result.error || !result.data) {
            return error(result.error?.message || 'Tạo cuộc hội thoại thất bại', 'CREATE_FAILED');
        }
        return success(result.data);
    }
    async addMessage(conversationId, message) {
        const result = await supabase
            .from('chatbot_messages')
            .insert({
            conversation_id: conversationId,
            ...message,
        })
            .select()
            .single();
        if (result.error || !result.data) {
            return error(result.error?.message || 'Gửi tin nhắn thất bại', 'SEND_FAILED');
        }
        return success(result.data);
    }
}
export const aiService = new AiService();
//# sourceMappingURL=ai.service.js.map