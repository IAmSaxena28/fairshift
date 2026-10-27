export const CATEGORY_LABEL: Record<string, string> = {
  hazard: 'Hazard',
  equipment: 'Equipment',
  ppe: 'Safety gear',
  workload: 'Workload',
  wages: 'Wages',
  mistreatment: 'Mistreatment',
  other: 'Other',
};

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
  under_review: 'Under review',
  action_taken: 'Action taken',
  resolved: 'Resolved',
};

export const FATIGUE_LABEL: Record<string, string> = {
  long_shift: 'long shift',
  short_rest: 'short rest between shifts',
  weekly_hours: 'weekly hours over limit',
  consecutive_days: 'too many days in a row',
};
