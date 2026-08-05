import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

async function resolveSemesterId(semesterId?: number): Promise<number> {
	if (semesterId) return semesterId;

	const { data: firstSem } = await supabase
		.from('semesters')
		.select('semester_id')
		.order('semester_id', { ascending: true })
		.limit(1)
		.maybeSingle();

	return firstSem?.semester_id || 1;
}

export class GradeService {
	async findByClass(classId: number, subjectId?: number, semesterId?: number) {
		const { data: students } = await supabase
			.from('students')
			.select('student_id, student_code, full_name')
			.eq('class_id', classId)
			.order('full_name');

		if (!students || students.length === 0) {
			return success([]);
		}

		const semId = await resolveSemesterId(semesterId);
		const studentIds = students.map((s) => s.student_id);

		let query = supabase
			.from('subject_results')
			.select('result_id, student_id, subject_id, semester_id')
			.in('student_id', studentIds)
			.eq('semester_id', semId);

		if (subjectId) query = query.eq('subject_id', subjectId);

		let { data: subjectResults } = await query;

		// Fallback: If no results found for semId, search subject_results for any semester
		if (!subjectResults || subjectResults.length === 0) {
			let fallbackQuery = supabase
				.from('subject_results')
				.select('result_id, student_id, subject_id, semester_id')
				.in('student_id', studentIds);
			if (subjectId) fallbackQuery = fallbackQuery.eq('subject_id', subjectId);
			const { data: fbRes } = await fallbackQuery;
			if (fbRes && fbRes.length > 0) subjectResults = fbRes;
		}

		if (!subjectResults || subjectResults.length === 0) {
			return success(
				students.map((s: any) => ({
					student_id: s.student_id,
					student_code: s.student_code,
					full_name: s.full_name,
					freq: [],
					midTerm: '',
					finalTerm: '',
				}))
			);
		}

		const resultToStudent = new Map<number, number>();
		const activeResultIds: number[] = [];
		const seenStudentIds = new Set<number>();

		const sortedResults = [...(subjectResults || [])].sort((a, b) => b.result_id - a.result_id);
		sortedResults.forEach((r: any) => {
			if (!seenStudentIds.has(r.student_id)) {
				seenStudentIds.add(r.student_id);
				activeResultIds.push(r.result_id);
				resultToStudent.set(r.result_id, r.student_id);
			}
		});

		if (activeResultIds.length === 0) {
			return success(
				students.map((s: any) => ({
					student_id: s.student_id,
					student_code: s.student_code,
					full_name: s.full_name,
					freq: [],
					midTerm: '',
					finalTerm: '',
				}))
			);
		}

		const { data: gradeItems } = await supabase
			.from('grade_items')
			.select('result_id, score, grade_type_id, grade_types(grade_type_id, type_code, type_name)')
			.in('result_id', activeResultIds);

		const freqByStudent = new Map<number, string[]>();
		const midByStudent = new Map<number, string>();
		const finalByStudent = new Map<number, string>();

		(gradeItems || []).forEach((g: any) => {
			const studentId = resultToStudent.get(g.result_id);
			if (studentId == null) return;
			const typeCode = (g.grade_types?.type_code || '').toUpperCase();
			const typeName = (g.grade_types?.type_name || '').toLowerCase();
			const scoreStr = String(g.score);

			if (typeCode === 'GK' || typeName.includes('giữa') || typeName.includes('mid')) {
				midByStudent.set(studentId, scoreStr);
			} else if (typeCode === 'CK' || typeName.includes('cuối') || typeName.includes('final')) {
				finalByStudent.set(studentId, scoreStr);
			} else {
				if (!freqByStudent.has(studentId)) freqByStudent.set(studentId, []);
				freqByStudent.get(studentId)!.push(scoreStr);
			}
		});

		const rows = students.map((s: any) => ({
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

	async saveClassGrades(classId: number, studentGrades: any[], subjectId?: number, semesterId?: number) {
		void classId;
		const sId = subjectId || 1;
		const semId = await resolveSemesterId(semesterId);

		let { data: gTypes } = await supabase.from('grade_types').select('*');
		if (!gTypes || gTypes.length === 0) {
			const { data: newTypes } = await supabase
				.from('grade_types')
				.insert([
					{ type_code: 'TX', type_name: 'Đánh giá thường xuyên', weight: 1 },
					{ type_code: 'GK', type_name: 'Đánh giá giữa kỳ', weight: 2 },
					{ type_code: 'CK', type_name: 'Đánh giá cuối kỳ', weight: 3 },
				])
				.select('*');
			gTypes = newTypes || [];
		}

		let freqTypeId = 1;
		let midTypeId = 2;
		let finalTypeId = 3;

		if (gTypes && gTypes.length > 0) {
			const fType = gTypes.find(
				(t: any) =>
					(t.type_code || '').toUpperCase() === 'TX' ||
					(t.type_name || '').toLowerCase().includes('thường xuyên') ||
					(t.type_name || '').toLowerCase().includes('15') ||
					(t.type_name || '').toLowerCase().includes('miệng')
			) || gTypes[0];
			const mType = gTypes.find(
				(t: any) =>
					(t.type_code || '').toUpperCase() === 'GK' ||
					(t.type_name || '').toLowerCase().includes('giữa') ||
					(t.type_name || '').toLowerCase().includes('1 tiết')
			) || gTypes[1] || gTypes[0];
			const fnType = gTypes.find(
				(t: any) =>
					(t.type_code || '').toUpperCase() === 'CK' ||
					(t.type_name || '').toLowerCase().includes('cuối') ||
					(t.type_name || '').toLowerCase().includes('học kỳ')
			) || gTypes[2] || gTypes[0];

			if (fType) freqTypeId = fType.grade_type_id || fType.type_id || 1;
			if (mType) midTypeId = mType.grade_type_id || mType.type_id || 2;
			if (fnType) finalTypeId = fnType.grade_type_id || fnType.type_id || 3;
		}

		const errors: string[] = [];

		for (const sg of studentGrades) {
			const studentId = Number(sg.student_id);
			if (!studentId) continue;

			const { data: existingSrs } = await supabase
				.from('subject_results')
				.select('result_id')
				.eq('student_id', studentId)
				.eq('subject_id', sId)
				.eq('semester_id', semId)
				.order('result_id', { ascending: false });

			let resultId: number | null = null;

			if (existingSrs && existingSrs.length > 0) {
				resultId = existingSrs[0].result_id;
				if (existingSrs.length > 1) {
					const dupIds = existingSrs.slice(1).map((r: any) => r.result_id);
					await supabase.from('grade_items').delete().in('result_id', dupIds);
					await supabase.from('subject_results').delete().in('result_id', dupIds);
				}
			} else {
				const { data: newSr, error: srError } = await supabase
					.from('subject_results')
					.insert({ student_id: studentId, subject_id: sId, semester_id: semId })
					.select('result_id')
					.single();

				if (srError || !newSr) {
					console.error('Failed to insert subject_result:', srError);
					errors.push(`Học sinh ${studentId}: tạo subject_result thất bại`);
					continue;
				}
				resultId = newSr.result_id;
			}

			await supabase.from('grade_items').delete().eq('result_id', resultId);

			const itemsToInsert: any[] = [];
			if (Array.isArray(sg.freq)) {
				for (let i = 0; i < sg.freq.length; i++) {
					const fVal = sg.freq[i];
					if (fVal == null || fVal === '') continue;
					const num = parseFloat(String(fVal));
					if (!isNaN(num)) {
						itemsToInsert.push({ result_id: resultId, grade_type_id: freqTypeId, score: num, sequence_no: i });
					}
				}
			}

			if (sg.midTerm != null && sg.midTerm !== '') {
				const midNum = parseFloat(String(sg.midTerm));
				if (!isNaN(midNum)) {
					itemsToInsert.push({ result_id: resultId, grade_type_id: midTypeId, score: midNum, sequence_no: 0 });
				}
			}

			if (sg.finalTerm != null && sg.finalTerm !== '') {
				const finalNum = parseFloat(String(sg.finalTerm));
				if (!isNaN(finalNum)) {
					itemsToInsert.push({ result_id: resultId, grade_type_id: finalTypeId, score: finalNum, sequence_no: 0 });
				}
			}

			if (itemsToInsert.length > 0) {
				const { error: insErr } = await supabase.from('grade_items').insert(itemsToInsert);
				if (insErr) {
					console.error('Failed to insert grade_items:', insErr);
					errors.push(`Học sinh ${studentId}: lưu điểm thất bại - ${insErr.message}`);
				}
			}
		}

		if (errors.length > 0) {
			return error(errors.join('; '), 'SAVE_FAILED');
		}

		return success(true);
	}
}

export const gradeService = new GradeService();
