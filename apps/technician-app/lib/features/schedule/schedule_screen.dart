import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'schedule_repository.dart';

class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key});

  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  late final ScheduleRepository _repository;
  List<ScheduleSlot>? _slots;
  String? _error;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _repository = ScheduleRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final slots = await _repository.list();
      slots.sort((a, b) {
        final dateCompare = a.slotDate.compareTo(b.slotDate);
        return dateCompare != 0 ? dateCompare : a.startTime.compareTo(b.startTime);
      });
      if (mounted) setState(() => _slots = slots);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _delete(ScheduleSlot slot) async {
    try {
      await _repository.delete(slot.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  Future<void> _addSlot() async {
    final result = await showModalBottomSheet<_NewSlotInput>(
      context: context,
      isScrollControlled: true,
      builder: (context) => const _AddSlotSheet(),
    );
    if (result == null) return;

    setState(() => _submitting = true);
    try {
      await _repository.create(
        slotDate: result.slotDate,
        startTime: result.startTime,
        endTime: result.endTime,
        notesAr: result.notesAr,
      );
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _statusLabel(ScheduleSlot slot) => switch (slot.status) {
        'available' => 'فاضي',
        'booked' => 'محجوز',
        'blocked' => 'إجازة',
        _ => slot.status,
      };

  Color _statusColor(ScheduleSlot slot) => switch (slot.status) {
        'available' => Colors.green,
        'booked' => Colors.blue,
        'blocked' => Colors.grey,
        _ => Colors.grey,
      };

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('جدول مواعيدي')),
        floatingActionButton: FloatingActionButton(
          onPressed: _submitting ? null : _addSlot,
          child: _submitting
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.add),
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _slots == null
                  ? const Center(child: CircularProgressIndicator())
                  : _slots!.isEmpty
                      ? ListView(
                          children: const [
                            Padding(
                              padding: EdgeInsets.all(32),
                              child: Center(child: Text('مفيش مواعيد مضافة لسه — دوس + عشان تضيف وقت فاضي')),
                            ),
                          ],
                        )
                      : ListView.builder(
                          itemCount: _slots!.length,
                          itemBuilder: (context, index) {
                            final slot = _slots![index];
                            return ListTile(
                              leading: CircleAvatar(
                                backgroundColor: _statusColor(slot),
                                child: Icon(
                                  slot.status == 'booked' ? Icons.event_busy : Icons.event_available,
                                  color: Colors.white,
                                  size: 18,
                                ),
                              ),
                              title: Text(slot.slotDate),
                              subtitle: Text(
                                '${slot.startTime.substring(0, 5)} - ${slot.endTime.substring(0, 5)} · ${_statusLabel(slot)}'
                                '${slot.notesAr != null && slot.notesAr!.isNotEmpty ? ' · ${slot.notesAr}' : ''}',
                              ),
                              trailing: slot.isBooked
                                  ? null
                                  : IconButton(
                                      icon: const Icon(Icons.delete_outline),
                                      onPressed: () => _delete(slot),
                                    ),
                            );
                          },
                        ),
        ),
      ),
    );
  }
}

class _NewSlotInput {
  final String slotDate;
  final String startTime;
  final String endTime;
  final String? notesAr;

  _NewSlotInput({required this.slotDate, required this.startTime, required this.endTime, this.notesAr});
}

class _AddSlotSheet extends StatefulWidget {
  const _AddSlotSheet();

  @override
  State<_AddSlotSheet> createState() => _AddSlotSheetState();
}

class _AddSlotSheetState extends State<_AddSlotSheet> {
  DateTime? _date;
  TimeOfDay? _start;
  TimeOfDay? _end;
  final _notesController = TextEditingController();
  String? _error;

  String _formatDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  String _formatTime(TimeOfDay time) => '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickStart() async {
    final picked = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 9, minute: 0));
    if (picked != null) setState(() => _start = picked);
  }

  Future<void> _pickEnd() async {
    final picked = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 11, minute: 0));
    if (picked != null) setState(() => _end = picked);
  }

  void _submit() {
    if (_date == null || _start == null || _end == null) {
      setState(() => _error = 'اختار التاريخ ووقت البداية والنهاية');
      return;
    }
    final startMinutes = _start!.hour * 60 + _start!.minute;
    final endMinutes = _end!.hour * 60 + _end!.minute;
    if (endMinutes <= startMinutes) {
      setState(() => _error = 'وقت النهاية لازم يكون بعد وقت البداية');
      return;
    }
    Navigator.of(context).pop(
      _NewSlotInput(
        slotDate: _formatDate(_date!),
        startTime: _formatTime(_start!),
        endTime: _formatTime(_end!),
        notesAr: _notesController.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('إضافة موعد فاضي', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(_date != null ? _formatDate(_date!) : 'اختار التاريخ'),
              trailing: const Icon(Icons.calendar_today_outlined),
              onTap: _pickDate,
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(_start != null ? _formatTime(_start!) : 'وقت البداية'),
              trailing: const Icon(Icons.access_time_outlined),
              onTap: _pickStart,
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(_end != null ? _formatTime(_end!) : 'وقت النهاية'),
              trailing: const Icon(Icons.access_time_outlined),
              onTap: _pickEnd,
            ),
            TextField(
              controller: _notesController,
              decoration: const InputDecoration(labelText: 'ملاحظة (اختياري)'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 16),
            FilledButton(onPressed: _submit, child: const Text('إضافة')),
          ],
        ),
      ),
    );
  }
}
