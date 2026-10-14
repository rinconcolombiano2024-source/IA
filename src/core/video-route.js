"use strict";

function decodeSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function buildVideoUrls(providerId, videoId) {
  const provider = encodeURIComponent(String(providerId || "").trim());
  const id = encodeURIComponent(String(videoId || "").trim());

  if (!provider || !id) {
    return {
      statusUrl: "",
      contentUrl: ""
    };
  }

  const base = "/api/video/" + provider + "/" + id;

  return {
    statusUrl: base + "/status",
    contentUrl: base + "/content"
  };
}

function parseVideoRoute(pathname) {
  const parts = String(pathname || "")
    .split("/")
    .filter(Boolean);

  if (parts[0] !== "api" || parts[1] !== "video") {
    return {
      valid: false,
      legacy: false,
      providerId: "",
      videoId: "",
      action: "status"
    };
  }

  if (parts.length >= 5) {
    const providerId = decodeSegment(parts[2]);
    const videoId = decodeSegment(parts[3]);
    const action = decodeSegment(parts[4]) || "status";

    return {
      valid: Boolean(providerId && videoId),
      legacy: false,
      providerId,
      videoId,
      action
    };
  }

  const videoId = decodeSegment(parts[2]);
  const action = decodeSegment(parts[3]) || "status";

  return {
    valid: Boolean(videoId),
    legacy: true,
    providerId: "",
    videoId,
    action
  };
}

module.exports = {
  buildVideoUrls,
  parseVideoRoute
};
