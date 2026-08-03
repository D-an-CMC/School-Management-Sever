import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

export class GradeService {
  async findByClass(classId: number) {
    const { data: students } = await supabase
      .from('students')
      .select('student_id, student_code, full_name')
      .eq('class_id', classId)
      .order('full_name');

    const { data: subjectResults } = await supabase
      .from('subject_results')
      .select('result_id, student_id')
      .eq('class_id', classId);

    if (!subjectResults || subjectResults.length === 0) {
      return success(
        (students ?? []).map((s: any) => ({
          student_id: s.student_id,
          student_code: s.student_code,
          full_name: s.full_name,
          freq: [],
          midTerm: '',
          finalTerm: '',
        }))
      );
    }

    const resultIds = subjectResults.map((r) => r.result_id);
    const resultToStudent = new Map<number, number>();
    subjectResults.forEach((r) => resultToStudent.set(r.result_id, r.student_id));

    const { data: gradeItems } = await supabase
      .from('grade_items')
      .select('result_id, score, grade_type_id, grade_types(type_id, type_name)')
      .in('result_id', resultIds);

    const freqByStudent = new Map<number, string[]>();
    const midByStudent = new Map<number, string>();
    const finalByStudent = new Map<number, string>();

    (gradeItems || []).forEach((g: any) => {
      const studentId = resultToStudent.get(g.result_id);
      if (studentId == null) return;
      const typeName = (g.grade_types?.type_name || '').toLowerCase();
      const scoreStr = String(g.score);

      if (typeName.includes('giữa') || typeName.includes('mid')) {
        midByStudent.set(studentId, scoreStr);
      } else if (typeName.includes('cuối') || typeName.includes('final')) {
        finalByStudent.set(studentId, scoreStr);
      } else {
        if (!freqByStudent.has(studentId)) freqByStudent.set(studentId, []);
        freqByStudent.get(studentId)!.push(scoreStr);
      }
    });

    const rows = (students ?? []).map((s: any) => ({
      student_id: s.student_id,
      student_code: s.student_code,
      full_name: s.full_name,
      freq: freqByStudent.get(s.student_id) || [],
      midTerm: midByStudent.get(s.student_id) || '',
      finalTerm: finalByStudent.get(s.student_id) || '',
    }));

    return success(rows);
  }

  async gradeTypes() {
    const result = await supabase.from('grade_types').select('*').order('grade_type_id');

    if (result.error) {
      return error(result.error.message, 'DB_ERROR');
    }

    return success(result.data ?? []);
  }

  async updateGrade(gradeItemId: number, score: number) {
    const result = await supabase
      .from('grade_items')
      .update({ score })
      .eq('grade_item_id', gradeItemId)
      .select()
      .single();

    if (result.error || !result.data) {
      return error('Cập nhật điểm thất bại', 'UPDATE_FAILED');
    }

    return success(result.data);
  }

  async batchUpdate(updates: { gradeItemId: number; score: number }[]) {
    const results: any[] = [];
    for (const u of updates) {
      const r = await this.updateGrade(u.gradeItemId, u.score);
      results.push(r as any);
    }

    const failed = results.filter((r) => !(r as any).success);
    if (failed.length > 0) {
      return error(`${failed.length} cập nhật thất bại`, 'BATCH_PARTIAL_FAILURE');
    }

    return success(results);
  }

  async saveClassGrades(classId: number, studentGrades: any[]) {
    const { data: gTypes } = await supabase.from('grade_types').select('*');
    let freqTypeId = 1;
    let midTypeId = 2;
    let finalTypeId = 3;

    if (gTypes && gTypes.length > 0) {
      const fType = gTypes.find((t: any) =>
        (t.type_name || '').toLowerCase().includes('thường xuyên') ||
        (t.type_name || '').toLowerCase().includes('15') ||
        (t.type_name || '').toLowerCase().includes('miệng')
      ) || gTypes[0];
      const mType = gTypes.find((t: any) =>
        (t.type_name || '').toLowerCase().includes('giữa') ||
        (t.type_name || '').toLowerCase().includes('1 tiết')
      ) || gTypes[1] || gTypes[0];
      const fnType = gTypes.find((t: any) =>
        (t.type_name || '').toLowerCase().includes('cuối') ||
        (t.type_name || '').toLowerCase().includes('học kỳ')
      ) || gTypes[2] || gTypes[0];

      if (fType) freqTypeId = fType.grade_type_id || fType.type_id || 1;
      if (mType) midTypeId = mType.grade_type_id || mType.type_id || 2;
      if (fnType) finalTypeId = fnType.grade_type_id || fnType.type_id || 3;
    }

    for (const sg of studentGrades) {
      const studentId = Number(sg.student_id);
      if (!studentId) continue;

      let { data: sr } = await supabase
        .from('subject_results')
        .select('result_id')
        .eq('student_id', studentId)
        .eq('class_id', classId)
        .maybeSingle();

      if (!sr) {
        const { data: newSr, error: srError } = await supabase
          .from('subject_results')
          .insert({ student_id: studentId, class_id: classId })
          .select('result_id')
          .single();
        if (srError || !newSr) continue;
        sr = newSr;
      }

      const resultId = sr.result_id;

      await supabase.from('grade_items').delete().eq('result_id', resultId);

      const itemsToInsert: any[] = [];
      if (Array.isArray(sg.freq)) {
        for (const fVal of sg.freq) {
          const num = parseFloat(String(fVal));
          if (!isNaN(num)) {
            itemsToInsert.push({ result_id: resultId, grade_type_id: freqTypeId, score: num });
          }
        }
      }

      const midNum = parseFloat(String(sg.midTerm));
      if (!isNaN(midNum)) {
        itemsToInsert.push({ result_id: resultId, grade_type_id: midTypeId, score: midNum });
      }

      const finalNum = parseFloat(String(sg.finalTerm));
      if (!isNaN(finalNum)) {
        itemsToInsert.push({ result_id: resultId, grade_type_id: finalTypeId, score: finalNum });
      }

      if (itemsToInsert.length > 0) {
        await supabase.from('grade_items').insert(itemsToInsert);
      }
    }

    return success(true);
  }
}

export const gradeService = new GradeService();

