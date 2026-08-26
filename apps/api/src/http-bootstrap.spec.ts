import { configureHttpLayer, HttpLayerTarget } from './http-bootstrap';

// بيسجّل ترتيب النداءات بس — الهدف مش تغطية الـmiddleware نفسها (helmet/cors مكتبات مُختبَرة
// عندها)، الهدف قفل **الترتيب** اللي كان مكسور فعلاً وكسّر صور /uploads على الويب (docs/08 §59).
function recordingApp(): { app: HttpLayerTarget; calls: string[] } {
  const calls: string[] = [];
  const app: HttpLayerTarget = {
    use: () => calls.push('use') as unknown,
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

    configureHttpLayer(app, { uploadsDir: '/tmp/uploads', apiPrefix: 'api/v1', corsOrigins: ['http://localhost:3001'] });

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
      setGlobalPrefix: () => undefined,
      enableCors: () => undefined,
      useStaticAssets: (path, options) => calls.push({ path, options }),
      useGlobalPipes: () => undefined,
    };

    configureHttpLayer(app, { uploadsDir: '/srv/baytak/uploads', apiPrefix: 'api/v1', corsOrigins: [] });

    expect(calls).toEqual([{ path: '/srv/baytak/uploads', options: { prefix: '/uploads/' } }]);
  });

  it('بيفتح CORS للكل لما CORS_ORIGIN فاضي، وبيقيّده على القايمة لما تتحدد', () => {
    const seen: unknown[] = [];
    const make = (): HttpLayerTarget => ({
      use: () => undefined,
      setGlobalPrefix: () => undefined,
      enableCors: (options) => seen.push(options),
      useStaticAssets: () => undefined,
      useGlobalPipes: () => undefined,
    });

    configureHttpLayer(make(), { uploadsDir: '/tmp/u', apiPrefix: 'api/v1', corsOrigins: [] });
    configureHttpLayer(make(), { uploadsDir: '/tmp/u', apiPrefix: 'api/v1', corsOrigins: ['https://admin.baytak.app'] });

    expect(seen).toEqual([{ origin: '*' }, { origin: ['https://admin.baytak.app'] }]);
  });
});
