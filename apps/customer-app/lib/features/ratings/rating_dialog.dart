import 'package:flutter/material.dart';

class RatingResult {
  final int overallRating;
  final String? comment;

  RatingResult({required this.overallRating, required this.comment});
}

// Dialog بسيط لاختيار 1-5 نجوم + تعليق اختياري — بيرجّع RatingResult عبر Navigator.pop،
// الشاشة المستدعية هي اللي مسؤولة عن نداء RatingsRepository.rate() وعرض أي خطأ (409 لو
// اتقيّم قبل كده، مثلاً).
Future<RatingResult?> showRatingDialog(BuildContext context) {
  int selected = 5;
  final controller = TextEditingController();

  return showDialog<RatingResult>(
    context: context,
    builder: (context) => Directionality(
      textDirection: TextDirection.rtl,
      child: StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('قيّم الطلب'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (index) {
                  final starValue = index + 1;
                  return IconButton(
                    icon: Icon(
                      starValue <= selected ? Icons.star : Icons.star_border,
                      color: Colors.amber,
                    ),
                    onPressed: () => setState(() => selected = starValue),
                  );
                }),
              ),
              TextField(
                controller: controller,
                decoration: const InputDecoration(labelText: 'تعليق (اختياري)'),
                maxLines: 3,
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(
                RatingResult(overallRating: selected, comment: controller.text.trim()),
              ),
              child: const Text('إرسال'),
            ),
          ],
        ),
      ),
    ),
  );
}
