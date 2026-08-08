// class decorators (زي @Processor) بتتنفّذ وقت الـ import، قبل ما ConfigModule يشتغل ويوفّر
// ConfigService — فمينفعش تحقن ConfigService جوّه decorator. الدالة دي بتقرأ process.env مباشرة
// (نفس fallback اللي في configuration.ts) عشان الـ Workers تقدر تبني connection options بتاعتها
// بدون ما تستنى الـ DI container.
export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}
