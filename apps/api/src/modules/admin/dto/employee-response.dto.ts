import { User } from '../../auth/entities/user.entity';
import { EmployeeProfile } from '../entities/employee-profile.entity';

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
