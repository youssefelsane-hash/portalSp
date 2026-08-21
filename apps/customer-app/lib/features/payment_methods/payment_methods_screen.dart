import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/confirm_dialog.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'payment_methods_repository.dart';

const Map<String, String> _providerLabelsAr = {
  'paymob': 'Paymob',
};

// وسائل الدفع المحفوظة (docs/08 §21) — كانت فجوة موثّقة صراحة، راجع تعليق
// payment_methods_repository.dart. صفر "إضافة كارت" هنا عمدًا (نفس قرار الباك-إند) — الحفظ
// تلقائي وقت أول دفع بكارت حقيقي، مش إدخال بيانات كارت مباشر عندنا.
class PaymentMethodsScreen extends StatefulWidget {
  const PaymentMethodsScreen({super.key});

  @override
  State<PaymentMethodsScreen> createState() => _PaymentMethodsScreenState();
}

class _PaymentMethodsScreenState extends State<PaymentMethodsScreen> {
  late final PaymentMethodsRepository _repository;
  List<SavedPaymentMethod>? _methods;
  String? _error;
  final Set<String> _acting = {};

  @override
  void initState() {
    super.initState();
    _repository = PaymentMethodsRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final methods = await _repository.list();
      if (mounted) setState(() => _methods = methods);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _setDefault(SavedPaymentMethod method) async {
    setState(() => _acting.add(method.id));
    try {
      await _repository.setDefault(method.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _acting.remove(method.id));
    }
  }

  Future<void> _revoke(SavedPaymentMethod method) async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'حذف وسيلة الدفع',
      message: 'هتتحذف نهائيًا — هتحتاج تدخل بيانات الكارت تاني في أول دفع جاي.',
      confirmLabel: 'حذف',
      destructive: true,
    );
    if (!confirmed) return;
    setState(() => _acting.add(method.id));
    try {
      await _repository.revoke(method.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _acting.remove(method.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final methods = _methods;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('وسائل الدفع المحفوظة')),
        body: methods == null
            ? (_error != null
                ? Center(child: Text(_error!))
                : const Padding(padding: EdgeInsets.all(16), child: LoadingList()))
            : methods.isEmpty
                ? ListView(
                    children: const [
                      SizedBox(height: 80),
                      EmptyState(
                        icon: Icons.credit_card_outlined,
                        title: 'مفيش وسائل دفع محفوظة لسه',
                        description: 'بتتحفظ تلقائيًا أول ما تدفع بكارت في طلب — مفيش داعي تدخل بياناتها هنا.',
                      ),
                    ],
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      children: [
                        for (final method in methods)
                          ListTile(
                            leading: Icon(method.isDefault ? Icons.star : Icons.credit_card, color: method.isDefault ? Colors.amber : null),
                            title: Text('${_providerLabelsAr[method.provider] ?? method.provider} — ${method.cardBrand ?? 'كارت'}'),
                            subtitle: Text(method.maskedPan ?? ''),
                            trailing: _acting.contains(method.id)
                                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                : PopupMenuButton<String>(
                                    onSelected: (value) {
                                      if (value == 'default') {
                                        _setDefault(method);
                                      } else if (value == 'revoke') {
                                        _revoke(method);
                                      }
                                    },
                                    itemBuilder: (context) => [
                                      if (!method.isDefault) const PopupMenuItem(value: 'default', child: Text('اجعلها افتراضية')),
                                      const PopupMenuItem(value: 'revoke', child: Text('حذف')),
                                    ],
                                  ),
                          ),
                      ],
                    ),
                  ),
      ),
    );
  }
}
