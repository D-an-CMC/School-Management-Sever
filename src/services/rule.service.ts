import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

export interface ScheduleRule {
  subject_id: number;
  periods_per_week: number;
  session: 'morning' | 'afternoon' | 'any';
  double_period: number;
  teacher_id: number | null;
  enabled: boolean;
}

export class RuleService {
  async list() {
    const result = await supabase
      .from('schedule_rules')
      .select('rule_id, subject_id, periods_per_week, session, double_period, teacher_id, enabled, subjects(subject_id, subject_name, subject_code)')
      .order('subject_id');

    if (result.error) {
      return error(result.error.message, 'DB_ERROR');
    }

    return success(result.data ?? []);
  }

  async upsert(entries: ScheduleRule[]) {
    if (!entries || entries.length === 0) {
      return success([]);
    }

    const rows = entries.map((e) => ({
      subject_id: Number(e.subject_id),
      periods_per_week: Math.max(0, Number(e.periods_per_week) || 0),
      session: e.session || 'any',
      double_period: [1, 2, 3].includes(Number(e.double_period)) ? Number(e.double_period) : 1,
      teacher_id: e.teacher_id ? Number(e.teacher_id) : null,
      enabled: e.enabled !== false,
    }));

    const result = await supabase
      .from('schedule_rules')
      .upsert(rows, { onConflict: 'subject_id' });

    if (result.error) {
      return error(result.error.message, 'DB_ERROR');
    }

    return success(result.data ?? []);
  }
}

export const ruleService = new RuleService();
