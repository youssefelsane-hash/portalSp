import 'package:flutter/material.dart';

/// تأكيد إجراء موحّد (docs/12) — بديل عن كل استخدام مباشر لـ showDialog يدوي متكرر لنفس الغرض.
/// بيرجّع true لو المستخدم أكّد، false/null لو ألغى.
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  String? message,
  String confirmLabel = 'تأكيد',
  String cancelLabel = 'إلغاء',
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: Text(title),
        content: message != null ? Text(message) : null,
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(cancelLabel)),
          FilledButton(
            style: destructive ? FilledButton.styleFrom(backgroundColor: Theme.of(dialogContext).colorScheme.error) : null,
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    ),
  );
  return result ?? false;
}
