import { PatientRecord, AlertsPayload, PatientRiskProfile } from './types';

type ScoreResult = {
  score: number;
  valid: boolean;
  value?: number;
};

const toFiniteNumber = (value: number | string | undefined | null): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return null;
  }

  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerTrimmed === 'n/a' || lowerTrimmed === 'na' || lowerTrimmed === 'invalid' || 
      lowerTrimmed === 'temp_error' || lowerTrimmed === 'error' || lowerTrimmed === '') {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const scoreBloodPressure = (input?: string | number | null): ScoreResult => {
  if (input === null || input === undefined || input === '') {
    return { score: 0, valid: false };
  }

  const trimmed = String(input).trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed.toLowerCase() === 'n/a') {
    return { score: 0, valid: false };
  }

  const parts = trimmed.split('/');
  if (parts.length !== 2) {
    return { score: 0, valid: false };
  }

  const rawSystolic = parts[0]?.trim();
  const rawDiastolic = parts[1]?.trim();
  
  if (!rawSystolic || !rawDiastolic || rawSystolic === '' || rawDiastolic === '') {
    return { score: 0, valid: false };
  }

  const systolic = toFiniteNumber(rawSystolic);
  const diastolic = toFiniteNumber(rawDiastolic);

  if (systolic === null || diastolic === null) {
    return { score: 0, valid: false };
  }
  
  if (systolic < 0 || systolic > 300 || diastolic < 0 || diastolic > 200) {
    return { score: 0, valid: false };
  }

  if (systolic >= 140 || diastolic >= 90) {
    return { score: 3, valid: true };
  }

  const systolicStage1 = systolic >= 130 && systolic <= 139;
  const diastolicStage1 = diastolic >= 80 && diastolic <= 89;
  
  if (systolicStage1 || diastolicStage1) {
    return { score: 2, valid: true };
  }

  if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
    return { score: 1, valid: true };
  }

  return { score: 0, valid: true };
};

const scoreTemperature = (input?: number | string | null): ScoreResult => {
  if (input === null || input === undefined || input === '') {
    return { score: 0, valid: false };
  }

  const temperature = toFiniteNumber(input);
  if (temperature === null) {
    return { score: 0, valid: false };
  }

  if (temperature >= 101.0) {
    return { score: 2, valid: true, value: temperature };
  }

  if (temperature < 80 || temperature > 115) {
    return { score: 0, valid: false };
  }

  if (temperature >= 99.6 - 0.0001 && temperature <= 100.9 + 0.0001) {
    return { score: 1, valid: true, value: temperature };
  }

  return { score: 0, valid: true, value: temperature };
};

const scoreAge = (input?: number | string | null): ScoreResult => {
  if (input === null || input === undefined || input === '') {
    return { score: 0, valid: false };
  }

  const age = toFiniteNumber(input);
  if (age === null) {
    return { score: 0, valid: false };
  }

  if (age < 0 || age > 150 || !Number.isInteger(age)) {
    return { score: 0, valid: false };
  }

  if (age > 65) {
    return { score: 2, valid: true };
  }

  if (age >= 40) {
    return { score: 1, valid: true };
  }

  return { score: 0, valid: true };
};

export const buildRiskProfile = (
  patient: PatientRecord
): PatientRiskProfile => {
  const bpScore = scoreBloodPressure(patient.blood_pressure);
  const temperatureScore = scoreTemperature(patient.temperature);
  const ageScore = scoreAge(patient.age);

  const totalScore = bpScore.score + temperatureScore.score + ageScore.score;
  const hasDataQualityIssue =
    !bpScore.valid || !temperatureScore.valid || !ageScore.valid;

  const hasFever = temperatureScore.valid && 
                   temperatureScore.value !== null && 
                   temperatureScore.value !== undefined &&
                   temperatureScore.value >= 99.6;

  return {
    patientId: patient.patient_id,
    bpScore: bpScore.score,
    temperatureScore: temperatureScore.score,
    ageScore: ageScore.score,
    totalScore,
    hasFever,
    hasDataQualityIssue,
    temperatureValue: temperatureScore.value,
  };
};

export const buildAlerts = (patients: PatientRecord[]): AlertsPayload => {
  const highRiskPatients = new Set<string>();
  const feverPatients = new Set<string>();
  const dataQualityIssues = new Set<string>();

  for (const patient of patients) {
    const patientId = patient.patient_id;
    
    if (patientId === null || patientId === undefined) {
      continue;
    }
    
    const validTypes = ['string', 'number', 'boolean'];
    if (!validTypes.includes(typeof patientId)) {
      continue;
    }
    
    if (typeof patientId === 'string' && patientId.trim() === '') {
      continue;
    }
    
    if (typeof patientId === 'boolean' && patientId === false) {
      continue;
    }
    
    if (typeof patientId === 'number' && (patientId < 0 || !Number.isFinite(patientId))) {
      continue;
    }

    const profile = buildRiskProfile(patient);

    if (profile.totalScore >= 4) {
      highRiskPatients.add(String(profile.patientId));
    }

    if (profile.hasFever) {
      feverPatients.add(String(profile.patientId));
    }

    if (profile.hasDataQualityIssue) {
      dataQualityIssues.add(String(profile.patientId));
    }
  }
  const sortedHighRisk = Array.from(highRiskPatients).sort();
  const sortedFever = Array.from(feverPatients).sort();
  const sortedDataQuality = Array.from(dataQualityIssues).sort();

  return {
    high_risk_patients: sortedHighRisk,
    fever_patients: sortedFever,
    data_quality_issues: sortedDataQuality,
  };
};
