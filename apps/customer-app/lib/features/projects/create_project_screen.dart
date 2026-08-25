import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_repository.dart';
import '../addresses/models.dart';
import 'my_projects_screen.dart';

class CreateProjectScreen extends StatefulWidget {
  final AuthRepository auth;
  const CreateProjectScreen({super.key, required this.auth});

  @override
  State<CreateProjectScreen> createState() => _CreateProjectScreenState();
}

class _CreateProjectScreenState extends State<CreateProjectScreen> {
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  String _selectedType = 'finishing';
  Address? _selectedAddress;
  int? _budget;
  bool _submitting = false;
  String? _error;
  List<Address>? _addresses;

  static const _typeLabels = {
    'finishing': 'تشطيب شقة',
    'renovation': 'تجديد',
    'move_in': 'تجهيز شقة جديدة',
    'multi_service': 'مشروع متعدد الخدمات',
    'other': 'أخرى',
  };

  @override
  void initState() {
    super.initState();
    _loadAddresses();
  }

  Future<void> _loadAddresses() async {
    try {
      final repo = AddressesRepository(widget.auth);
      final list = await repo.list();
      if (mounted) setState(() => _addresses = list);
    } on ApiException {
      /* ignore */
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('ابدأ مشروعك مع صُنّاع')),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'ما الذي تريد تنفيذه؟',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _typeLabels.entries
                    .map(
                      (e) => ChoiceChip(
                        label: Text(e.value),
                        selected: _selectedType == e.key,
                        onSelected: (_) =>
                            setState(() => _selectedType = e.key),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'اسم المشروع',
                  hintText: 'مثلاً: تشطيب شقة التجمع',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _descriptionController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'وصف بسيط (اختياري)',
                  hintText: 'احكي لنا اللي محتاجه…',
                ),
              ),
              const SizedBox(height: 16),
              Text('العنوان', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              if (_addresses != null && _addresses!.isNotEmpty)
                DropdownButtonFormField<String>(
                  initialValue: _selectedAddress?.id,
                  items: _addresses!
                      .map(
                        (a) => DropdownMenuItem(
                          value: a.id,
                          child: Text(a.label ?? a.streetName),
                        ),
                      )
                      .toList(),
                  onChanged: (v) => setState(
                    () => _selectedAddress = _addresses!.firstWhere(
                      (a) => a.id == v,
                    ),
                  ),
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'اختار العنوان',
                  ),
                )
              else
                const Text(
                  'محتاج تضيف عنوان الأول من صفحة الحساب',
                  style: TextStyle(color: Colors.red),
                ),
              const SizedBox(height: 12),
              TextField(
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'الميزانية التقريبية بالجنيه (اختياري)',
                ),
                onChanged: (v) {
                  final n = int.tryParse(v);
                  setState(() => _budget = n);
                },
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _submitting || _selectedAddress == null
                      ? null
                      : _submit,
                  child: _submitting
                      ? const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                            SizedBox(width: 8),
                            Text('جاري الإنشاء…'),
                          ],
                        )
                      : const Text('ابدأ المشروع — اطلب معاينة'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (_nameController.text.trim().isEmpty || _selectedAddress == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final repo = ProjectsRepo(widget.auth);
      await repo
          .create(
            projectType: _selectedType,
            nameAr: _nameController.text.trim(),
            description: _descriptionController.text.trim().isEmpty
                ? null
                : _descriptionController.text.trim(),
            addressId: _selectedAddress!.id,
            budget: _budget,
          )
          .timeout(const Duration(seconds: 15));
      if (!mounted) return;
      // docs/08 §57 بند 1 — بلاغ المالك: "مفروض يبقى ظاهر له إنه بتبعت الطلب ده، الطلب بيتراجع،
      // وبنتواصل معاك… وتقوله بتلاقي حاجة اسمها مشاريعي عشان تتابع من هناك". SnackBar لوحده
      // بيختفي في ثانيتين ومش بيشرح الخطوة الجاية ولا مكان المتابعة.
      await _showSubmittedSheet();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const MyProjectsScreen()),
      );
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'حصل خطأ، حاول تاني');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// "وصل طلبك — وإيه اللي هيحصل بعد كده" (docs/08 §57 بند 1).
  Future<void> _showSubmittedSheet() {
    return showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 28, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.green, size: 28),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'وصلنا طلبك',
                    style: Theme.of(sheetContext).textTheme.titleLarge,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const _NextStepLine(
              icon: Icons.fact_check_outlined,
              text: 'فريقنا بيراجع تفاصيل المشروع دلوقتي.',
            ),
            const _NextStepLine(
              icon: Icons.phone_in_talk_outlined,
              text: 'هنتواصل معاك لتحديد معاينة على الطبيعة.',
            ),
            const _NextStepLine(
              icon: Icons.request_quote_outlined,
              text: 'بعد المعاينة هيوصلك عرض سعر مفصّل توافق عليه من التطبيق.',
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(sheetContext).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'تقدر تتابع حالة المشروع في أي وقت من: حسابي ← مشاريعي',
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.of(sheetContext).pop(),
                child: const Text('تمام، ودّيني لمشاريعي'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ProjectsRepo {
  final AuthRepository auth;
  ProjectsRepo(this.auth);

  Future<Map<String, dynamic>> create({
    required String projectType,
    required String nameAr,
    String? description,
    required String addressId,
    int? budget,
  }) async {
    final body = <String, dynamic>{
      'project_type': projectType,
      'name_ar': nameAr,
      'address_id': addressId,
    };
    if (description != null) {
      body['description_ar'] = description;
    }
    if (budget != null) {
      body['budget_estimate_cents'] = budget * 100;
    }
    final response = await auth.authedRequest(
      'POST',
      '/me/projects',
      body: body,
    );
    if (response == null) {
      throw ApiException(
        code: 'PROJECT_EMPTY_RESPONSE',
        message: 'تم إرسال الطلب لكن الرد غير مكتمل، حدّث قائمة المشاريع',
        statusCode: 502,
      );
    }
    return response;
  }
}

class _NextStepLine extends StatelessWidget {
  const _NextStepLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18),
          const SizedBox(width: 10),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
