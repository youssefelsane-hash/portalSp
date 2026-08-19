import 'package:flutter/material.dart';

// Script 6 Part 7 — "missing images get fallback avatars, never broken 404s". CircleAvatar's
// backgroundImage لوحده بيعرض أيقونة خطأ افتراضية لو الرابط اتعمله 404 (مش بس لو null) —
// الـwidget ده بيستخدم Image.network مع errorBuilder صريح عشان أي فشل تحميل (رابط ميت، مهلة
// شبكة، صورة تالفة) يرجع لنفس أيقونة "شخص" الافتراضية بدل أيقونة كسر الصورة.
class FallbackAvatar extends StatelessWidget {
  final String? imageUrl;
  final double radius;
  final IconData fallbackIcon;

  const FallbackAvatar({super.key, required this.imageUrl, this.radius = 24, this.fallbackIcon = Icons.person});

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    if (url == null || url.isEmpty) {
      return CircleAvatar(radius: radius, child: Icon(fallbackIcon, size: radius));
    }
    return ClipOval(
      child: Image.network(
        url,
        width: radius * 2,
        height: radius * 2,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => CircleAvatar(radius: radius, child: Icon(fallbackIcon, size: radius)),
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return CircleAvatar(radius: radius, child: const SizedBox.shrink());
        },
      ),
    );
  }
}
