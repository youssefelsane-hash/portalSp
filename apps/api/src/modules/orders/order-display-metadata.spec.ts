// docs/08 §185 — بيانات العرض الإضافية: metadata لاختيارات العميل + تفاصيل الوصول في العنوان.
// الجزء المهم هنا مش إن الحقول بتطلع، الجزء المهم إن:
//   ١. «افتراضي؟» بيتحسب بنفس قاعدة المحرك بالظبط (مش نسخة موازية).
//   ٢. تفاصيل الشقة وتليفون المستلم بيتبعوا سياسة ظهور بيانات العميل للفني.
//   ٣. الطلب القديم (snapshot بلا metadata) والعنوان القديم (بلا عمارة/دور) مابيكسروش حاجة.
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Address } from '../customers/entities/address.entity';
import { PricingFieldType } from '../pricing/entities/service-pricing-field.entity';
import {
  isIntegerQuantityField,
  isPricingFieldDefaultValue,
  resolvePricingFieldDefault,
} from '../pricing/pricing-field-default';
import { toOrderAddressResponseDto, toOrderResponseDto } from './dto/order-response.dto';
import { Order, OrderCustomerInput, OrderStatus } from './entities/order.entity';
import { OrderCreationService } from './order-creation.service';
import { TECHNICIAN_CUSTOMER_CONTACT_VISIBLE_STATUSES } from './order-state-machine';

function field(fieldType: PricingFieldType, overrides: { defaultValue?: string | null; minValue?: string | null; maxValue?: string | null } = {}) {
  return { fieldType, defaultValue: null, minValue: null, maxValue: null, ...overrides };
}

describe('isPricingFieldDefaultValue — نفس قاعدة resolveDefaultValue في المحرك', () => {
  it.each([
    ['slider بلا default = الحد الأدنى', field(PricingFieldType.SLIDER, { minValue: '0.00' }), 0, true],
    ['slider بلا default ولا min = صفر', field(PricingFieldType.SLIDER), 0, true],
    ['slider اتغيّر عن الحد الأدنى', field(PricingFieldType.SLIDER, { minValue: '0.00' }), 2, false],
    ['slider default صريح', field(PricingFieldType.SLIDER, { defaultValue: '3' }), 3, true],
    ['slider قيمة نصية مساوية', field(PricingFieldType.SLIDER, { defaultValue: '3' }), '3', true],
    ['checkbox false ضمني', field(PricingFieldType.CHECKBOX), false, true],
    ['checkbox اتفعّل', field(PricingFieldType.CHECKBOX), true, false],
    ['dropdown default صريح (same_as_main)', field(PricingFieldType.DROPDOWN, { defaultValue: 'same_as_main' }), 'same_as_main', true],
    ['dropdown اختيار مختلف', field(PricingFieldType.DROPDOWN, { defaultValue: 'same_as_main' }), 'dry_clean', false],
    // الأهم: من غير default مُعدّ، الصفر في حقل رقم **مش** افتراضي — مفيش إخفاء أعمى للصفر.
    ['number صفر بلا default', field(PricingFieldType.NUMBER), 0, false],
    ['dropdown بلا default', field(PricingFieldType.DROPDOWN), 'wash_iron', false],
    ['multi_select default مطابق', field(PricingFieldType.MULTI_SELECT, { defaultValue: 'a,b' }), ['a', 'b'], true],
    ['نص فاضي مش صفر', field(PricingFieldType.SLIDER), '', false],
  ])('%s', (_name, rule, raw, expected) => {
    expect(isPricingFieldDefaultValue(rule, raw)).toBe(expected);
  });

  it('resolvePricingFieldDefault مابترميش على default غلط (المحرك هو اللي بيتحقق قبلها)', () => {
    expect(() => resolvePricingFieldDefault(field(PricingFieldType.SLIDER, { defaultValue: 'abc' }))).not.toThrow();
  });

  it.each([
    ['0 → 15', field(PricingFieldType.SLIDER, { minValue: '0.00', maxValue: '15.00' }), true],
    ['بلا حدود (0 → 100 زي التطبيق)', field(PricingFieldType.SLIDER), true],
    ['حدود عشرية = slider متصل', field(PricingFieldType.SLIDER, { minValue: '0.50', maxValue: '10.00' }), false],
    ['number مش عدّاد', field(PricingFieldType.NUMBER, { minValue: '0', maxValue: '15' }), false],
  ])('isIntegerQuantityField %s', (_name, rule, expected) => {
    expect(isIntegerQuantityField(rule)).toBe(expected);
  });
});

function address(overrides: Partial<Address> = {}): Address {
  return {
    streetName: 'شارع التعاونيات',
    landmark: 'جنب شركة الكهرباء',
    location: { type: 'Point', coordinates: [31.2, 30.05] },
    buildingNumber: '15',
    floorNumber: '3',
    apartmentNumber: '7',
    deliveryNotes: 'الجرس مش شغال، كلمني قبل ما تطلع',
    contactName: 'مدام سعاد',
    contactPhone: '+201011111111',
    ...overrides,
  } as Address;
}

describe('toOrderAddressResponseDto — تفاصيل الوصول بسياسة ظهور بيانات العميل', () => {
  it('العارض المسموح له بيشوف العمارة والدور والشقة والملاحظات والمستلم', () => {
    expect(toOrderAddressResponseDto(address(), true)).toEqual({
      street_name: 'شارع التعاونيات',
      landmark: 'جنب شركة الكهرباء',
      longitude: 31.2,
      latitude: 30.05,
      building_number: '15',
      floor_number: '3',
      apartment_number: '7',
      delivery_notes: 'الجرس مش شغال، كلمني قبل ما تطلع',
      contact_name: 'مدام سعاد',
      contact_phone: '+201011111111',
    });
  });

  it('برّه سياسة الظهور: الشارع والإحداثيات للملاحة بس، والباقي null', () => {
    const dto = toOrderAddressResponseDto(address(), false);
    expect(dto.street_name).toBe('شارع التعاونيات');
    expect(dto.latitude).toBe(30.05);
    expect(dto.longitude).toBe(31.2);
    for (const key of ['building_number', 'floor_number', 'apartment_number', 'delivery_notes', 'contact_name', 'contact_phone'] as const) {
      expect(dto[key]).toBeNull();
    }
  });

  it('عنوان قديم بلا تفاصيل (أو مسافات فاضية) ⇒ null مش نص فاضي', () => {
    const dto = toOrderAddressResponseDto(
      address({ buildingNumber: null, floorNumber: '  ', apartmentNumber: null, deliveryNotes: null, contactName: null, contactPhone: null }),
      true,
    );
    expect(dto.building_number).toBeNull();
    expect(dto.floor_number).toBeNull();
    expect(dto.delivery_notes).toBeNull();
    expect(dto.landmark).toBe('جنب شركة الكهرباء');
  });

  it('toOrderResponseDto: العميل/الأدمن (الافتراضي) بياخدوا التفاصيل، والفني حسب الحالة', () => {
    const order = { orderStatus: OrderStatus.CANCELLED_BY_CUSTOMER, customerInputs: null, createdAt: new Date() } as unknown as Order;
    const full = toOrderResponseDto(order, address());
    expect(full.address?.apartment_number).toBe('7');
    expect(TECHNICIAN_CUSTOMER_CONTACT_VISIBLE_STATUSES.has(OrderStatus.CANCELLED_BY_CUSTOMER)).toBe(false);
    const technician = toOrderResponseDto(order, address(), null, { preciseAddress: false });
    expect(technician.address?.apartment_number).toBeNull();
    expect(technician.address?.contact_phone).toBeNull();
  });

  it('snapshot قديم بلا metadata بيعدّي زي ما هو', () => {
    const legacy: OrderCustomerInput[] = [{ key: 'shirts', label: 'عدد القمصان', value: '1.9639846991701237', unit: 'قميص' }];
    const dto = toOrderResponseDto({ orderStatus: OrderStatus.ACCEPTED, customerInputs: legacy, createdAt: new Date() } as unknown as Order);
    expect(dto.customer_inputs).toEqual(legacy);
  });
});

describe('buildCustomerInputsSnapshot — قاعدة بيانات حقيقية', () => {
  let db: DataSource;
  let categoryId: string;
  let serviceId: string;
  const runId = `display-meta-${Date.now()}`;
  // الدالة private وبتستخدم `logger` + `parsePricingFieldImageIds` بس — بنناديها على نسخة من
  // الـprototype بدل ما نبني الـservice بكل اعتمادياتها (الاختبار عن الـsnapshot مش عن الإنشاء).
  const creation = Object.assign(Object.create(OrderCreationService.prototype), { logger: new Logger('test') }) as {
    buildCustomerInputsSnapshot(manager: unknown, serviceId: string, values: Record<string, unknown>): Promise<OrderCustomerInput[] | null>;
  };

  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak' });
    await db.initialize();
    const [category] = await db.query(
      'INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$1,$2) RETURNING id',
      ['Display metadata test', runId],
    );
    categoryId = category.id;
    const [service] = await db.query(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',0) RETURNING id`,
      [categoryId, 'Display metadata test', runId],
    );
    serviceId = service.id;
    const options = JSON.stringify([
      { value: 'same_as_main', label_ar: 'نفس الخدمة الأساسية' },
      { value: 'dry_clean_iron', label_ar: 'دراي كلين + كي' },
    ]);
    const mainOptions = JSON.stringify([
      { value: 'iron_only', label_ar: 'كي فقط' },
      { value: 'wash_iron', label_ar: 'غسيل + كي' },
    ]);
    await db.query(
      `INSERT INTO service_pricing_fields
         (service_id, field_key, label_ar, field_type, is_required, display_order, unit_ar, options, min_value, max_value, default_value)
       VALUES
         ($1,'main_type','نوع الخدمة الأساسي','dropdown',true,1,NULL,$2::jsonb,NULL,NULL,NULL),
         ($1,'shirts','عدد القمصان','slider',false,2,'قميص',NULL,0,15,NULL),
         ($1,'shirts_type','نوع الخدمة للقمصان','dropdown',false,3,NULL,$3::jsonb,NULL,NULL,'same_as_main'),
         ($1,'tshirts','عدد التيشيرتات','slider',false,4,NULL,NULL,0,15,NULL),
         ($1,'jackets_type','نوع الخدمة للجاكيتات','dropdown',false,5,NULL,$3::jsonb,NULL,NULL,'same_as_main'),
         ($1,'rooms','عدد الغرف','number',true,6,NULL,NULL,NULL,NULL,NULL),
         ($1,'express','تسليم مستعجل','checkbox',false,7,NULL,NULL,NULL,NULL,NULL)`,
      [serviceId, mainOptions, options],
    );
  });

  afterAll(async () => {
    if (!db?.isInitialized) return;
    await db.query('DELETE FROM service_pricing_fields WHERE service_id = $1', [serviceId]);
    await db.query('DELETE FROM services WHERE id = $1', [serviceId]);
    await db.query('DELETE FROM service_categories WHERE id = $1', [categoryId]);
    await db.destroy();
  });

  it('كل بند بياخد نوعه وإجباريته و«افتراضي؟» بترتيب display_order، والتسمية والقيمة زي زمان', async () => {
    const snapshot = await creation.buildCustomerInputsSnapshot(db.manager, serviceId, {
      express: false,
      rooms: 0,
      jackets_type: 'dry_clean_iron',
      tshirts: 0,
      shirts_type: 'same_as_main',
      shirts: 2,
      main_type: 'wash_iron',
      removed_field: 'x',
    });
    expect(snapshot).toEqual([
      { key: 'main_type', label: 'نوع الخدمة الأساسي', value: 'غسيل + كي', unit: null, field_type: 'dropdown', is_required: true, is_default: false, integer_quantity: false },
      { key: 'shirts', label: 'عدد القمصان', value: '2', unit: 'قميص', field_type: 'slider', is_required: false, is_default: false, integer_quantity: true },
      { key: 'shirts_type', label: 'نوع الخدمة للقمصان', value: 'نفس الخدمة الأساسية', unit: null, field_type: 'dropdown', is_required: false, is_default: true, integer_quantity: false },
      { key: 'tshirts', label: 'عدد التيشيرتات', value: '0', unit: null, field_type: 'slider', is_required: false, is_default: true, integer_quantity: true },
      { key: 'jackets_type', label: 'نوع الخدمة للجاكيتات', value: 'دراي كلين + كي', unit: null, field_type: 'dropdown', is_required: false, is_default: false, integer_quantity: false },
      // صفر في حقل رقم **إجباري** بلا default = معلومة حقيقية، مش ضوضاء.
      { key: 'rooms', label: 'عدد الغرف', value: '0', unit: null, field_type: 'number', is_required: true, is_default: false, integer_quantity: false },
      { key: 'express', label: 'تسليم مستعجل', value: 'لأ', unit: null, field_type: 'checkbox', is_required: false, is_default: true, integer_quantity: false },
      // حقل اتمسح من الخدمة: بيفضل ظاهر بمفتاحه، والـmetadata null (العرض مايخمّنش).
      { key: 'removed_field', label: 'removed_field', value: 'x', unit: null, field_type: null, is_required: null, is_default: null, integer_quantity: null },
    ]);
  });

  it('قيمة كسرية من نسخة تطبيق قديمة بتتخزّن زي ما هي (تاريخ)، والعلامة بتسمح للعرض ينضّفها', async () => {
    const [shirts] = (await creation.buildCustomerInputsSnapshot(db.manager, serviceId, { shirts: 1.9639846991701237 }))!;
    expect(shirts.value).toBe('1.9639846991701237');
    expect(shirts.integer_quantity).toBe(true);
    expect(shirts.is_default).toBe(false);
  });
});
