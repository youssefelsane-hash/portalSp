import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import 'domestic_workers_repository.dart';
import 'models.dart';

class WorkerDetailScreen extends StatefulWidget {
  final String workerId;

  const WorkerDetailScreen({super.key, required this.workerId});

  @override
  State<WorkerDetailScreen> createState() => _WorkerDetailScreenState();
}

class _WorkerDetailScreenState extends State<WorkerDetailScreen> {
  late final DomesticWorkersRepository _repository;
  PublicWorker? _worker;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = DomesticWorkersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final worker = await _repository.getOne(widget.workerId);
      if (mounted) setState(() => _worker = worker);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  Future<void> _openBookingSheet() async {
    final worker = _worker;
    if (worker == null) return;
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _BookWorkerSheet(repository: _repository, worker: worker),
    );
    if (result == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتبعت طلب الحجز — استنى موافقة مقدّم الخدمة')));
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final worker = _worker;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(worker?.fullName ?? 'تفاصيل مقدّم الخدمة')),
        body: _error != null
            ? Center(child: Text(_error!))
            : worker == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Row(
                        children: [
                          const CircleAvatar(radius: 32, child: Icon(Icons.person, size: 32)),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(worker.fullName, style: Theme.of(context).textTheme.titleLarge),
                                Row(
                                  children: [
                                    const Icon(Icons.star, size: 16, color: Colors.amber),
                                    Text(' ${worker.averageRating.toStringAsFixed(1)} (${worker.totalRatingsCount} تقييم)'),
                                  ],
                                ),
                                Text('${worker.completedBookingsCount} حجز مكتمل · ${worker.yearsOfExperience} سنين خبرة'),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (worker.bio != null) ...[
                        const SizedBox(height: 16),
                        Text(worker.bio!),
                      ],
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final specialty in worker.specialties)
                            Chip(label: Text(specialtyLabelsAr[specialty] ?? specialty)),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (worker.hourlyRateCents != null) Text('السعر بالساعة: ${_formatEgp(worker.hourlyRateCents!)}'),
                              if (worker.monthlyRateCents != null) Text('السعر الشهري: ${_formatEgp(worker.monthlyRateCents!)}'),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(onPressed: _openBookingSheet, child: const Text('احجز دلوقتي')),
                    ],
                  ),
      ),
    );
  }
}

class _BookWorkerSheet extends StatefulWidget {
  final DomesticWorkersRepository repository;
  final PublicWorker worker;

  const _BookWorkerSheet({required this.repository, required this.worker});

  @override
  State<_BookWorkerSheet> createState() => _BookWorkerSheetState();
}

class _BookWorkerSheetState extends State<_BookWorkerSheet> {
  String? _specialty;
  String _bookingType = 'hourly';
  Address? _address;
  DateTime? _scheduledAt;
  int _durationHours = 2;
  final _notesController = TextEditingController();
  String? _error;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _specialty = widget.worker.specialties.isNotEmpty ? widget.worker.specialties.first : null;
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  int? get _estimatedPriceCents {
    if (_bookingType == 'hourly') {
      final rate = widget.worker.hourlyRateCents;
      return rate != null ? rate * _durationHours : null;
    }
    return widget.worker.monthlyRateCents;
  }

  Future<void> _pickAddress() async {
    final address = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressesScreen(selectionMode: true)),
    );
    if (address != null) setState(() => _address = address);
  }

  Future<void> _pickDateTime() async {
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now().add(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 9, minute: 0));
    if (time == null) return;
    setState(() => _scheduledAt = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _submit() async {
    if (_specialty == null || _address == null || _scheduledAt == null) {
      setState(() => _error = 'كمّل كل البيانات الأول');
      return;
    }
    if (_bookingType == 'hourly' && widget.worker.hourlyRateCents == null) {
      setState(() => _error = 'مقدّم الخدمة ده مالوش سعر بالساعة محدد');
      return;
    }
    if (_bookingType == 'monthly_live_in' && widget.worker.monthlyRateCents == null) {
      setState(() => _error = 'مقدّم الخدمة ده مالوش سعر شهري محدد');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.repository.createBooking(
        workerId: widget.worker.id,
        addressId: _address!.id,
        specialty: _specialty!,
        bookingType: _bookingType,
        scheduledAt: _scheduledAt!.toIso8601String(),
        durationHours: _bookingType == 'hourly' ? _durationHours : null,
        customerNotes: _notesController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('حجز مع ${widget.worker.fullName}', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _specialty,
                decoration: const InputDecoration(labelText: 'نوع الخدمة', border: OutlineInputBorder()),
                items: [
                  for (final specialty in widget.worker.specialties)
                    DropdownMenuItem(value: specialty, child: Text(specialtyLabelsAr[specialty] ?? specialty)),
                ],
                onChanged: (value) => setState(() => _specialty = value),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _bookingType,
                decoration: const InputDecoration(labelText: 'نوع الحجز', border: OutlineInputBorder()),
                items: const [
                  DropdownMenuItem(value: 'hourly', child: Text('بالساعة')),
                  DropdownMenuItem(value: 'monthly_live_in', child: Text('إقامة شهرية')),
                ],
                onChanged: (value) => setState(() => _bookingType = value ?? 'hourly'),
              ),
              if (_bookingType == 'hourly') ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Text('عدد الساعات: '),
                    IconButton(
                      onPressed: _durationHours > 1 ? () => setState(() => _durationHours--) : null,
                      icon: const Icon(Icons.remove_circle_outline),
                    ),
                    Text('$_durationHours'),
                    IconButton(
                      onPressed: _durationHours < 12 ? () => setState(() => _durationHours++) : null,
                      icon: const Icon(Icons.add_circle_outline),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(_address != null ? (_address!.label ?? _address!.streetName) : 'اختار العنوان'),
                trailing: const Icon(Icons.chevron_left),
                onTap: _pickAddress,
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  _scheduledAt != null
                      ? _scheduledAt!.toIso8601String().substring(0, 16).replaceFirst('T', ' ')
                      : (_bookingType == 'hourly' ? 'اختار موعد الزيارة' : 'اختار تاريخ بداية العقد'),
                ),
                trailing: const Icon(Icons.calendar_today_outlined),
                onTap: _pickDateTime,
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _notesController,
                decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)', border: OutlineInputBorder()),
                maxLines: 2,
              ),
              if (_estimatedPriceCents != null) ...[
                const SizedBox(height: 12),
                Text('السعر المتوقع: ${_formatEgp(_estimatedPriceCents!)}', style: Theme.of(context).textTheme.titleMedium),
              ],
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('تأكيد الحجز'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
