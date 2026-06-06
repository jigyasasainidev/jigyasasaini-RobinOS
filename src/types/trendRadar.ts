// ============================================================
// TREND RADAR — Shared Types
// ============================================================

export interface TrendOpportunity {
  cleanTitle:       string;
  momentumScore:    number;
  freshness:        "6h" | "12h" | "24h" | "48h" | "7d";
  maturityStage:    "Early" | "Rising" | "Hot" | "Saturated" | "Dying";
  confidenceScore:  number;
  whyTrending:      string;
  creatorAngle:     string;
  opportunityType:  "Storytelling" | "Tutorial" | "Reaction" | "Explainer" | "Breakdown" | "Commentary";
  signalPlatforms:  string[];
  firstSeen:        string;
  sourcesCount:     number;
}

export interface TrendScanMetadata {
  scanWindows:  string[];
  sourceSpread: number;
  confidence:   number;
  generatedAt:  string;
  rateLimit:    string;
}

export interface TrendScanResponse {
  success:   true;
  requestId: string;
  data: {
    topic:         string;
    opportunities: TrendOpportunity[];
    metadata:      TrendScanMetadata;
  };
}

export interface TrendScanError {
  success: false;
  requestId?: string;
  error: {
    code:    string;
    message: string;
  };
}

export type TrendScanResult = TrendScanResponse | TrendScanError;

// Derived signal summary used to enrich the script prompt
export interface TrendIntelligence {
  requestId:        string;
  topic:            string;
  topOpportunities: TrendOpportunity[];   // top 3 by momentumScore
  risingAngles:     string[];             // creatorAngle of Rising/Early trends
  viralHooks:       string[];             // whyTrending lines
  lowCompetition:   TrendOpportunity[];   // maturityStage Early or Rising
  sourceSpread:     number;
  confidence:       number;
  isFallback:       boolean;              // true when no live signals
}
