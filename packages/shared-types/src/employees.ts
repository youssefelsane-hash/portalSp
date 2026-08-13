// مطابق لـ apps/api/src/modules/admin/dto/employee-response.dto.ts وadmin-employees.service.ts
export interface EmployeeResponseDto {
  user_id: string;
  employee_code: string;
  full_name: string;
  phone_number: string;
  department: string;
  title: string | null;
  manager_user_id: string | null;
  hire_date: string | null;
  is_active: boolean;
  is_blocked: boolean;
  blocked_reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface EmployeeDetail {
  employee: EmployeeResponseDto;
  roles: { role_id: string; role_name: string; display_name: string; assigned_at: string }[];
  recent_logins: {
    device_name: string | null;
    device_platform: string | null;
    ip_address: string | null;
    created_at: string;
    is_revoked: boolean;
  }[];
  recent_activity: { action: string; entity_type: string; entity_id: string; created_at: string }[];
}

export interface CreateEmployeeBody {
  phone_number: string;
  full_name: string;
  department: string;
  title?: string;
  manager_user_id?: string;
  hire_date?: string;
  notes?: string;
  initial_role_name?: string;
}

export interface UpdateEmployeeBody {
  full_name?: string;
  department?: string;
  title?: string;
  manager_user_id?: string | null;
  hire_date?: string;
  notes?: string;
  is_active?: boolean;
}

export interface AssignRoleBody {
  role_name: string;
}
