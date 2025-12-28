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

  // Check for common invalid values
  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerTrimmed === 'n/a' || lowerTrimmed === 'na' || lowerTrimmed === 'invalid' || 
      lowerTrimmed === 'temp_error' || lowerTrimmed === 'error' || lowerTrimmed === '') {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const scoreBloodPressure = (input?: string | number | null): ScoreResult => {
  // Handle null, undefined, empty string
  if (input === null || input === undefined || input === '') {
    return { score: 0, valid: false };
  }

  // Convert to string and trim
  const trimmed = String(input).trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed.toLowerCase() === 'n/a') {
    return { score: 0, valid: false };
  }

  // Split by '/' - handle cases like "150/" or "/90"
  const parts = trimmed.split('/');
  if (parts.length !== 2) {
    return { score: 0, valid: false };
  }

  const rawSystolic = parts[0]?.trim();
  const rawDiastolic = parts[1]?.trim();
  
  // Check if either part is missing (e.g., "150/" or "/90")
  if (!rawSystolic || !rawDiastolic || rawSystolic === '' || rawDiastolic === '') {
    return { score: 0, valid: false };
  }

  const systolic = toFiniteNumber(rawSystolic);
  const diastolic = toFiniteNumber(rawDiastolic);

  // If either is null/invalid, it's a data quality issue
  if (systolic === null || diastolic === null) {
    return { score: 0, valid: false };
  }
  
  // Validate reasonable ranges (BP can't be negative or extremely high)
  if (systolic < 0 || systolic > 300 || diastolic < 0 || diastolic > 200) {
    return { score: 0, valid: false };
  }

  // Stage 2 (Systolic ≥140 OR Diastolic ≥90): 3 points
  if (systolic >= 140 || diastolic >= 90) {
    return { score: 3, valid: true };
  }

  // Stage 1 (Systolic 130-139 OR Diastolic 80-89): 2 points
  // If readings fall into different categories, use the higher risk stage
  const systolicStage1 = systolic >= 130 && systolic <= 139;
  const diastolicStage1 = diastolic >= 80 && diastolic <= 89;
  
  if (systolicStage1 || diastolicStage1) {
    return { score: 2, valid: true };
  }

  // Elevated (Systolic 120-129 AND Diastolic <80): 1 point
  // Note: If diastolic is 80-89, it's already caught by Stage 1 above
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
    return { score: 1, valid: true };
  }

  // Normal (Systolic <120 AND Diastolic <80): 0 points
  // This covers all remaining cases where both are normal
  return { score: 0, valid: true };
};

const scoreTemperature = (input?: number | string | null): ScoreResult => {
  // Explicitly check for null/undefined/empty
  if (input === null || input === undefined || input === '') {
    return { score: 0, valid: false };
  }

  const temperature = toFiniteNumber(input);
  if (temperature === null) {
    return { score: 0, valid: false };
  }

  // High Fever (≥101.0°F): 2 points
  if (temperature >= 101.0) {
    return { score: 2, valid: true, value: temperature };
  }

  // Validate reasonable temperature range (80-115°F for human body)
  if (temperature < 80 || temperature > 115) {
    return { score: 0, valid: false };
  }

  // Low Fever (99.6-100.9°F): 1 point
  // Use small epsilon for floating point comparison
  if (temperature >= 99.6 - 0.0001 && temperature <= 100.9 + 0.0001) {
    return { score: 1, valid: true, value: temperature };
  }

  // Normal (≤99.5°F): 0 points
  return { score: 0, valid: true, value: temperature };
};

const scoreAge = (input?: number | string | null): ScoreResult => {
  // Explicitly check for null/undefined/empty
  if (input === null || input === undefined || input === '') {
    return { score: 0, valid: false };
  }

  const age = toFiniteNumber(input);
  if (age === null) {
    return { score: 0, valid: false };
  }

  // Validate reasonable age range (0-150 years)
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

  // Fever: temperature >= 99.6°F (only if temperature is valid)
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

  // Debug: track patients near thresholds
  const nearHighRisk: Array<{id: string, score: number, breakdown: string}> = [];
  const nearFever: Array<{id: string, temp: number | null | undefined}> = [];

  for (const patient of patients) {
    // Skip only if patient_id is completely missing (null, undefined, empty string)
    // Handle both string and number patient IDs
    const patientId = patient.patient_id;
    
    // Check if patient_id is valid (not null, undefined, or empty string)
    if (patientId === null || patientId === undefined) {
      console.warn(`[scoring] Skipping patient with null/undefined patient_id:`, patient);
      continue;
    }
    
    // Reject invalid types (objects, arrays, functions, etc.)
    const validTypes = ['string', 'number', 'boolean'];
    if (!validTypes.includes(typeof patientId)) {
      console.warn(`[scoring] Skipping patient with invalid patient_id type (${typeof patientId}):`, patient);
      continue;
    }
    
    // If it's a string, check if it's empty after trimming
    if (typeof patientId === 'string' && patientId.trim() === '') {
      console.warn(`[scoring] Skipping patient with empty string patient_id:`, patient);
      continue;
    }
    
    // If it's boolean false, reject it (true would become "true" which is weird but valid)
    if (typeof patientId === 'boolean' && patientId === false) {
      console.warn(`[scoring] Skipping patient with boolean false patient_id:`, patient);
      continue;
    }
    
    // If it's a number, 0 is valid (some systems use numeric IDs starting from 0)
    // Negative numbers are invalid
    if (typeof patientId === 'number' && (patientId < 0 || !Number.isFinite(patientId))) {
      console.warn(`[scoring] Skipping patient with invalid numeric patient_id (${patientId}):`, patient);
      continue;
    }

    const profile = buildRiskProfile(patient);

    // High-risk: total score >= 4
    if (profile.totalScore >= 4) {
      highRiskPatients.add(String(profile.patientId));
    } else if (profile.totalScore >= 3) {
      // Track patients close to threshold for debugging
      nearHighRisk.push({
        id: String(profile.patientId),
        score: profile.totalScore,
        breakdown: `BP:${profile.bpScore}+Temp:${profile.temperatureScore}+Age:${profile.ageScore}`
      });
    }

    // Fever: temperature >= 99.6°F (only include if temperature is valid)
    if (profile.hasFever) {
      feverPatients.add(String(profile.patientId));
    } else if (profile.temperatureValue !== null && profile.temperatureValue !== undefined) {
      // Track patients near fever threshold
      if (profile.temperatureValue >= 99.0 && profile.temperatureValue < 99.6) {
        nearFever.push({ id: String(profile.patientId), temp: profile.temperatureValue });
      }
    }

    // Data quality issues: invalid or missing BP, Temp, or Age
    if (profile.hasDataQualityIssue) {
      dataQualityIssues.add(String(profile.patientId));
    }
  }

  // Debug output
  if (nearHighRisk.length > 0) {
    console.log(`[scoring] Found ${nearHighRisk.length} patients with score 3 (near high-risk threshold):`, 
      nearHighRisk.slice(0, 5).map(p => `${p.id}(${p.score}:${p.breakdown})`).join(', '));
  }
  if (nearFever.length > 0) {
    console.log(`[scoring] Found ${nearFever.length} patients with temp 99.0-99.5 (near fever threshold):`,
      nearFever.slice(0, 5).map(p => `${p.id}(${p.temp}°F)`).join(', '));
  }

  // Sort arrays for consistent output
  const sortedHighRisk = Array.from(highRiskPatients).sort();
  const sortedFever = Array.from(feverPatients).sort();
  const sortedDataQuality = Array.from(dataQualityIssues).sort();

  return {
    high_risk_patients: sortedHighRisk,
    fever_patients: sortedFever,
    data_quality_issues: sortedDataQuality,
  };
};
