import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import 'models.dart';
import 'worker_repository.dart';

// الشاشة الرئيسية للشغالة/العامل المنزلي بعد تسجيل الدخول (ADR-0005) — بروفايل + موقع +
// حجوزات، كل ده كان مفقود تمامًا رغم إن الباك-إند جاهز من زمان.
class WorkerHomeScreen extends StatefulWidget {
  const WorkerHomeScreen({super.key});

  @override
  State<WorkerHomeScreen> createState() => _WorkerHomeScreenState();
}

class _WorkerHomeScreenState extends State<WorkerHomeScreen> {
  late final WorkerRepository _repository;
  WorkerMe? _me;
  List<WorkerBooking>? _bookings;
  String? _error;
  bool _acting = false;

  final _bioController = TextEditingController();
  final _yearsController = TextEditingController();
  final _hourlyController = TextEditingController();
  final _monthlyController = TextEditingController();
  final Set<String> _selectedSpecialties = {};

  @override
  void initState() {
    super.initState();
    _repository = WorkerRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_repository.fetchMe(), _repository.listBookings()]);
      final me = results[0] as WorkerMe;
      if (mounted) {
        setState(() {
          _me = me;
          _bookings = results[1] as List<WorkerBooking>;
          _bioController.text = me.bio ?? '';
          _yearsController.text = me.yearsOfExperience.toString();
          _hourlyController.text = me.hourlyRateCents != null ? (me.hourlyRateCents! / 100).toStringAsFixed(0) : '';
          _monthlyController.text = me.monthlyRateCents != null ? (me.monthlyRateCents! / 100).toStringAsFixed(0) : '';
          _selectedSpecialties
            ..clear()
            ..addAll(me.specialties);
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _saveProfile() async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.updateProfile(
        bio: _bioController.text.trim(),
        yearsOfExperience: int.tryParse(_yearsController.text.trim()),
        specialties: _selectedSpecialties.toList(),
        hourlyRateCents: _hourlyController.text.trim().isEmpty ? null : (double.parse(_hourlyController.text.trim()) * 100).round(),
        monthlyRateCents: _monthlyController.text.trim().isEmpty ? null : (double.parse(_monthlyController.text.trim()) * 100).round(),
      );
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتحفظ بروفايلك')));
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _requestReview() async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.requestReview();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('بروفايلك جاهز — استنى مراجعة الإدارة')));
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // بَقّة حقيقية اتلقطت: كان بيطلب من الشغالة تكتب lat/lng يدوي (نفس البَقّة المصلّحة في
  // OrderExecutionScreen._shareLocation()) — دلوقتي بنستخدم geolocator لقراءة موقع الجهاز
  // الحقيقي مباشرة، مفيش إدخال يدوي خالص.
  Future<void> _saveLocation() async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => _error = 'خدمة تحديد الموقع مقفولة على جهازك، شغّلها الأول وحاول تاني');
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        setState(() => _error = 'محتاجين إذن الوصول لموقعك عشان نحدّثه — فعّله من إعدادات الجهاز');
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      await _repository.updateLocation(position.latitude, position.longitude);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتحدّث موقعك')));
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'مقدرناش نحدد موقعك الحالي، حاول تاني');
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _confirmBooking(WorkerBooking booking) async {
    setState(() => _acting = true);
    try {
      await _repository.confirmBooking(booking.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _completeBooking(WorkerBooking booking) async {
    setState(() => _acting = true);
    try {
      await _repository.completeBooking(booking.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final me = _me;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('صُنّاع — الخدمات المنزلية'),
          actions: [
            IconButton(icon: const Icon(Icons.logout), onPressed: () => context.read<AuthRepository>().logout()),
          ],
        ),
        body: me == null
            ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(
                      color: me.verificationStatus == 'approved'
                          ? null
                          : Theme.of(context).colorScheme.secondaryContainer,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('كود: ${me.workerCode}'),
                            const SizedBox(height: 4),
                            Text(
                              workerVerificationStatusLabelsAr[me.verificationStatus] ?? me.verificationStatus,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            if (me.verificationNotes != null) ...[
                              const SizedBox(height: 4),
                              Text(me.verificationNotes!),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text('بروفايلي', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        for (final entry in specialtyLabelsAr.entries)
                          FilterChip(
                            label: Text(entry.value),
                            selected: _selectedSpecialties.contains(entry.key),
                            onSelected: (selected) => setState(() {
                              if (selected) {
                                _selectedSpecialties.add(entry.key);
                              } else {
                                _selectedSpecialties.remove(entry.key);
                              }
                            }),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _bioController,
                      decoration: const InputDecoration(labelText: 'نبذة عني', border: OutlineInputBorder()),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _yearsController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'سنين الخبرة', border: OutlineInputBorder()),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _hourlyController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'السعر بالساعة (جنيه)', border: OutlineInputBorder()),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _monthlyController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'السعر الشهري (جنيه)', border: OutlineInputBorder()),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 8),
                    FilledButton(onPressed: _acting ? null : _saveProfile, child: const Text('حفظ البروفايل')),
                    if (me.verificationStatus == 'pending') ...[
                      const SizedBox(height: 8),
                      OutlinedButton(onPressed: _acting ? null : _requestReview, child: const Text('قدّم البروفايل للمراجعة')),
                    ],
                    const SizedBox(height: 24),
                    Text('موقعي الحالي', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _acting ? null : _saveLocation,
                      icon: const Icon(Icons.my_location),
                      label: const Text('حدّث موقعي الحالي (GPS)'),
                    ),
                    const SizedBox(height: 24),
                    Text('حجوزاتي', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (_bookings == null || _bookings!.isEmpty) const EmptyState(icon: Icons.event_note_outlined, title: 'مفيش حجوزات لسه'),
                    for (final booking in _bookings ?? <WorkerBooking>[])
                      Card(
                        child: ListTile(
                          title: Text(specialtyLabelsAr[booking.specialty] ?? booking.specialty),
                          subtitle: Text(
                            '${bookingStatusLabelsAr[booking.status] ?? booking.status} — '
                            '${booking.scheduledAt.substring(0, 16).replaceFirst('T', ' ')} — ${_formatEgp(booking.priceCents)}',
                          ),
                          trailing: booking.status == 'pending_confirmation'
                              ? TextButton(
                                  onPressed: _acting ? null : () => _confirmBooking(booking),
                                  child: const Text('تأكيد'),
                                )
                              : (booking.bookingType == 'hourly' && booking.status == 'confirmed'
                                  ? TextButton(
                                      onPressed: _acting ? null : () => _completeBooking(booking),
                                      child: const Text('إكمال'),
                                    )
                                  : null),
                        ),
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}
