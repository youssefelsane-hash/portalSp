import { User } from '../../auth/entities/user.entity';
import { EmployeeProfile } from '../entities/employee-profile.entity';

/**
 * **رد إنشاء الموظف** (ADR-0111) — نفس رد الموظف العادي + كود التنشيط.
 *
 * منفصل عن `EmployeeResponseDto` عمدًا: الكود بيرجع في **رد الإنشاء وإعادة الإصدار بس**،
 * فلو كان حقلًا اختياريًا على النوع العادي كان أي `GET /admin/employees` هيبان كأنه ممكن
 * يحمله — وده بالظبط نوع اللبس اللي بيخلي حد يفكر إنه يقدر يقراه تاني بعدين (مش ممكن).
 */
export interface CreatedEmployeeResponseDto extends EmployeeResponseDto {
  activation_code: string;
  activation_code_expires_at: string;
}

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

export function toEmployeeResponseDto(profile: EmployeeProfile, user: User): EmployeeResponseDto {
  return {
    user_id: user.id,
    employee_code: profile.employeeCode,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    department: profile.department,
    title: profile.title,
    manager_user_id: profile.managerUserId,
    hire_date: profile.hireDate,
    is_active: profile.isActive,
    is_blocked: user.isBlocked,
    blocked_reason: user.blockedReason,
    notes: profile.notes,
    created_at: profile.createdAt.toISOString(),
  };
}
