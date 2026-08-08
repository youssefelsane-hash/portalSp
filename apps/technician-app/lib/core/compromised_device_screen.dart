import 'package:flutter/material.dart';

class CompromisedDeviceScreen extends StatelessWidget {
  final String reasonAr;

  const CompromisedDeviceScreen({super.key, required this.reasonAr});

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.gpp_bad_outlined, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text('التطبيق مش متاح على الجهاز ده', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text(reasonAr, textAlign: TextAlign.center),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
