import 'package:flutter/material.dart';

class RatingResult {
  final int overallRating;
  final int? punctualityRating;
  final int? professionalismRating;
  final String? comment;

  RatingResult({required this.overallRating, required this.punctualityRating, required this.professionalismRating, required this.comment});
}

// تقييم الفني للعميل (technician_to_customer) — نفس فلسفة customer-app's rating_dialog.dart،
// بس بأبعاد تناسب تقييم عميل بدل فني: التزامه بميعاد الزيارة وتعامله، مش جودة شغل/نظافة/عدالة
// سعر (دي أبعاد بتوصف شغل الفني، مالهاش معنى في اتجاه معكوس). مفيش صور ولا Google review prompt
// هنا عمدًا — الاتنين خاصين بـcustomer_to_technician بس (راجع ratings.service.ts's
// getGoogleReviewPrompt()).
Future<RatingResult?> showTechnicianRatingDialog(BuildContext context) {
  int overall = 5;
  int? punctuality;
  int? professionalism;
  final controller = TextEditingController();

  Widget starRow(String label, int? value, void Function(int?) onChanged, StateSetter setState) {
    return Row(
      children: [
        SizedBox(width: 130, child: Text(label, style: const TextStyle(fontSize: 13))),
        ...List.generate(5, (index) {
          final starValue = index + 1;
          return InkWell(
            onTap: () => setState(() => onChanged(value == starValue ? null : starValue)),
            child: Icon(
              value != null && starValue <= value ? Icons.star : Icons.star_border,
              size: 20,
              color: Colors.amber,
            ),
          );
        }),
      ],
    );
  }

  return showDialog<RatingResult>(
    context: context,
    builder: (context) => Directionality(
      textDirection: TextDirection.rtl,
      child: StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('قيّم العميل'),
          content: SizedBox(
            width: 360,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('التقييم العام', style: TextStyle(fontWeight: FontWeight.bold)),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (index) {
                      final starValue = index + 1;
                      return IconButton(
                        icon: Icon(starValue <= overall ? Icons.star : Icons.star_border, color: Colors.amber),
                        onPressed: () => setState(() => overall = starValue),
                      );
                    }),
                  ),
                  const SizedBox(height: 8),
                  const Text('تفاصيل إضافية (اختياري)', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  starRow('التزم بميعاد الزيارة', punctuality, (v) => punctuality = v, setState),
                  starRow('تعامل محترم وواضح', professionalism, (v) => professionalism = v, setState),
                  const SizedBox(height: 8),
                  TextField(
                    controller: controller,
                    decoration: const InputDecoration(labelText: 'تعليق (اختياري)'),
                    maxLines: 3,
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(
                RatingResult(
                  overallRating: overall,
                  punctualityRating: punctuality,
                  professionalismRating: professionalism,
                  comment: controller.text.trim(),
                ),
              ),
              child: const Text('إرسال'),
            ),
          ],
        ),
      ),
    ),
  );
}
