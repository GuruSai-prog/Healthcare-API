import { fetchAllPatients, submitAssessment } from './client/api';
import { AlertsPayload } from './types';
import { buildAlerts } from './scoring';

export interface AssessmentRunResult {
  alerts: AlertsPayload;
  patientCount: number;
  submission: Record<string, unknown>;
}

export const runAssessment = async (): Promise<AssessmentRunResult> => {
  const patients = await fetchAllPatients();
  const alerts = buildAlerts(patients);
  const submission = await submitAssessment(alerts);

  return {
    alerts,
    patientCount: patients.length,
    submission,
  };
};
