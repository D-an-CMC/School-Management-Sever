export interface CreateUserInput {
    email: string;
    password: string;
    username?: string;
    phone?: string;
    role: string;
    is_active?: boolean;
    full_name?: string;
    gender?: string;
    date_of_birth?: string;
    class_id?: number;
    student_code?: string;
    teacher_code?: string;
    department?: string;
    school_year_id?: number;
}
declare function generateStudentCode(schoolYearId: number): Promise<string>;
export declare class UserService {
    findMany(params: {
        search?: string;
        role?: string;
        page: number;
        limit: number;
    }): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
        total: number;
        page: number;
        limit: number;
    }>;
    findById(userId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    createUser(input: CreateUserInput): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: {
            role_name: any;
            user_id?: any;
            email?: any;
            username?: any;
            phone?: any;
            is_active?: any;
            role_id?: any;
            roles?: {
                role_name: any;
            }[] | undefined;
        };
    }>;
    updateUser(userId: number, patch: Partial<CreateUserInput>): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    getStats(): Promise<{
        success: true;
        data: {
            totalStudents: number;
            totalTeachers: number;
        };
    }>;
}
export { generateStudentCode };
export declare const userService: UserService;
//# sourceMappingURL=user.service.d.ts.map