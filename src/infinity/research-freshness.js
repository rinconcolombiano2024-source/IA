"use strict";

/**
 * Evaluate whether a research record needs human review.
 * This does not verify sources or upgrade evidence classifications.
 */
function assessResearchFreshness(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Research metadata must be an object");
  }
  const parseDate = (value, name) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      throw new TypeError(name + " must be an ISO timestamp");
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid " + name);
    return date;
  };
  const now = options.now === undefined ? new Date() : parseDate(options.now, "now");
  const recordedAt = parseDate(input.recordedAt, "recordedAt");
  const reviewAt = parseDate(input.reviewAt, "reviewAt");
  if (reviewAt < recordedAt) throw new RangeError("Review date cannot precede recording");
  const due = now >= reviewAt;
  return Object.freeze({
    reviewDue: due,
    reviewAt: reviewAt.toISOString(),
    assessedAt: now.toISOString(),
    evidenceVerified: false,
    status: due ? "human_review_required" : "awaiting_review",
    notice: "A review date is a scheduling aid, not evidence of scientific validity."
  });
}

module.exports = { assessResearchFreshness };
