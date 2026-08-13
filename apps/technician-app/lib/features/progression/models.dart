// محرك المسار الوظيفي/الترقي للفني (docs/11 §4) — مطابق لـ
// apps/api/src/modules/technician-progression/dto/progression-response.dto.ts.
class UnmetRequirement {
  final String key;
  final String labelAr;
  final num? currentValue;
  final num requiredValue;

  UnmetRequirement({required this.key, required this.labelAr, required this.currentValue, required this.requiredValue});

  factory UnmetRequirement.fromJson(Map<String, dynamic> json) => UnmetRequirement(
        key: json['key'] as String,
        labelAr: json['labelAr'] as String,
        currentValue: json['currentValue'] as num?,
        requiredValue: json['requiredValue'] as num,
      );
}

class ProgressionStatus {
  final String currentLevel;
  final String? nextLevel;
  final bool isEligible;
  final List<UnmetRequirement> unmetRequirements;
  final Map<String, dynamic> progress;
  final String? eligibleSince;

  ProgressionStatus({
    required this.currentLevel,
    required this.nextLevel,
    required this.isEligible,
    required this.unmetRequirements,
    required this.progress,
    required this.eligibleSince,
  });

  factory ProgressionStatus.fromJson(Map<String, dynamic> json) => ProgressionStatus(
        currentLevel: json['current_level'] as String,
        nextLevel: json['next_level'] as String?,
        isEligible: json['is_eligible'] as bool,
        unmetRequirements: (json['unmet_requirements'] as List<dynamic>)
            .cast<Map<String, dynamic>>()
            .map(UnmetRequirement.fromJson)
            .toList(),
        progress: (json['progress'] as Map<String, dynamic>?) ?? const {},
        eligibleSince: json['eligible_since'] as String?,
      );
}

class LevelHistoryEntry {
  final String? previousLevel;
  final String newLevel;
  final String changeType;
  final String effectiveFrom;

  LevelHistoryEntry({required this.previousLevel, required this.newLevel, required this.changeType, required this.effectiveFrom});

  factory LevelHistoryEntry.fromJson(Map<String, dynamic> json) => LevelHistoryEntry(
        previousLevel: json['previous_level'] as String?,
        newLevel: json['new_level'] as String,
        changeType: json['change_type'] as String,
        effectiveFrom: json['effective_from'] as String,
      );
}

class ProgressionSummary {
  final ProgressionStatus? status;
  final List<LevelHistoryEntry> history;

  ProgressionSummary({required this.status, required this.history});

  factory ProgressionSummary.fromJson(Map<String, dynamic> json) => ProgressionSummary(
        status: json['status'] == null ? null : ProgressionStatus.fromJson(json['status'] as Map<String, dynamic>),
        history: (json['history'] as List<dynamic>).cast<Map<String, dynamic>>().map(LevelHistoryEntry.fromJson).toList(),
      );
}

const Map<String, String> technicianLevelLabelsAr = {
  'new': 'جديد',
  'verified': 'موثّق',
  'professional': 'محترف',
  'premium': 'بريميوم',
  'team_leader': 'قائد فريق',
};
