import { fetchAllPatients, submitAssessment } from './client/api';
import { AlertsPayload } from './types';
import { buildAlerts } from './scoring';

export interface AssessmentRunResult {
  alerts: AlertsPayload;
  patientCount: number;
  submission: Record<string, unknown>;
}

export const runAssessment = async (): Promise<AssessmentRunResult> => {
  console.log('[assessment] Starting assessment pipeline...');
  
  console.log('[assessment] Fetching all patients...');
  const patients = await fetchAllPatients();
  console.log(`[assessment] Fetched ${patients.length} patients`);
  
  console.log('[assessment] Building alerts from patient data...');
  const alerts = buildAlerts(patients);
  console.log(`[assessment] High-risk: ${alerts.high_risk_patients.length}, Fever: ${alerts.fever_patients.length}, Data quality issues: ${alerts.data_quality_issues.length}`);
  console.log(`[assessment] High-risk IDs: ${alerts.high_risk_patients.slice(0, 5).join(', ')}${alerts.high_risk_patients.length > 5 ? '...' : ''}`);
  console.log(`[assessment] Fever IDs: ${alerts.fever_patients.slice(0, 5).join(', ')}${alerts.fever_patients.length > 5 ? '...' : ''}`);
  console.log(`[assessment] Data quality issue IDs: ${alerts.data_quality_issues.slice(0, 5).join(', ')}${alerts.data_quality_issues.length > 5 ? '...' : ''}`);
  
  console.log('[assessment] Submitting assessment results...');
  const submission = await submitAssessment(alerts);
  console.log('[assessment] Assessment submission completed');

  return {
    alerts,
    patientCount: patients.length,
    submission,
  };
};
