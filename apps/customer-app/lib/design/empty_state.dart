import 'package:flutter/material.dart';

/// حالة فراغ موحّدة (docs/12) — نفس فلسفة apps/admin/src/components/empty-state.tsx، بديل
/// بصري متّسق عن نص "مفيش ..." الخام وسط الشاشة.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.description, this.icon = Icons.inbox_outlined, this.action});

  final String title;
  final String? description;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 40, color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5)),
          const SizedBox(height: 12),
          Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
          if (description != null) ...[
            const SizedBox(height: 4),
            Text(
              description!,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
          ],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}
