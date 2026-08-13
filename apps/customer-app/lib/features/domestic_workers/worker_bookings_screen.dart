import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'domestic_workers_repository.dart';
import 'models.dart';

class WorkerBookingsScreen extends StatefulWidget {
  const WorkerBookingsScreen({super.key});

  @override
  State<WorkerBookingsScreen> createState() => _WorkerBookingsScreenState();
}

class _WorkerBookingsScreenState extends State<WorkerBookingsScreen> {
  late final DomesticWorkersRepository _repository;
  List<WorkerBooking>? _bookings;
  String? _error;
  bool _cancelling = false;

  @override
  void initState() {
    super.initState();
    _repository = DomesticWorkersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final bookings = await _repository.listBookings();
      if (mounted) setState(() => _bookings = bookings);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _cancel(WorkerBooking booking) async {
    setState(() => _cancelling = true);
    try {
      await _repository.cancelBooking(booking.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('حجوزاتي')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _bookings == null
                  ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                  : _bookings!.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 80),
                            EmptyState(icon: Icons.event_note_outlined, title: 'مفيش حجوزات لسه'),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _bookings!.length,
                          itemBuilder: (context, index) {
                            final booking = _bookings![index];
                            return Card(
                              child: ListTile(
                                title: Text(specialtyLabelsAr[booking.specialty] ?? booking.specialty),
                                subtitle: Text(
                                  '${bookingTypeLabelsAr[booking.bookingType] ?? booking.bookingType} — '
                                  '${bookingStatusLabelsAr[booking.status] ?? booking.status}\n'
                                  '${booking.scheduledAt.substring(0, 16).replaceFirst('T', ' ')} — ${_formatEgp(booking.priceCents)}',
                                ),
                                isThreeLine: true,
                                trailing: cancellableBookingStatuses.contains(booking.status)
                                    ? TextButton(
                                        onPressed: _cancelling ? null : () => _cancel(booking),
                                        child: const Text('إلغاء'),
                                      )
                                    : null,
                              ),
                            );
                          },
                        ),
        ),
      ),
    );
  }
}
