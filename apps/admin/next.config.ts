import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // إخفاء "X-Powered-By: Next.js" — تسريب نوع الستاك بلا فايدة، جزء من جولة التحصين الأمني
  // قبل الإطلاق (راجع apps/api/README.md § الأمان لباقي التفاصيل عبر الباك-إند).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
