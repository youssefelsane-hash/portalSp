import 'package:flutter/material.dart';
import '../../core/api_config.dart';
import '../orders/models.dart';

// file_url بيرجع نسبي (`/uploads/...`) وقت التخزين المحلي وقت التطوير، أو رابط S3 كامل جاهز
// في الإنتاج — نفس نمط `_resolveMediaUrl` في chat_screen.dart بالظبط.
String _resolveMediaUrl(String fileUrl) {
  if (fileUrl.startsWith('http')) return fileUrl;
  final origin = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
  return '$origin$fileUrl';
}

class RatingResult {
  final int overallRating;
  final int? punctualityRating;
  final int? qualityRating;
  final int? professionalismRating;
  final int? priceFairnessRating;
  final int? cleanlinessRating;
  final String? comment;
  final List<String> afterPhotoMediaIds;

  RatingResult({
    required this.overallRating,
    required this.punctualityRating,
    required this.qualityRating,
    required this.professionalismRating,
    required this.priceFairnessRating,
    required this.cleanlinessRating,
    required this.comment,
    required this.afterPhotoMediaIds,
  });
}

// تقييم متقدم + صور بعد الخدمة (docs/08 §9) — كانت فجوة موثّقة صراحة: الـDialog كان بيدعم
// overall_rating + comment بس، رغم إن الباك-إند بيدعم 5 أبعاد تقييم إضافية (اختيارية) وربط
// صور "بعد التنفيذ" الموجودة بالفعل (after_photo_media_ids). afterPhotos ممكن تيجي فاضية
// (طلب من غير صور مرفوعة) — القسم بيختفي وقتها بهدوء.
Future<RatingResult?> showRatingDialog(BuildContext context, {List<OrderMedia> afterPhotos = const []}) {
  int overall = 5;
  int? punctuality;
  int? quality;
  int? professionalism;
  int? priceFairness;
  int? cleanliness;
  final controller = TextEditingController();
  final selectedPhotoIds = <String>{};

  Widget starRow(
    String label,
    int? value,
    void Function(int?) onChanged,
    StateSetter setState,
  ) {
    return Row(
      children: [
        SizedBox(width: 110, child: Text(label, style: const TextStyle(fontSize: 13))),
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
          title: const Text('قيّم الطلب'),
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
                        icon: Icon(
                          starValue <= overall ? Icons.star : Icons.star_border,
                          color: Colors.amber,
                        ),
                        onPressed: () => setState(() => overall = starValue),
                      );
                    }),
                  ),
                  const SizedBox(height: 8),
                  const Text('تفاصيل إضافية (اختياري)', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  starRow('الالتزام بالمواعيد', punctuality, (v) => punctuality = v, setState),
                  starRow('جودة الشغل', quality, (v) => quality = v, setState),
                  starRow('الاحترافية', professionalism, (v) => professionalism = v, setState),
                  starRow('عدالة السعر', priceFairness, (v) => priceFairness = v, setState),
                  starRow('النظافة', cleanliness, (v) => cleanliness = v, setState),
                  const SizedBox(height: 8),
                  TextField(
                    controller: controller,
                    decoration: const InputDecoration(labelText: 'تعليق (اختياري)'),
                    maxLines: 3,
                  ),
                  if (afterPhotos.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    const Text('اختار صور تمثل الشغل النهائي (اختياري)', style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    SizedBox(
                      height: 90,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: afterPhotos.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (context, index) {
                          final photo = afterPhotos[index];
                          final selected = selectedPhotoIds.contains(photo.id);
                          return InkWell(
                            onTap: () => setState(() {
                              if (selected) {
                                selectedPhotoIds.remove(photo.id);
                              } else {
                                selectedPhotoIds.add(photo.id);
                              }
                            }),
                            child: Container(
                              width: 90,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: selected ? Theme.of(context).colorScheme.primary : Colors.transparent,
                                  width: 2,
                                ),
                                image: DecorationImage(
                                  image: NetworkImage(_resolveMediaUrl(photo.fileUrl)),
                                  fit: BoxFit.cover,
                                ),
                              ),
                              child: selected
                                  ? Align(
                                      alignment: Alignment.topLeft,
                                      child: Icon(Icons.check_circle, color: Theme.of(context).colorScheme.primary),
                                    )
                                  : null,
                            ),
                          );
                        },
                      ),
                    ),
                  ],
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
                  qualityRating: quality,
                  professionalismRating: professionalism,
                  priceFairnessRating: priceFairness,
                  cleanlinessRating: cleanliness,
                  comment: controller.text.trim(),
                  afterPhotoMediaIds: selectedPhotoIds.toList(),
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
