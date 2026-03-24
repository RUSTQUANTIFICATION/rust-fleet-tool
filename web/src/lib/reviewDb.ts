import { supabaseBrowser } from "./supabaseBrowser";

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export type AnalysisStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | string;

export type ReviewRow = {
  id: string;
  photo_id: string;
  review_status: ReviewStatus;
  reviewer_id: string | null;
  reviewer_name: string | null;
  review_notes: string | null;
  reject_reason: string | null;
  review_category: string | null;
  reupload_required: boolean | null;
  reviewed_at: string | null;
};

export type ReviewPhotoRow = {
  photo_id: string;
  session_id: string | null;
  vessel_id: string | null;
  vessel_name: string;
  area_type: string | null;
  location_tag: string | null;

  image_path: string | null;
  created_at: string | null;

  rust_pct: number;
  rust_pct_total: number;
  rust_pct_light: number;
  rust_pct_moderate: number;
  rust_pct_heavy: number;
  largest_patch: number | null;
  cluster_count: number | null;
  overall_severity: string | null;

  original_image_path: string | null;
  marked_image_path: string | null;
  mask_image_path: string | null;

  analysis_status: AnalysisStatus | null;
  confidence_score: number | null;
  image_quality_score: number | null;
  false_positive_risk: number | null;
  manual_review_required: boolean | null;
  raw_warnings: string[];

  review_id: string | null;
  review_status: ReviewStatus | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  review_notes: string | null;
  reject_reason: string | null;
  review_category: string | null;
  reupload_required: boolean | null;
  reviewed_at: string | null;
};

export type ReviewQueueArgs = {
  vesselId?: string;
  areaType?: string;
  reviewStatus?: ReviewStatus | "ALL";
  analysisStatus?: AnalysisStatus | "ALL";
  severity?: string | "ALL";
  search?: string;
};

const PHOTO_BUCKET = "rust-photos";

function toNumber(value: any, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeWarnings(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x));
  if (typeof value === "string") return [value];
  return [];
}

export async function getSignedImageUrl(path: string | null, expiresIn = 3600) {
  if (!path) return null;

  const sb = supabaseBrowser();
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresIn);

  if (error) {
    console.error("Error creating signed URL:", error);
    return null;
  }

  return data?.signedUrl || null;
}

export async function getSignedImageUrls(
  paths: {
    original_image_path?: string | null;
    marked_image_path?: string | null;
    mask_image_path?: string | null;
    image_path?: string | null;
  },
  expiresIn = 3600
) {
  const originalPath = paths.original_image_path || paths.image_path || null;
  const markedPath = paths.marked_image_path || null;
  const maskPath = paths.mask_image_path || null;

  const [originalUrl, markedUrl, maskUrl] = await Promise.all([
    getSignedImageUrl(originalPath, expiresIn),
    getSignedImageUrl(markedPath, expiresIn),
    getSignedImageUrl(maskPath, expiresIn),
  ]);

  return { originalUrl, markedUrl, maskUrl };
}

export async function getReviewQueue(args?: ReviewQueueArgs): Promise<ReviewPhotoRow[]> {
  const sb = supabaseBrowser();

  const { data: photosData, error: photosError } = await sb
    .from("inspection_photos")
    .select(`
      id,
      session_id,
      vessel_id,
      area_type,
      location_tag,
      image_path,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (photosError) throw photosError;

  const { data: findingsData, error: findingsError } = await sb
    .from("photo_findings")
    .select(`
      photo_id,
      rust_pct,
      rust_pct_total,
      rust_pct_light,
      rust_pct_moderate,
      rust_pct_heavy,
      largest_patch,
      cluster_count,
      overall_severity,
      original_image_path,
      marked_image_path,
      mask_image_path,
      analysis_status,
      confidence_score,
      image_quality_score,
      false_positive_risk,
      manual_review_required,
      raw_warnings
    `);

  if (findingsError) throw findingsError;

  const { data: vesselsData, error: vesselsError } = await sb
    .from("vessels")
    .select("id,name");

  if (vesselsError) throw vesselsError;

  const { data: reviewsData, error: reviewsError } = await sb
    .from("inspection_reviews")
    .select(`
      id,
      photo_id,
      review_status,
      reviewer_id,
      reviewer_name,
      review_notes,
      reject_reason,
      review_category,
      reupload_required,
      reviewed_at
    `);

  if (reviewsError) throw reviewsError;

  const vesselMap = new Map<string, string>();
  (vesselsData || []).forEach((v: any) => {
    vesselMap.set(v.id, v.name);
  });

  const findingMap = new Map<
    string,
    {
      rust_pct: number;
      rust_pct_total: number;
      rust_pct_light: number;
      rust_pct_moderate: number;
      rust_pct_heavy: number;
      largest_patch: number | null;
      cluster_count: number | null;
      overall_severity: string | null;
      original_image_path: string | null;
      marked_image_path: string | null;
      mask_image_path: string | null;
      analysis_status: AnalysisStatus | null;
      confidence_score: number | null;
      image_quality_score: number | null;
      false_positive_risk: number | null;
      manual_review_required: boolean | null;
      raw_warnings: string[];
    }
  >();

  (findingsData || []).forEach((f: any) => {
    findingMap.set(f.photo_id, {
      rust_pct: toNumber(f.rust_pct, 0),
      rust_pct_total: toNumber(f.rust_pct_total ?? f.rust_pct, 0),
      rust_pct_light: toNumber(f.rust_pct_light, 0),
      rust_pct_moderate: toNumber(f.rust_pct_moderate, 0),
      rust_pct_heavy: toNumber(f.rust_pct_heavy, 0),
      largest_patch:
        f.largest_patch === null || f.largest_patch === undefined
          ? null
          : toNumber(f.largest_patch, 0),
      cluster_count:
        f.cluster_count === null || f.cluster_count === undefined
          ? null
          : toNumber(f.cluster_count, 0),
      overall_severity: f.overall_severity || null,
      original_image_path: f.original_image_path || null,
      marked_image_path: f.marked_image_path || null,
      mask_image_path: f.mask_image_path || null,
      analysis_status: f.analysis_status || null,
      confidence_score:
        f.confidence_score === null || f.confidence_score === undefined
          ? null
          : toNumber(f.confidence_score, 0),
      image_quality_score:
        f.image_quality_score === null || f.image_quality_score === undefined
          ? null
          : toNumber(f.image_quality_score, 0),
      false_positive_risk:
        f.false_positive_risk === null || f.false_positive_risk === undefined
          ? null
          : toNumber(f.false_positive_risk, 0),
      manual_review_required:
        typeof f.manual_review_required === "boolean" ? f.manual_review_required : null,
      raw_warnings: normalizeWarnings(f.raw_warnings),
    });
  });

  const reviewMap = new Map<string, ReviewRow>();
  (reviewsData || []).forEach((r: any) => {
    reviewMap.set(r.photo_id, {
      id: r.id,
      photo_id: r.photo_id,
      review_status: r.review_status,
      reviewer_id: r.reviewer_id ?? null,
      reviewer_name: r.reviewer_name ?? null,
      review_notes: r.review_notes ?? null,
      reject_reason: r.reject_reason ?? null,
      review_category: r.review_category ?? null,
      reupload_required:
        typeof r.reupload_required === "boolean" ? r.reupload_required : null,
      reviewed_at: r.reviewed_at ?? null,
    });
  });

  let rows: ReviewPhotoRow[] = (photosData || []).map((p: any) => {
    const f = findingMap.get(p.id);
    const r = reviewMap.get(p.id);

    return {
      photo_id: p.id,
      session_id: p.session_id ?? null,
      vessel_id: p.vessel_id ?? null,
      vessel_name: p.vessel_id ? vesselMap.get(p.vessel_id) || "Unknown Vessel" : "Unknown Vessel",
      area_type: p.area_type ?? null,
      location_tag: p.location_tag ?? null,
      image_path: p.image_path ?? null,
      created_at: p.created_at ?? null,

      rust_pct: f?.rust_pct ?? 0,
      rust_pct_total: f?.rust_pct_total ?? f?.rust_pct ?? 0,
      rust_pct_light: f?.rust_pct_light ?? 0,
      rust_pct_moderate: f?.rust_pct_moderate ?? 0,
      rust_pct_heavy: f?.rust_pct_heavy ?? 0,
      largest_patch: f?.largest_patch ?? null,
      cluster_count: f?.cluster_count ?? null,
      overall_severity: f?.overall_severity ?? null,

      original_image_path: f?.original_image_path ?? p.image_path ?? null,
      marked_image_path: f?.marked_image_path ?? null,
      mask_image_path: f?.mask_image_path ?? null,

      analysis_status: f?.analysis_status ?? null,
      confidence_score: f?.confidence_score ?? null,
      image_quality_score: f?.image_quality_score ?? null,
      false_positive_risk: f?.false_positive_risk ?? null,
      manual_review_required: f?.manual_review_required ?? null,
      raw_warnings: f?.raw_warnings ?? [],

      review_id: r?.id ?? null,
      review_status: r?.review_status ?? null,
      reviewer_id: r?.reviewer_id ?? null,
      reviewer_name: r?.reviewer_name ?? null,
      review_notes: r?.review_notes ?? null,
      reject_reason: r?.reject_reason ?? null,
      review_category: r?.review_category ?? null,
      reupload_required: r?.reupload_required ?? null,
      reviewed_at: r?.reviewed_at ?? null,
    };
  });

  if (args?.vesselId) {
    rows = rows.filter((x) => x.vessel_id === args.vesselId);
  }

  if (args?.areaType && args.areaType !== "ALL") {
    rows = rows.filter((x) => x.area_type === args.areaType);
  }

  if (args?.reviewStatus && args.reviewStatus !== "ALL") {
    if (args.reviewStatus === "PENDING") {
      rows = rows.filter((x) => !x.review_status || x.review_status === "PENDING");
    } else {
      rows = rows.filter((x) => x.review_status === args.reviewStatus);
    }
  }

  if (args?.analysisStatus && args.analysisStatus !== "ALL") {
    rows = rows.filter((x) => (x.analysis_status || "PENDING") === args.analysisStatus);
  }

  if (args?.severity && args.severity !== "ALL") {
    rows = rows.filter((x) => (x.overall_severity || "").toUpperCase() === args.severity);
  }

  if (args?.search?.trim()) {
    const search = args.search.trim().toLowerCase();

    rows = rows.filter((x) => {
      const haystack = [
        x.vessel_name,
        x.area_type,
        x.location_tag,
        x.session_id,
        x.overall_severity,
        x.review_status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }

  return rows;
}

export async function upsertInspectionReview(args: {
  photoId: string;
  reviewStatus: ReviewStatus;
  reviewerId?: string | null;
  reviewerName?: string | null;
  reviewNotes?: string | null;
  rejectReason?: string | null;
  reviewCategory?: string | null;
}) {
  const sb = supabaseBrowser();

  const normalizedStatus: ReviewStatus =
    args.reviewStatus === "APPROVED"
      ? "APPROVED"
      : args.reviewStatus === "REJECTED"
      ? "REJECTED"
      : "PENDING";

  const payload = {
    photo_id: args.photoId,
    review_status: normalizedStatus,
    reviewer_id: args.reviewerId ?? null,
    reviewer_name: args.reviewerName ?? null,
    review_notes: args.reviewNotes ?? null,
    reject_reason: normalizedStatus === "REJECTED" ? args.rejectReason ?? null : null,
    review_category: args.reviewCategory ?? null,
    reupload_required: normalizedStatus === "REJECTED",
    reviewed_at: new Date().toISOString(),
  };

  const { data: existing, error: findError } = await sb
    .from("inspection_reviews")
    .select("id")
    .eq("photo_id", args.photoId)
    .maybeSingle();

  if (findError) throw findError;

  if (existing?.id) {
    const { data, error } = await sb
      .from("inspection_reviews")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await sb
    .from("inspection_reviews")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getReviewSummaryCounts() {
  const rows = await getReviewQueue({ reviewStatus: "ALL" });

  return {
    total: rows.length,
    pending: rows.filter((x) => !x.review_status || x.review_status === "PENDING").length,
    approved: rows.filter((x) => x.review_status === "APPROVED").length,
    rejected: rows.filter((x) => x.review_status === "REJECTED").length,
    reuploadRequired: rows.filter((x) => x.reupload_required === true).length,
  };
}