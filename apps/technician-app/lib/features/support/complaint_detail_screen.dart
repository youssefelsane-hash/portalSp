import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'support_repository.dart';

// §24 — نفس نمط apps/customer-app/lib/features/support/complaint_detail_screen.dart بالحرف،
// بفارق واحد: senderRole == 'technician' بيحدد محاذاة رسالة الفني نفسه (مش 'customer').
class ComplaintDetailScreen extends StatefulWidget {
  final String complaintId;

  const ComplaintDetailScreen({super.key, required this.complaintId});

  @override
  State<ComplaintDetailScreen> createState() => _ComplaintDetailScreenState();
}

class _ComplaintDetailScreenState extends State<ComplaintDetailScreen> {
  late final SupportRepository _repository;
  final _messageController = TextEditingController();
  Complaint? _complaint;
  List<ComplaintMessage> _messages = [];
  List<ComplaintAttachment> _attachments = [];
  bool _loading = true;
  bool _sending = false;
  bool _uploadingImage = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = SupportRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _repository.getOne(widget.complaintId),
        _repository.listMessages(widget.complaintId),
        _repository.listAttachments(widget.complaintId),
      ]);
      if (mounted) {
        setState(() {
          _complaint = results[0] as Complaint;
          _messages = results[1] as List<ComplaintMessage>;
          _attachments = results[2] as List<ComplaintAttachment>;
          _loading = false;
        });
      }
    } on ApiException catch (err) {
      if (mounted) {
        setState(() {
          _error = err.message;
          _loading = false;
        });
      }
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final message = await _repository.addMessage(widget.complaintId, text);
      if (mounted) {
        setState(() => _messages = [..._messages, message]);
        _messageController.clear();
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickAndUploadAttachment() async {
    if (_uploadingImage) return;
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;

    setState(() => _uploadingImage = true);
    try {
      final bytes = await picked.readAsBytes();
      final attachment = await _repository.uploadAttachment(widget.complaintId, bytes, picked.name);
      if (mounted) setState(() => _attachments = [..._attachments, attachment]);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _uploadingImage = false);
    }
  }

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(_complaint != null ? 'شكوى #${_complaint!.complaintNumber}' : 'شكوى')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _complaint == null
                ? Center(child: Text(_error ?? 'حصل خطأ'))
                : Column(
                    children: [
                      Expanded(
                        child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            Card(
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(_complaint!.title, style: Theme.of(context).textTheme.titleMedium),
                                    const SizedBox(height: 8),
                                    Text(_complaint!.description),
                                    const SizedBox(height: 12),
                                    Chip(
                                      label: Text(
                                        complaintStatusLabelsAr[_complaint!.complaintStatus] ??
                                            _complaint!.complaintStatus,
                                      ),
                                    ),
                                    if (_complaint!.resolutionNotes != null) ...[
                                      const SizedBox(height: 12),
                                      const Text('قرار الدعم:', style: TextStyle(fontWeight: FontWeight.bold)),
                                      Text(_complaint!.resolutionNotes!),
                                      if (_complaint!.compensationCents > 0)
                                        Text('تعويض: ${_complaint!.compensationCents / 100} ج.م'),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            if (_attachments.isNotEmpty) ...[
                              Text('المرفقات', style: Theme.of(context).textTheme.titleSmall),
                              const SizedBox(height: 8),
                              SizedBox(
                                height: 80,
                                child: ListView.separated(
                                  scrollDirection: Axis.horizontal,
                                  itemCount: _attachments.length,
                                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                                  itemBuilder: (context, i) => ClipRRect(
                                    borderRadius: BorderRadius.circular(8),
                                    child: Image.network(_attachments[i].fileUrl, width: 80, height: 80, fit: BoxFit.cover),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 16),
                            ],
                            Text('الرسائل', style: Theme.of(context).textTheme.titleSmall),
                            const SizedBox(height: 8),
                            ..._messages.map(
                              (m) => Align(
                                alignment: m.senderRole == 'technician' ? Alignment.centerRight : Alignment.centerLeft,
                                child: Container(
                                  margin: const EdgeInsets.symmetric(vertical: 4),
                                  padding: const EdgeInsets.all(12),
                                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                                  decoration: BoxDecoration(
                                    color: m.senderRole == 'technician'
                                        ? Theme.of(context).colorScheme.primaryContainer
                                        : Theme.of(context).colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(m.message),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ),
                      SafeArea(
                        child: Padding(
                          padding: const EdgeInsets.all(8),
                          child: Row(
                            children: [
                              IconButton(
                                icon: _uploadingImage
                                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                    : const Icon(Icons.image_outlined),
                                onPressed: _uploadingImage ? null : _pickAndUploadAttachment,
                              ),
                              Expanded(
                                child: TextField(
                                  controller: _messageController,
                                  decoration: const InputDecoration(hintText: 'اكتب رسالة...'),
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.send),
                                onPressed: _sending ? null : _sendMessage,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
      ),
    );
  }
}
