import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

// Các môn đánh giá "Đạt/Chưa đạt" (không có điểm số, không tính vào ĐTB).
export const NON_SCORED_SUBJECT_IDS = new Set<number>([4, 9, 14, 15, 35, 36, 37]);

function isScoredSubject(subjectId?: number): boolean {
	if (subjectId == null) return true;
	return !NON_SCORED_SUBJECT_IDS.has(Number(subjectId));
}

async function resolveSemesterId(semesterId?: number): Promise<number> {
	if (semesterId) return semesterId;

	// Prefer the active semester of the current school year.
	const { data: currentYear } = await supabase
		.from('school_years')
		.select('school_year_id')
		.eq('is_current', true)
		.maybeSingle();

	if (currentYear) {
		const { data: activeSem } = await supabase
			.from('semesters')
			.select('semester_id')
			.eq('school_year_id', currentYear.school_year_id)
			.eq('is_active', true)
			.maybeSingle();
		if (activeSem) return activeSem.semester_id;
	}

	const { data: firstSem } = await supabase
		.from('semesters')
		.select('semester_id')
		.order('semester_id', { ascending: true })
		.limit(1)
		.maybeSingle();

	return firstSem?.semester_id || 1;
}

// Build the subject_results row for a given student+subject (per semester),
// matching the lookup logic used elsewhere.
async function findResultRow(studentId: number, subjectId: number, semesterId: number) {
	const { data: existingSrs } = await supabase
		.from('subject_results')
		.select('result_id')
		.eq('student_id', studentId)
		.eq('subject_id', subjectId)
		.eq('semester_id', semesterId)
		.order('result_id', { ascending: false });

	if (existingSrs && existingSrs.length > 0) return existingSrs[0].result_id;
	return null;
}

export class GradeService {
	async findByClass(classId: number, subjectId?: number, semesterId?: number, mode?: string) {
		// "year" / "ca-nam" aggregates both semesters of the current school year.
		if (mode === 'year' || mode === 'ca-nam' || mode === 'cả-năm') {
			return this.findByClassYear(classId, subjectId);
		}

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
			.select('result_id, student_id, subject_id, semester_id, ranking')
			.in('student_id', studentIds)
			.eq('semester_id', semId);

		if (subjectId) query = query.eq('subject_id', subjectId);

		let { data: subjectResults } = await query;

		// Fallback: Only when the caller did NOT specify a semester, search subject_results
		// across any semester. If a semester was explicitly chosen, keep results scoped to it
		// so switching semesters shows that semester's own data.
		if (!subjectResults || subjectResults.length === 0) {
			if (!semesterId) {
				let fallbackQuery = supabase
					.from('subject_results')
					.select('result_id, student_id, subject_id, semester_id, ranking')
					.in('student_id', studentIds);
				if (subjectId) fallbackQuery = fallbackQuery.eq('subject_id', subjectId);
				const { data: fbRes } = await fallbackQuery;
				if (fbRes && fbRes.length > 0) subjectResults = fbRes;
			}
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
					ranking: '',
				}))
			);
		}

		const resultToStudent = new Map<number, number>();
		const rankingByStudent = new Map<number, string>();
		const activeResultIds: number[] = [];
		const seenStudentIds = new Set<number>();

		const sortedResults = [...(subjectResults || [])].sort((a, b) => b.result_id - a.result_id);
		sortedResults.forEach((r: any) => {
			if (!seenStudentIds.has(r.student_id)) {
				seenStudentIds.add(r.student_id);
				activeResultIds.push(r.result_id);
				resultToStudent.set(r.result_id, r.student_id);
				if (r.ranking) rankingByStudent.set(r.student_id, String(r.ranking));
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
					ranking: '',
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
			ranking: rankingByStudent.get(s.student_id) || '',
		}));

		return success(rows);
	}

	// Aggregate the whole school year: combines HK I + HK II scores.
	async findByClassYear(classId: number, subjectId?: number) {
		const { data: students } = await supabase
			.from('students')
			.select('student_id, student_code, full_name')
			.eq('class_id', classId)
			.order('full_name');

		if (!students || students.length === 0) {
			return success([]);
		}

		// Resolve the two semester ids for the current school year.
		const { data: currentYear } = await supabase
			.from('school_years')
			.select('school_year_id')
			.eq('is_current', true)
			.maybeSingle();

		let semesterIds: number[] = [];
		if (currentYear) {
			const { data: sems } = await supabase
				.from('semesters')
				.select('semester_id')
				.eq('school_year_id', currentYear.school_year_id)
				.order('term_order', { ascending: true });
			semesterIds = (sems || []).map((s: any) => s.semester_id);
		}
		if (semesterIds.length === 0) {
			const { data: allSems } = await supabase
				.from('semesters')
				.select('semester_id')
				.order('term_order', { ascending: true })
				.limit(2);
			semesterIds = (allSems || []).map((s: any) => s.semester_id);
		}

		const studentIds = students.map((s) => s.student_id);

		let query = supabase
			.from('subject_results')
			.select('result_id, student_id, subject_id, semester_id, ranking')
			.in('student_id', studentIds)
			.in('semester_id', semesterIds);

		if (subjectId) query = query.eq('subject_id', subjectId);

		const { data: subjectResults } = await query;
		if (!subjectResults || subjectResults.length === 0) {
			return success(
				students.map((s: any) => ({
					student_id: s.student_id,
					student_code: s.student_code,
					full_name: s.full_name,
					freq: [],
					midTerm: '',
					finalTerm: '',
					sem1: { midTerm: '', finalTerm: '', freq: [] },
					sem2: { midTerm: '', finalTerm: '', freq: [] },
				}))
			);
		}

		const resultToStudent = new Map<number, number>();
		const resultToSemester = new Map<number, number>();
		const resultToRanking = new Map<number, string>();
		const activeResultIds: number[] = [];
		const seen = new Set<string>();

		// Keep the most recent subject_result per (student, semester).
		const sortedResults = [...(subjectResults || [])].sort((a, b) => b.result_id - a.result_id);
		sortedResults.forEach((r: any) => {
			const key = `${r.student_id}:${r.semester_id}`;
			if (!seen.has(key)) {
				seen.add(key);
				activeResultIds.push(r.result_id);
				resultToStudent.set(r.result_id, r.student_id);
				resultToSemester.set(r.result_id, r.semester_id);
				if (r.ranking) resultToRanking.set(r.result_id, r.ranking);
			}
		});

		const { data: gradeItems } = await supabase
			.from('grade_items')
			.select('result_id, score, grade_type_id, grade_types(grade_type_id, type_code, type_name)')
			.in('result_id', activeResultIds);

		// Per student, per semester, track scores.
		const semMap = new Map<number, { 1?: any; 2?: any }>();
		(gradeItems || []).forEach((g: any) => {
			const studentId = resultToStudent.get(g.result_id);
			if (studentId == null) return;
			const semesterId = resultToSemester.get(g.result_id);
			const typeCode = (g.grade_types?.type_code || '').toUpperCase();
			const typeName = (g.grade_types?.type_name || '').toLowerCase();
			const scoreStr = String(g.score);

			const isMid = typeCode === 'GK' || typeName.includes('giữa') || typeName.includes('mid');
			const isFinal = typeCode === 'CK' || typeName.includes('cuối') || typeName.includes('final');

			if (!semMap.has(studentId)) semMap.set(studentId, {});
			const entry = semMap.get(studentId)!;
			// Determine which slot (1 or 2) by term_order of semester id.
			const slot = semesterIds.length >= 2 && semesterIds[0] === semesterId ? 1 : 2;
			if (!entry[slot]) entry[slot] = { freq: [], midTerm: '', finalTerm: '' };

			if (isMid) entry[slot].midTerm = scoreStr;
			else if (isFinal) entry[slot].finalTerm = scoreStr;
			else entry[slot].freq.push(scoreStr);
		});

		// Per student, per semester, track the ranking (for non-scored subjects).
		const rankMap = new Map<number, { 1?: string; 2?: string }>();
		resultToRanking.forEach((rank, resultId) => {
			const studentId = resultToStudent.get(resultId);
			if (studentId == null) return;
			const slot = semesterIds.length >= 2 && semesterIds[0] === resultToSemester.get(resultId) ? 1 : 2;
			if (!rankMap.has(studentId)) rankMap.set(studentId, {});
			rankMap.get(studentId)![slot] = rank;
		});

		const rows = students.map((s: any) => {
			const entry = semMap.get(s.student_id) || {};
			const sem1 = entry[1] || { freq: [], midTerm: '', finalTerm: '' };
			const sem2 = entry[2] || { freq: [], midTerm: '', finalTerm: '' };
			const combinedFreq = [...(sem1.freq || []), ...(sem2.freq || [])];
			const ranks = rankMap.get(s.student_id) || {};
			return {
				student_id: s.student_id,
				student_code: s.student_code,
				full_name: s.full_name,
				freq: combinedFreq,
				midTerm: sem2.midTerm || sem1.midTerm,
				finalTerm: sem2.finalTerm || sem1.finalTerm,
				ranking: ranks[2] || ranks[1] || '',
				sem1,
				sem2,
			};
		});

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

			// Môn "Đạt/Chưa đạt": lưu trạng thái vào cột ranking, không có điểm số.
			if (!isScoredSubject(sId)) {
				const ranking = String(sg.ranking ?? '').trim();
				const { error: rankErr } = await supabase
					.from('subject_results')
					.update({ ranking: ranking || null })
					.eq('result_id', resultId);
				if (rankErr) {
					console.error('Failed to save ranking:', rankErr);
					errors.push(`Học sinh ${studentId}: lưu xếp loại thất bại`);
				}
				continue;
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
