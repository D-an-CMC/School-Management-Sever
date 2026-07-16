export declare class PermissionService {
    findAllRoles(): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
    findRoleById(roleId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any;
    }>;
    findPermissionsByRole(roleId: number): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: {
            permission_id: any;
            permission_name: any;
            description: any;
            enabled: boolean;
        }[];
    }>;
    updatePermissions(roleId: number, permissionIds: number[]): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: {
            success: boolean;
        };
    }>;
    findAllPermissions(): Promise<{
        success: false;
        error: string;
        code: string;
    } | {
        success: true;
        data: any[];
    }>;
}
export declare const permissionService: PermissionService;
//# sourceMappingURL=permission.service.d.ts.map