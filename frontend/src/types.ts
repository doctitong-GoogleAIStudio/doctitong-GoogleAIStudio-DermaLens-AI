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
  assessmentPossible?: boolean;
  moreInfoNeeded?: string[];
  mostLikelyDiagnosis: MostLikelyDiagnosis;
  differentialDiagnoses: DifferentialDiagnosis[];
  redFlags?: string[];
  nextSteps: string[];
  disclaimer: string;
}

export interface ClinicalHistory {
  location?: string;
  duration?: string;
  symptoms?: string;
  evolution?: string;
  medicalHistory?: string;
  notes?: string;
}

export const HISTORY_FIELDS: {
  key: keyof ClinicalHistory;
  label: string;
  placeholder: string;
  clinicalLabel: string;
}[] = [
  {
    key: "location",
    label: "Body location",
    placeholder: "e.g. left forearm, upper back",
    clinicalLabel: "Anatomical location",
  },
  {
    key: "duration",
    label: "How long has it been there?",
    placeholder: "e.g. about 3 months",
    clinicalLabel: "Duration",
  },
  {
    key: "symptoms",
    label: "Symptoms",
    placeholder: "e.g. itchy, sometimes bleeds when scratched",
    clinicalLabel: "Symptoms",
  },
  {
    key: "evolution",
    label: "How has it changed?",
    placeholder: "e.g. slowly getting darker and bigger",
    clinicalLabel: "Lesion evolution",
  },
  {
    key: "medicalHistory",
    label: "Relevant medical history",
    placeholder: "e.g. eczema, diabetes, medications",
    clinicalLabel: "Relevant medical history",
  },
  {
    key: "notes",
    label: "Anything else?",
    placeholder: "e.g. new sunscreen, family history of melanoma",
    clinicalLabel: "Additional description",
  },
];

export type AssessmentMode = "quick" | "enhanced";

export interface HistoryItem {
  id: string;
  createdAt: number;
  date: string;
  images: string[]; // persisted local file uris
  thumbnail: string;
  imageInfo: { name: string; resolution: string };
  note?: string;
  mode?: AssessmentMode;
  viewLabels?: string[];
  clinicalHistory?: ClinicalHistory;
  diagnosis: Diagnosis;
}

export interface AuthUser {
  id: string;
  full_name: string;
  email: string;
}
