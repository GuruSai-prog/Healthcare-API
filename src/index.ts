import 'dotenv/config';
import express from 'express';
import { runAssessment } from './assessment';


const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.send('ok'));

app.post('/assessments/run', async (_req, res) => {
  try {
    const result = await runAssessment();
    res.json({
      message: 'Assessment pipeline completed',
      patientCount: result.patientCount,
      submission: result.submission,
    });
  } catch (error) {
    console.error('Assessment run failed', error);
    res.status(500).json({
      error: 'Unable to complete the assessment run',
      detail: (error as Error).message ?? 'unknown error',
    });
  }
});

app.listen(process.env.PORT ?? 3000, () => {
  console.log('Server listening on port', process.env.PORT ?? 3000);
});
