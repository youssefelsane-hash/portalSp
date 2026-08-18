import { IsUUID } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

// Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37). نفس CreateOrderDto بالحرف (نفس
// الأسئلة الديناميكية، نفس محرك التسعير، نفس التحقق) + هوية العميل المطلوب الإنشاء نيابة عنه.
// الطلب بيتملك للعميل ده دايمًا — الموظف مش بيصبح "العميل" بأي شكل.
export class CreateOrderForCustomerDto extends CreateOrderDto {
  @IsUUID()
  customer_user_id: string;
}
