import { AuthRequest } from './auth.middleware';
export type Role = 'Admin' | 'GiaoVien' | 'HocSinh-PhuHuynh';
export declare function roleMiddleware(allowedRoles: Role[]): (req: AuthRequest, res: any, next: any) => any;
//# sourceMappingURL=role.middleware.d.ts.map