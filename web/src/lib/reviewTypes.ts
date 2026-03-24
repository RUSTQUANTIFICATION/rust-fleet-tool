export type ReviewStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "MANUAL_REVIEW"
  | "REUPLOAD_REQUIRED";

export type Severity = "LOW" | "WATCH" | "MODERATE" | "HIGH";

export type RustReviewItem = {
  photo_id: string;
  session_id: string | null;
  vessel_id: string | null;
  vessel_name: string | null;
  area_type: string | null;
  location_tag: string | null;
  image_path: string | null;
  created_at: string | null;

  rust_pct: number | null;
  rust_pct_total: number | null;
  rust_pct_light: number | null;
  rust_pct_moderate: number | null;
  rust_pct_heavy: number | null;
  largest_patch: number | null;
  cluster_count: number | null;
  overall_severity: Severity | null;

  original_image_path: string | null;
  marked_image_path: string | null;
  mask_image_path: string | null;
  analysis_status: string | null;
  confidence_score: number | null;
  image_quality_score: number | null;
  false_positive_risk: number | null;
  manual_review_required: boolean | null;
  raw_warnings: string[] | null;

  review_status: ReviewStatus | null;
  reviewer_name: string | null;
  review_notes: string | null;
  reject_reason: string | null;
  reviewed_at: string | null;
};