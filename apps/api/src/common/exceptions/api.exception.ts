import { HttpException, HttpStatus } from '@nestjs/common';

// أكواد الأخطاء الموحّدة — docs/02-data-dictionary.md §13.9
// لازم أي كود جديد يتضاف هنا الأول قبل ما يتستخدم في أي موديول.
export const ErrorCode = {
  AUTH_001: 'AUTH_001', // توكن غير صالح
  AUTH_002: 'AUTH_002', // انتهت صلاحية التوكن
  AUTH_003: 'AUTH_003', // كود التحقق غير صحيح
  AUTH_004: 'AUTH_004', // تجاوزت عدد المحاولات
  ORDR_001: 'ORDR_001', // الخدمة غير متاحة في منطقتك
  ORDR_002: 'ORDR_002', // لا يوجد فنيون متاحون حالياً
  ORDR_003: 'ORDR_003', // لا يمكن تغيير حالة الطلب من كذا إلى كذا
  ORDR_004: 'ORDR_004', // انتهت مهلة الإلغاء المجاني
  PAY_001: 'PAY_001', // فشلت عملية الدفع
  PAY_002: 'PAY_002', // رصيد غير كافٍ
  PAY_003: 'PAY_003', // عملية مكررة (idempotency)
  TECH_001: 'TECH_001', // حسابك غير معتمد بعد
  TECH_002: 'TECH_002', // وصلت للحد الأقصى للطلبات اليومية
  VAL_001: 'VAL_001', // بيانات غير صحيحة
  RATE_001: 'RATE_001', // تجاوزت عدد الطلبات المسموح
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ApiException extends HttpException {
  constructor(
    public readonly code: ErrorCodeType,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }
}
