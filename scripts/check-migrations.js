#!/usr/bin/env node
/**
 * فحص سلامة ترقيم الـmigrations — يتشغّل في CI قبل أي حاجة تانية (docs/08 §132).
 *
 * **بَقّة حقيقية حصلت**: سيشنين متوازيين خدوا رقم `0257` لملفين مختلفين تمامًا. الاتنين
 * اتدمجوا، والنتيجة ملفين بنفس الرقم — ترتيب التطبيق على أي نشر نضيف بيبقى غير محدد.
 * اتكتشفت بالصدفة وقت حل تعارض دمج، مش بفحص. الفحص ده بيمسكها في CI فورًا.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'infra', 'migrations');
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

const byNumber = new Map();
const problems = [];

for (const f of files) {
  const num = f.slice(0, 4);
  if (byNumber.has(num)) problems.push(`رقم مكرر ${num}: ${byNumber.get(num)}  ⟷  ${f}`);
  else byNumber.set(num, f);
}

// الفجوة **مش** فشل: بتحصل شرعيًا لما ملف يتعاد ترقيمه وقت دمج (زي ما حصل مع 0258→0260).
// التكرار هو اللي غلط دايمًا. الفجوة بتتقال كملاحظة عشان لو ملف ضاع فعلاً حد ياخد باله.
const nums = [...byNumber.keys()].map(Number).sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < nums.length; i += 1) {
  if (nums[i] - nums[i - 1] > 1) gaps.push(`${String(nums[i - 1]).padStart(4, '0')}→${String(nums[i]).padStart(4, '0')}`);
}

if (problems.length) {
  console.error('❌ مشاكل في ترقيم الـmigrations:\n' + problems.map((p) => '   ' + p).join('\n'));
  process.exit(1);
}
console.log(`✅ ${files.length} migration، مفيش أي رقم مكرر (آخر رقم: ${files[files.length - 1].slice(0, 4)})`);
if (gaps.length) console.log(`   ℹ️  فجوات ترقيم (طبيعية بعد إعادة ترقيم في دمج): ${gaps.join(', ')}`);
