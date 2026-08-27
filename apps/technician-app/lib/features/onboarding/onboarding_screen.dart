import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import 'models.dart';
import 'onboarding_repository.dart';

// اعتماد الفني الجديد (docs/02 §technician_profiles.verification_status) — كانت فجوة موثّقة
// صراحة: فني جديد سجّل حساب (verification_status=pending تلقائيًا) كان بيتحوّل مباشرة لشاشة
// الطلبات المتاحة الفاضية للأبد، من غير أي تفسير أو طريقة يرفع بيها مستنداته أصلاً — matching
// بيرفض أي فني مش approved (matching.service.ts, WHERE verification_status='approved').
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  late final OnboardingRepository _repository;
  // الرقم القومي (ADR-0045، docs/08 §77-E1) — الحقل ده كان **مفقود تمامًا** رغم إن الباك-إند
  // بيمنع الاعتماد من غيره، فالفني كان بيرفع مستنداته ويستنى اعتماد مستحيل يحصل.
  final _nationalIdController = TextEditingController();
  bool _savingNationalId = false;
  String? _nationalIdError;
  TechnicianMe? _me;
  List<TechnicianDocument> _documents = [];
  String? _error;
  bool _loading = true;
  bool _uploading = false;
  String _selectedDocumentType = documentTypeLabelsAr.keys.first;

  @override
  void initState() {
    super.initState();
    _repository = OnboardingRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([_repository.fetchMe(), _repository.listDocuments()]);
      if (mounted) {
        setState(() {
          _me = results[0] as TechnicianMe;
          _documents = results[1] as List<TechnicianDocument>;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _saveNationalId() async {
    final value = _nationalIdController.text.trim();
    if (value.isEmpty) return;
    setState(() {
      _savingNationalId = true;
      _nationalIdError = null;
    });
    try {
      await _repository.setNationalId(value);
      _nationalIdController.clear();
      // إعادة تحميل الحالة كلها — الرد مش بيرجّع الرقم (عمدًا)، فالمصدر الوحيد للحقيقة هو
      // `/technician/me` تاني.
      await _load();
    } catch (error) {
      // رسالة الباك-إند بتقول السبب بالظبط (رقم غير صالح / مستخدم عند فني تاني / ممنوع بعد
      // الاعتماد) — أوضح بكتير من نص عام.
      if (mounted) setState(() => _nationalIdError = '$error');
    } finally {
      if (mounted) setState(() => _savingNationalId = false);
    }
  }

  Future<void> _pickAndUpload() async {
    // بعض المستندات صور، بعضها ممكن يكون PDF (فيش وتشبيه غالبًا) — image_picker بيغطي الحالة
    // الأشيع (تصوير/اختيار صورة) وده كافي للـMVP، رفع PDF من الجهاز مباشرة برّه نطاق الشاشة دي
    // دلوقتي (نفس نطاق ALLOWED_DOCUMENT_MIME_TYPES بس بواجهة أبسط).
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;

    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final bytes = await picked.readAsBytes();
      final document = await _repository.uploadDocument(
        documentType: _selectedDocumentType,
        fileBytes: bytes,
        filename: picked.name,
      );
      if (mounted) setState(() => _documents = [document, ..._documents]);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'approved':
        return Colors.green;
      case 'rejected':
      case 'suspended':
        return Colors.red;
      default:
        return Colors.orange;
    }
  }

  /// كارت الرقم القومي — بيتقفل بعد ما يتسجّل.
  ///
  /// **الرقم ما بيتعرضش تاني** بعد الحفظ (ولا حتى مقنّع): الفني كتبه فهو يعرفه، وعرضه بيوسّع
  /// سطح التسريب على شاشة بتتفتح كتير بلا أي فايدة له. التأكيد بس هو المطلوب.
  Widget _buildNationalIdCard(BuildContext context) {
    final theme = Theme.of(context);
    if (_me!.nationalIdSet) {
      return Card(
        child: ListTile(
          leading: Icon(Icons.badge_outlined, color: theme.colorScheme.primary),
          title: const Text('الرقم القومي اتسجّل ✓'),
          subtitle: const Text('لو فيه غلطة في الرقم، كلّم فريق التشغيل — التعديل بعد كده من عندهم.'),
        ),
      );
    }
    return Card(
      color: theme.colorScheme.errorContainer.withValues(alpha: 0.35),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.badge_outlined, color: theme.colorScheme.error),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'الرقم القومي مطلوب',
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'من غير الرقم القومي مش هنقدر نعتمد حسابك. اكتبه زي ما هو في بطاقتك (14 رقم).',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('technician-national-id'),
              controller: _nationalIdController,
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
              maxLength: 14,
              decoration: const InputDecoration(
                labelText: 'الرقم القومي',
                border: OutlineInputBorder(),
                counterText: '',
              ),
            ),
            if (_nationalIdError != null) ...[
              const SizedBox(height: 4),
              Text(_nationalIdError!, style: TextStyle(color: theme.colorScheme.error)),
            ],
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _savingNationalId ? null : _saveNationalId,
              child: Text(_savingNationalId ? 'بيتحفظ…' : 'حفظ الرقم القومي'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _nationalIdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('استكمال بيانات الحساب'),
          actions: [
            IconButton(
              tooltip: 'تسجيل الخروج',
              icon: const Icon(Icons.logout),
              onPressed: () => context.read<AuthRepository>().logout(),
            ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _loading && _me == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_me != null)
                      Card(
                        color: _statusColor(_me!.verificationStatus).withValues(alpha: 0.1),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              Icon(Icons.info_outline, color: _statusColor(_me!.verificationStatus)),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      verificationStatusLabelsAr[_me!.verificationStatus] ?? _me!.verificationStatus,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleMedium
                                          ?.copyWith(color: _statusColor(_me!.verificationStatus)),
                                    ),
                                    Text('كود الفني: ${_me!.technicianCode}'),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    const SizedBox(height: 16),
                    // الرقم القومي فوق المستندات عمدًا: هو **شرط** الاعتماد (الباك-إند بيرفض
                    // الاعتماد بدونه)، فترتيبه بعد المستندات كان هيخلّي الفني يرفع كل حاجة
                    // ويستنى اعتماد مش هييجي.
                    if (_me != null) _buildNationalIdCard(context),
                    const SizedBox(height: 16),
                    Text(
                      'ارفع مستنداتك عشان فريق التشغيل يراجعها ويعتمد حسابك — من غير اعتماد مش هتقدر تستقبل طلبات.',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 16),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            DropdownButtonFormField<String>(
                              initialValue: _selectedDocumentType,
                              decoration: const InputDecoration(labelText: 'نوع المستند'),
                              items: documentTypeLabelsAr.entries
                                  .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                                  .toList(),
                              onChanged: (value) {
                                if (value != null) setState(() => _selectedDocumentType = value);
                              },
                            ),
                            const SizedBox(height: 12),
                            FilledButton.icon(
                              onPressed: _uploading ? null : _pickAndUpload,
                              icon: _uploading
                                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                  : const Icon(Icons.upload_file),
                              label: Text(_uploading ? 'بيترفع...' : 'اختار صورة وارفعها'),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: Colors.red)),
                    ],
                    const SizedBox(height: 24),
                    Text('المستندات المرفوعة', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (_documents.isEmpty)
                      const EmptyState(icon: Icons.description_outlined, title: 'لسه ما رفعتش أي مستند')
                    else
                      ..._documents.map(
                        (doc) => Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: ListTile(
                            title: Text(documentTypeLabelsAr[doc.documentType] ?? doc.documentType),
                            subtitle: doc.rejectionReason != null ? Text('سبب الرفض: ${doc.rejectionReason}') : null,
                            trailing: Chip(
                              label: Text(documentReviewStatusLabelsAr[doc.reviewStatus] ?? doc.reviewStatus),
                              backgroundColor: _statusColor(doc.reviewStatus).withValues(alpha: 0.15),
                            ),
                          ),
                        ),
                      ),
                    const SizedBox(height: 16),
                    OutlinedButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh),
                      label: const Text('تحديث حالة الحساب'),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
