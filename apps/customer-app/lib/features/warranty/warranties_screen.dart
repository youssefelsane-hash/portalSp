import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';

class WarrantyRepository {
  final AuthRepository auth;
  WarrantyRepository(this.auth);

  Future<List<Map<String, dynamic>>> list() async =>
      (await auth.authedRequestList(
        '/me/warranties',
      )).cast<Map<String, dynamic>>();

  Future<void> openClaim(String warrantyId, String description) async {
    await auth.authedRequest(
      'POST',
      '/me/warranties/$warrantyId/claims',
      body: {'defect_description': description},
    );
  }
}

String? validateWarrantyClaimDescription(String value) {
  final length = value.trim().length;
  if (length == 0) return 'اكتب وصف العيب الأول';
  if (length < 10) return 'كمّل الوصف شوية — لازم 10 حروف على الأقل';
  return null;
}

class WarrantiesScreen extends StatefulWidget {
  const WarrantiesScreen({super.key});
  @override
  State<WarrantiesScreen> createState() => _WarrantiesScreenState();
}

class _WarrantiesScreenState extends State<WarrantiesScreen> {
  List<Map<String, dynamic>>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final items = await WarrantyRepository(
        context.read<AuthRepository>(),
      ).list().timeout(const Duration(seconds: 10));
      if (mounted) setState(() => _items = items);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر تحميل الضمانات');
    }
  }

  Future<void> _openClaim(Map<String, dynamic> warranty) async {
    final controller = TextEditingController();
    String? validationError;
    final description = await showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('فتح مطالبة ضمان'),
          content: TextField(
            controller: controller,
            minLines: 3,
            maxLines: 6,
            maxLength: 1000,
            onChanged: (_) {
              if (validationError != null) {
                setDialogState(() => validationError = null);
              }
            },
            decoration: InputDecoration(
              labelText: 'اشرح العيب بالتفصيل',
              hintText: 'مثال: الشرخ ظهر تاني في نفس مكان الإصلاح',
              errorText: validationError,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                final value = controller.text.trim();
                final error = validateWarrantyClaimDescription(value);
                if (error != null) {
                  setDialogState(() => validationError = error);
                  return;
                }
                Navigator.pop(context, value);
              },
              child: const Text('إرسال'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (description == null || !mounted) return;
    try {
      await WarrantyRepository(
        context.read<AuthRepository>(),
      ).openClaim(warranty['id'] as String, description);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم فتح المطالبة ومراجعتها بدأت')),
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('ضماناتي')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? ListView(
                  children: [
                    const SizedBox(height: 120),
                    Center(child: Text(_error!)),
                  ],
                )
              : _items == null
              ? const Center(child: CircularProgressIndicator())
              : _items!.isEmpty
              ? ListView(
                  children: const [
                    SizedBox(height: 120),
                    Center(
                      child: Text('لا توجد ضمانات مرتبطة بطلباتك حتى الآن'),
                    ),
                  ],
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _items!.length,
                  itemBuilder: (context, index) {
                    final warranty = _items![index];
                    final expiresAt = DateTime.parse(
                      warranty['expires_at'] as String,
                    ).toLocal();
                    final active = expiresAt.isAfter(DateTime.now());
                    final activeClaimId = warranty['active_claim_id'];
                    final sourcePrefix = warranty['order_number'] != null
                        ? 'طلب ${warranty['order_number']} · '
                        : warranty['project_number'] != null
                        ? 'مشروع ${warranty['project_number']} · '
                        : '';
                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              warranty['name_ar']?.toString() ?? 'ضمان تنفيذ',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '$sourcePrefix${active ? 'ساري' : 'منتهي'} '
                              'حتى ${expiresAt.toString().substring(0, 10)}',
                            ),
                            Text(
                              'المطالبات: ${warranty['claims_used']}/${warranty['max_claims']}',
                            ),
                            if (activeClaimId != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Text(
                                  'مطالبة نشطة: ${warranty['claim_status']}',
                                ),
                              )
                            else if (active &&
                                (warranty['claims_used'] as num) <
                                    (warranty['max_claims'] as num))
                              Padding(
                                padding: const EdgeInsets.only(top: 10),
                                child: FilledButton.tonal(
                                  onPressed: () => _openClaim(warranty),
                                  child: const Text('فتح مطالبة'),
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
