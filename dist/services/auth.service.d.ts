export interface LoginInput {
    email: string;
    password: string;
}
export interface AuthUser {
    id: number;
    email: string;
    role: string;
    name: string;
    avatar?: string;
    department?: string;
    classCode?: string;
}
export declare class AuthService {
    login(input: LoginInput): Promise<{
        token: string;
        user: AuthUser;
    }>;
    me(userId: number): Promise<AuthUser>;
    private getRoleName;
}
export declare const authService: AuthService;
//# sourceMappingURL=auth.service.d.ts.map