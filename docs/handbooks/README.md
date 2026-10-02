# أدلة مطبوعة — دليل الصنايعي (ورقتين A4)

ورقتين للصنايعي الجديد (تتبعت واتساب كصورة أو تتطبع): بيشرحوا الترقية والفلوس والحقوق والواجبات
**بالأرقام الحقيقية الشغّالة في السيستم** — مش وعود تسويقية.

| الملف | المحتوى |
|---|---|
| `technician-guide-1-career.*` | سلّم المستويات الخمسة، الترقية بتزوّد الدخل إزاي، ترتيب استلام الطلب، فتح شركة |
| `technician-guide-2-money-rights.*` | حساب نصيب الشغلانة، مكافأة آخر الشهر (KPI)، أهمية تقييم العميل، الحقوق والواجبات |

- `.png` للواتساب، و`.pdf` للطباعة (صفحة A4 واحدة لكل ورقة)، و`.html` هو المصدر.
- الـHTML مكتفي بنفسه (خط Tajawal واللوجو مدمجين)، فبيفتح من غير نت، وبيتظبط على شاشة الموبايل.
- **لو عدّلت الـHTML** طلّع الـPDF/PNG تاني بـChromium (Playwright): A4، `printBackground`، هوامش صفر،
  وتأكد إن المحتوى لسه صفحة واحدة.

## ⚠️ الأرقام دي مربوطة بإعدادات حيّة — لو اتغيّرت، الورقة لازم تتحدّث

| الرقم في الورقة | مصدره |
|---|---|
| شروط الترقية (طلبات، عمولة، تقييم، إلغاء، شكاوى، أيام) | `technician_progression_rules` (migration 0084) — الأدمن بيعدّلها |
| حد الشغلانة، الأولوية، نصيب الفريق، دخول الفرق، قيادة فريق | `technician_level_config` (migrations 0028/0227) |
| فتح شركة من «بريميوم» | `technician-companies.service.ts` (`can_lead_team`) |
| عمولة ١٥٪ في المثال، والكوبون على حساب الشركة | `services.commission_percentage` الافتراضي + `earnings-policy.service.ts` (V2) + ADR-0038 |
| الضمان/الطوارئ/الزحمة برّه نصيب الصنايعي | `commission-base.ts` |
| أوزان المكافأة، حد ٥٠٠٠ ج، ٣ طلبات، −٢٠ للشكوى | `kpi.*` في `apps/api/src/modules/settings/settings-registry.ts` (مثلاً `kpi.monthly_max_bonus_cents`) |
| ترتيب الطلب (المستوى، التقييم بعد ٣، المواعيد بعد ٣ و١٥ دقيقة، الشغل المفتوح، القرب) | `matching.*` (`punctuality_weight`، `min_punctuality_sample`، `workload_balance_weight`) + docs/08 §189 D-2 |
| السحب (٢٠٠ ج حد أدنى، ١٠٠٠ ج من غير مراجعة) | `payouts.min_amount_cents`، `payouts.auto_approve_limit_cents` |
| الإلغاء خلال ١٠ دقايق ومش في آخر ساعة | `cancellation.window_minutes_after_acceptance`، `cancellation.min_minutes_before_scheduled_start` |
| الترشيح ٥٠ ج على أول طلب مكتمل | `referral_qr.bonus_amount_cents`، `referral_qr.reward_mode` |
| الرد على إعادة الزيارة خلال ٤٨ ساعة | `revisit.original_technician_response_hours` |
| الكورس الإلزامي وإعادة التدريب عند احترافية ≤ ٢ | ADR-0117 |

عمدًا **مش** مذكور: `commission_adjustment_percentage` في مستويات الفنيين — بيتطبّق في مسار التسوية القديم (V1) بس،
فمش هنوعد الصنايعي بعمولة أقل مع الترقية.
