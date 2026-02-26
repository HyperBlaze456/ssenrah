export interface QAFinding {
  severity: "critical" | "major" | "minor" | "suggestion";
  category: "layout" | "accessibility" | "consistency" | "ux" | "content";
  description: string;
  location?: string;
  suggestion: string;
}

export interface QAReport {
  imagePath: string;
  findings: QAFinding[];
  summary: string;
  analyzedAt: string;
}
