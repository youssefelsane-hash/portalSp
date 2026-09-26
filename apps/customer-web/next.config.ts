import type { NextConfig } from "next";

/**
 * **تحصين الواجهة العامة** (طلب مالك 2026-09-25: «تأكد إن الفرونت ملتزم باللي الباك-إند
 * بيعمله»).
 *
 * الملف ده كان **فاضي بالكامل** بينما `apps/admin/next.config.ts` عنده الهيدرز من زمان — يعني
 * التطبيق المكشوف للإنترنت هو اللي كان بلا حماية، واللوحة الداخلية هي المحميّة. عكس الترتيب
 * الصح بالظبط.
 */

/** أصل الـAPI (بلا مسار) — `connect-src` لازم يسمح بيه هو والـwebsocket بتاعه أو الموقع بيقف. */
function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1").origin;
  } catch {
    return "http://localhost:3000";
  }
}

const API_ORIGIN = apiOrigin();
const WS_ORIGIN = API_ORIGIN.replace(/^http/, "ws");

/**
 * ### سياسة المحتوى (CSP)
 *
 * **`script-src` فيها `'unsafe-inline'` وده قيد معروف مش سهو**: App Router بيحقن سكربت داخلي
 * لبيانات الـhydration في كل صفحة، والبديل (nonce لكل طلب) بيحتاج proxy بيولّد nonce ويمرره —
 * وده بيخلّي **كل** صفحة عامة ديناميكية، يعني يلغي الـstatic rendering اللي صفحات SEO قايمة
 * عليه. المكسب الأمني الباقي لسه حقيقي: حقن `<script src="https://attacker">` بيتمنع، وده أخطر
 * شكل لـXSS المخزّن.
 *
 * **`img-src` واسعة عن قصد**: صور الكتالوج والبراندنج روابط بيحطها الأدمن (S3، CDN، دومين
 * العميل) — تضييقها لقائمة ثابتة معناه صور مكسورة أول ما الأدمن يغيّر المزوّد، من غير أي مكسب
 * أمني (صورة مش كود).
 *
 * `frame-ancestors 'none'` هي الحماية الحقيقية من clickjacking (و`X-Frame-Options` تحتها
 * للمتصفحات القديمة)، و`form-action 'self'` بتمنع نموذج محقون من إرسال بيانات لبره.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} ${WS_ORIGIN}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // تسريب نوع الستاك بلا أي فايدة — نفس قرار الأدمن.
  poweredByHeader: false,
  images: {
    // Public URLs are stable cache keys. R2 presigned URLs rotate and stay direct.
    remotePatterns: [
      { protocol: "https", hostname: "i.ibb.co" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // **مش `no-referrer` زي الأدمن**: الموقع ده عام، والـreferrer هو اللي بيخلّي إسناد
          // الحملات (docs/08، CAC لكل قناة) يشتغل أصلاً. `strict-origin-when-cross-origin`
          // بيبعت الأصل بس لبره — فمفيش تسريب لمسار فيه معرّف طلب، والإسناد بيفضل شغّال.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // الموقع مابيطلبش أي واحدة منهم غير الموقع الجغرافي (اختيار العنوان) — والباقي
          // مقفول عشان أي سكربت طرف تالت مايقدرش يطلبها.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
