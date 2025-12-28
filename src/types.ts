export interface PatientRecord {
  patient_id: string;
  name?: string;
  age?: number | string;
  gender?: string;
  blood_pressure?: string;
  temperature?: number | string;
  visit_date?: string;
  diagnosis?: string;
  medications?: string;
  [key: string]: unknown;
}

export interface PatientsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PatientsResponse {
  data: PatientRecord[];
  pagination: PatientsPagination;
  metadata?: Record<string, unknown>;
}

export interface AlertsPayload {
  high_risk_patients: string[];
  fever_patients: string[];
  data_quality_issues: string[];
}

export interface PatientRiskProfile {
  patientId: string;
  bpScore: number;
  temperatureScore: number;
  ageScore: number;
  totalScore: number;
  hasFever: boolean;
  hasDataQualityIssue: boolean;
  temperatureValue?: number | undefined;
  reason?: string;
}
