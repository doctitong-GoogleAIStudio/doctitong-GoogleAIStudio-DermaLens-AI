export interface ImageQuality {
  score: "Excellent" | "Good" | "Fair" | "Poor" | string;
  feedback: string;
}

export interface MostLikelyDiagnosis {
  conditionName: string;
  confidence: string;
  description: string;
  urgency: string;
  urgencyReason: string;
}

export interface DifferentialDiagnosis {
  conditionName: string;
  confidence: string;
  description: string;
}

export interface Diagnosis {
  imageQuality: ImageQuality;
  mostLikelyDiagnosis: MostLikelyDiagnosis;
  differentialDiagnoses: DifferentialDiagnosis[];
  nextSteps: string[];
  disclaimer: string;
}

export interface HistoryItem {
  id: string;
  createdAt: number;
  date: string;
  images: string[]; // persisted local file uris
  thumbnail: string;
  imageInfo: { name: string; resolution: string };
  diagnosis: Diagnosis;
}

export interface AuthUser {
  id: string;
  full_name: string;
  email: string;
}
