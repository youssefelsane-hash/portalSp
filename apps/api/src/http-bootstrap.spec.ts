import { configureHttpLayer, HttpLayerTarget, stripBidiControls, validationErrorsToArabic } from './http-bootstrap';

// بيسجّل ترتيب النداءات بس — الهدف مش تغطية الـmiddleware نفسها (helmet/cors مكتبات مُختبَرة
// عندها)، الهدف قفل **الترتيب** اللي كان مكسور فعلاً وكسّر صور /uploads على الويب (docs/08 §59).
function recordingApp(): { app: HttpLayerTarget; calls: string[] } {
  const calls: string[] = [];
  const app: HttpLayerTarget = {
    use: () => calls.push('use') as unknown,
    set: () => calls.push('set') as unknown,
    setGlobalPrefix: () => calls.push('setGlobalPrefix') as unknown,
    enableCors: () => calls.push('enableCors') as unknown,
    useStaticAssets: () => calls.push('useStaticAssets') as unknown,
    useGlobalPipes: () => calls.push('useGlobalPipes') as unknown,
  };
  return { app, calls };
}

describe('configureHttpLayer — ترتيب middleware', () => {
  it('بيسجّل helmet وenableCors قبل useStaticAssets (وإلا ردود /uploads تخرج بلا CORS/CORP)', () => {
    const { app, calls } = recordingApp();

    configureHttpLayer(app, { uploadsDir: '/tmp/uploads', apiPrefix: 'api/v1', corsOrigins: ['http://localhost:3001'], trustedProxyHops: 1 });

    const helmetIndex = calls.indexOf('use');
    const corsIndex = calls.indexOf('enableCors');
    const staticIndex = calls.indexOf('useStaticAssets');

    expect(helmetIndex).toBeGreaterThanOrEqual(0);
    expect(corsIndex).toBeGreaterThan(helmetIndex);
    expect(staticIndex).toBeGreaterThan(corsIndex);
  });

  it('بيمرّر مجلد الرفع تحت البادئة /uploads/ وبره globalPrefix', () => {
    const calls: Array<{ path: string; options?: { prefix?: string } }> = [];
    const app: HttpLayerTarget = {
      use: () => undefined,
      set: () => undefined,
      setGlobalPrefix: () => undefined,
      enableCors: () => undefined,
      useStaticAssets: (path, options) => calls.push({ path, options }),
      useGlobalPipes: () => undefined,
    };

    configureHttpLayer(app, { uploadsDir: '/srv/baytak/uploads', apiPrefix: 'api/v1', corsOrigins: [], trustedProxyHops: 1 });

    expect(calls).toEqual([{ path: '/srv/baytak/uploads', options: { prefix: '/uploads/' } }]);
  });

  it('بيفتح CORS للكل لما CORS_ORIGIN فاضي، وبيقيّده على القايمة لما تتحدد', () => {
    const seen: unknown[] = [];
    const make = (): HttpLayerTarget => ({
      use: () => undefined,
      set: () => undefined,
      setGlobalPrefix: () => undefined,
      enableCors: (options) => seen.push(options),
      useStaticAssets: () => undefined,
      useGlobalPipes: () => undefined,
    });

    configureHttpLayer(make(), { uploadsDir: '/tmp/u', apiPrefix: 'api/v1', corsOrigins: [], trustedProxyHops: 1 });
    configureHttpLayer(make(), { uploadsDir: '/tmp/u', apiPrefix: 'api/v1', corsOrigins: ['https://admin.ostahome.com'], trustedProxyHops: 1 });

    expect(seen).toEqual([{ origin: '*' }, { origin: ['https://admin.ostahome.com'] }]);
  });
});

/**
 * تدقيق `docs/29` P0-2 — «كل عملاء المنصة في دلو throttle واحد».
 *
 * من غير `trust proxy`، Express بيرجّع في `req.ip` عنوان الـload balancer، فـ`@nestjs/throttler`
 * بيعدّ المنصة كلها كشخص واحد: ٦٠ طلب/دقيقة للكل، و٥ عمليات تسجيل دخول للكل. الاختبار ده بيقفل
 * على إن الإعداد **بيتضبط فعلًا**، وإنه **رقم مش `true`** (ده كان هيسمح بانتحال X-Forwarded-For).
 */
describe('configureHttpLayer — الثقة في الـproxy', () => {
  const makeRecorder = () => {
    const settings: Array<[string, unknown]> = [];
    const order: string[] = [];
    const app: HttpLayerTarget = {
      use: () => order.push('use'),
      set: (key, value) => {
        settings.push([key, value]);
        order.push('set');
        return undefined;
      },
      setGlobalPrefix: () => order.push('setGlobalPrefix'),
      enableCors: () => order.push('enableCors'),
      useStaticAssets: () => order.push('useStaticAssets'),
      useGlobalPipes: () => order.push('useGlobalPipes'),
    };
    return { app, settings, order };
  };

  it('بيضبط trust proxy بعدد القفزات الجاي من الإعدادات', () => {
    const { app, settings } = makeRecorder();
    configureHttpLayer(app, { uploadsDir: '/tmp/u', apiPrefix: 'api/v1', corsOrigins: [], trustedProxyHops: 2 });
    expect(settings).toContainEqual(['trust proxy', 2]);
  });

  it('القيمة رقم مش `true` — `true` بتسمح لأي حد يزوّر X-Forwarded-For وياخد هوية شبكية تانية', () => {
    const { app, settings } = makeRecorder();
    configureHttpLayer(app, { uploadsDir: '/tmp/u', apiPrefix: 'api/v1', corsOrigins: [], trustedProxyHops: 1 });
    const trust = settings.find(([key]) => key === 'trust proxy');
    expect(typeof trust?.[1]).toBe('number');
    expect(trust?.[1]).not.toBe(true);
  });

  it('بيتضبط **قبل** أي middleware بيقرا req.ip', () => {
    const { app, order } = makeRecorder();
    configureHttpLayer(app, { uploadsDir: '/tmp/u', apiPrefix: 'api/v1', corsOrigins: [], trustedProxyHops: 1 });
    expect(order.indexOf('set')).toBeLessThan(order.indexOf('use'));
  });
});

/**
 * الثابت اللي الاختبارات دي بتحرسه: **مايتسربش أي شيء من class-validator نفسه** — لا اسم قيد
 * (`isUuid`) ولا نصه الإنجليزي. اسم الحقل نفسه مش من دول: ده حقل في جسم الطلب، العميل هو اللي
 * بعته، وموثّق في `docs/02-data-dictionary.md`.
 *
 * الاختبارات دي كانت بتتوقع كلمة «الحقل» المبهمة لكل حالة. اتغيّرت عمدًا بعد بلاغ المالك
 * 2026-09-13 (§140/§141): رسالة زي «الحقل يحتوي اختيارًا غير مسموح» بتسدّ الباب تمامًا —
 * لا العميل ولا الدعم ولا المطوّر يعرف منها الحقل. النسخة الجديدة بتسمّي الحقل: بالعربي لو له
 * ترجمة، وباسمه الخام بين «» لو مالوش.
 */
describe('validationErrorsToArabic', () => {
  const constraintCases: [string, string][] = [
    ['isUuid', 'غير صحيح أو الرابط قديم'],
    ['maxLength', 'أطول من الحد المسموح'],
    ['isEnum', 'يحتوي اختيارًا غير مسموح'],
    ['isDateString', 'لازم يكون تاريخًا صحيحًا'],
    ['isPositive', 'لازم يكون رقمًا أكبر من صفر'],
    ['whitelistValidation', 'غير مسموح'],
    ['isLength', 'لازم يكون في الحدود المسموحة'],
  ];

  it.each(constraintCases)('بيترجم %s من غير ما يسرّب أي شيء من الـvalidator', (constraint, tail) => {
    const message = validationErrorsToArabic([
      { property: 'internal_field', constraints: { [constraint]: 'English framework text' } },
    ]);
    expect(message).toContain(tail);
    expect(message).not.toContain(constraint);
    expect(message).not.toContain('English framework text');
    expect(message).not.toBe('البيانات المرسلة غير صحيحة');
  });

  it('الحقل اللي له ترجمة عربية بيظهر بيها', () => {
    expect(validationErrorsToArabic([{ property: 'description', constraints: { isLength: 'x' } }])).toContain('سبب البند');
  });

  it('والحقل اللي مالوش ترجمة بيظهر باسمه الخام — عشان الرسالة تفضل قابلة للتشخيص', () => {
    expect(validationErrorsToArabic([{ property: 'selection_mode', constraints: { isIn: 'x' } }])).toContain(
      '«selection_mode»',
    );
  });
});

describe('stripBidiControls', () => {
  it('removes display-control characters from nested request input without changing Arabic content', () => {
    const payload = {
      problem_description: '🔧‮مشكلة‬',
      answers: [{ value: 'A⁦B⁩' }],
    };

    expect(stripBidiControls(payload)).toEqual({
      problem_description: '🔧مشكلة',
      answers: [{ value: 'AB' }],
    });
  });
});
