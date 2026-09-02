import type { WhisperTranscriptDocument } from "./subtitle-generation";

export const MLSM_POST_LIPSYNC_ANALYSIS_VERSION = "mlsm-post-lipsync-v13";

export type LipsyncConfidenceBand = "high" | "medium" | "low" | "unresolved";
export type LipsyncAnchorOrigin = "automatic" | "subtitle" | "manual";
export type LipsyncSpeedBand = "safe" | "moderate" | "critical";
export type LipsyncAnalysisDetail = "word" | "phoneme";
export type LipsyncAlignmentSource = "subtitles" | "whisper";

export interface CanonicalLyricWord {
  canonicalIndex: number;
  text: string;
  normalizedText: string;
  cueIndex: number;
  cueStartSeconds: number;
  cueEndSeconds: number;
  estimatedStartSeconds: number;
  estimatedEndSeconds: number;
}

export interface LipsyncTimedWord {
  text: string;
  normalizedText: string;
  startSeconds: number;
  centerSeconds: number;
  endSeconds: number;
  confidence: number;
  confidenceSource: "model" | "estimated" | "unknown";
}

export interface LipsyncAlignmentEvidence {
  textSimilarity: number;
  sourceConfidence: number;
  targetConfidence: number;
  subtitlePrior: number;
  sequenceMargin: number;
  audioRefinement?: {
    method: "mfcc-dtw-v1" | "phrase-dtw-v2" | "mfcc-dtw-unresolved";
    shiftMs: number;
    confidence: number;
  };
  visualRefinement?: {
    method: "auto-avsr-ctc-v1";
    shiftMs: number;
    confidence: number;
    originalSourceCenter: number;
  };
}

/** Global overlay of the two isolated vocal waveforms.
 *
 * Measured before any transcript is read, so it is the only timing evidence in
 * the pipeline that neither Whisper nor the local LLM can skew. The mapping is
 * expressed in vocal-stem coordinates:
 * `sourceStemSeconds = scale * targetStemSeconds + offsetSeconds`. */
export interface MlsmWaveformAlignment {
  method: string;
  /** `measured` when the evidence clears every trust threshold, `ambiguous`
   * when it correlates but a bar-length shift explains it equally well. */
  status: "measured" | "ambiguous" | "unmeasurable" | "unavailable" | "disabled";
  detail: string | null;
  trusted: boolean;
  offsetSeconds: number;
  scale: number;
  /** Pearson correlation of the two envelopes over their overlapping span. */
  confidence: number;
  /** How far the winning lag beats the best unrelated one; low on looped music. */
  clarity: number;
  residualMs: number;
  /** 90th-percentile per-window deviation from the global fit. */
  spreadMs: number;
  localAgreement: number;
  windows: number;
  overlapSeconds: number;
  /** Radius the MFCC pass may search once seeded by this overlay; 0 when untrusted. */
  searchRadiusMs: number;
}

export interface LipsyncVisualWordEvent {
  id: string;
  canonicalIndex: number;
  text: string;
  startSeconds: number;
  centerSeconds: number;
  endSeconds: number;
  confidence: number;
  semanticSimilarity: number;
}

export interface LipsyncVisemeEvent {
  canonicalIndex: number;
  label: string;
  visemeClass: string;
  startSeconds: number;
  centerSeconds: number;
  endSeconds: number;
  confidence: number;
}

export interface WordAnchor {
  id: string;
  text: string;
  canonicalIndex: number;
  cueIndex: number;
  sourceStart: number;
  sourceCenter: number;
  sourceEnd: number;
  targetStart: number;
  targetCenter: number;
  targetEnd: number;
  sourceConfidence: number;
  targetConfidence: number;
  matchConfidence: number;
  confidenceBand: LipsyncConfidenceBand;
  origin: LipsyncAnchorOrigin;
  locked: boolean;
  manuallyEdited: boolean;
  evidence: LipsyncAlignmentEvidence;
  sourceTranscriptText: string;
  targetTranscriptText: string;
}

export interface UnresolvedLyricWord {
  canonicalIndex: number;
  text: string;
  reason: "source-missing" | "target-missing" | "both-missing" | "low-confidence" | "non-monotonic";
}

export interface LipsyncSpeedLimits {
  safeMinimum: number;
  safeMaximum: number;
  moderateMinimum: number;
  moderateMaximum: number;
}

export interface LipsyncTimePoint {
  id: string;
  canonicalIndex: number | null;
  sourceTime: number;
  targetTime: number;
  locked: boolean;
  manual: boolean;
}

export interface LipsyncTimeSegment {
  id: string;
  leftPointId: string;
  rightPointId: string;
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
  sourceDuration: number;
  targetDuration: number;
  speedRatio: number;
  speedBand: LipsyncSpeedBand;
  requiresInterpolation: boolean;
  locked: boolean;
  speedOverride: number | null;
}

export interface LipsyncTimeMap {
  version: 1;
  sourceDurationSeconds: number;
  targetDurationSeconds: number;
  points: LipsyncTimePoint[];
  segments: LipsyncTimeSegment[];
  speedLimits: LipsyncSpeedLimits;
}

export interface MlsmPostLipsyncAnalysis {
  analysisVersion: typeof MLSM_POST_LIPSYNC_ANALYSIS_VERSION;
  detailMode: LipsyncAnalysisDetail;
  alignmentSource: LipsyncAlignmentSource;
  localLlmCorrection: {
    enabled: boolean;
    applied: boolean;
    status: "applied" | "exact-constraint" | "no-change" | "unavailable" | "disabled" | "skipped-subtitles";
    recoveredWords: string[];
    model: string | null;
    exactLyrics: string | null;
  };
  waveformAlignment: MlsmWaveformAlignment;
  visualSpeech: {
    enabled: boolean;
    applied: boolean;
    status: "applied" | "no-confident-visemes" | "unavailable" | "disabled";
    provider: "Auto-AVSR" | null;
    model: string | null;
    revision: string | null;
    device: string | null;
    visualTranscript: string;
    faceCoverage: number | null;
    words: LipsyncVisualWordEvent[];
    visemes: LipsyncVisemeEvent[];
    error: string | null;
  };
  sourceDurationSeconds: number;
  targetMasterDurationSeconds: number;
  /** Absolute bounds of the master excerpt physically analyzed. */
  targetAnalysisStartSeconds: number;
  targetAnalysisEndSeconds: number;
  targetAudioStartSeconds: number;
  targetAudioEndSeconds: number;
  targetDurationSeconds: number;
  canonicalLyrics: CanonicalLyricWord[];
  /** Complete word-level Whisper output for the source video and for the whole
   * selected master-analysis range. These documents remain available even when
   * the effective alignment clips `targetTranscript` to a shorter phrase. */
  whisperTranscripts: {
    source: WhisperTranscriptDocument;
    target: WhisperTranscriptDocument;
  };
  sourceTranscript: WhisperTranscriptDocument;
  targetTranscript: WhisperTranscriptDocument;
  anchors: WordAnchor[];
  unresolved: UnresolvedLyricWord[];
  timeMap: LipsyncTimeMap;
  report: LipsyncAnalysisReport;
}

export interface LipsyncAnalysisReport {
  canonicalWords: number;
  matchedWords: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  unresolved: number;
  averageTimingCorrectionMs: number;
  maximumTimingCorrectionMs: number;
  segmentsRequiringInterpolation: number;
  criticalRetimeSegments: number;
  monotonic: boolean;
}

export interface LipsyncGroundTruthWord {
  canonicalIndex: number;
  sourceCenter: number;
  targetCenter: number;
}

export interface LipsyncHardGateResult {
  passed: boolean;
  fps: number;
  matchedCoverage: number;
  medianAnchorErrorFrames: number | null;
  maximumAcceptedAnchorErrorFrames: number | null;
  cacheHit: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

export interface LipsyncRenderFrameSample {
  outputFrameIndex: number;
  targetTime: number;
  sourceTime: number;
  sourceFrameLeft: number;
  sourceFrameRight: number;
  sourceBlend: number;
  durationSeconds: number;
  requiresInterpolation: boolean;
}

export interface LipsyncRenderPlan {
  sourceFps: number;
  outputFps: number;
  targetStart: number;
  targetEnd: number;
  targetAudioStartSeconds: number;
  targetAudioEndSeconds: number;
  outputDurationSeconds: number;
  samples: LipsyncRenderFrameSample[];
}
