require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// Accept image uploads up to 10MB in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Re:Earth CMS connection config from environment variables
const CMS_CONFIG = {
  baseUrl: process.env.CMS_BASE_URL || "https://api.cms.reearth.io",
  workspaceId: process.env.CMS_WORKSPACE_ID,
  projectId: process.env.CMS_PROJECT_ID,
  modelId: process.env.CMS_MODEL_ID,
  token: process.env.CMS_INTEGRATION_TOKEN,
};

// Warn on startup if required env vars are missing
function checkConfig() {
  const missing = [];
  if (!CMS_CONFIG.workspaceId) missing.push("CMS_WORKSPACE_ID");
  if (!CMS_CONFIG.projectId) missing.push("CMS_PROJECT_ID");
  if (!CMS_CONFIG.modelId) missing.push("CMS_MODEL_ID");
  if (!CMS_CONFIG.token) missing.push("CMS_INTEGRATION_TOKEN");

  if (missing.length > 0) {
    console.warn("Missing env vars:", missing.join(", "));
    console.warn("POST requests will fail until these are set.");
  } else {
    console.log("✓ CMS config OK");
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    config: {
      cmsConfigured: !!(CMS_CONFIG.modelId && CMS_CONFIG.token),
    },
  });
});

// Returns which CMS env vars are set
app.get("/api/config/status", (req, res) => {
  res.json({
    baseUrl: CMS_CONFIG.baseUrl,
    workspaceId: CMS_CONFIG.workspaceId ? "set" : "missing",
    projectId: CMS_CONFIG.projectId ? "set" : "missing",
    modelId: CMS_CONFIG.modelId ? "set" : "missing",
    token: CMS_CONFIG.token ? "set" : "missing",
    ready: !!(
      CMS_CONFIG.workspaceId &&
      CMS_CONFIG.projectId &&
      CMS_CONFIG.modelId &&
      CMS_CONFIG.token
    ),
  });
});

// Create a new facility item in Re:Earth CMS
app.post("/api/facilities", async (req, res) => {
  if (
    !CMS_CONFIG.workspaceId ||
    !CMS_CONFIG.projectId ||
    !CMS_CONFIG.modelId ||
    !CMS_CONFIG.token
  ) {
    return res.status(500).json({
      error: "Server configuration error",
      message:
        "CMS_WORKSPACE_ID, CMS_PROJECT_ID, CMS_MODEL_ID, CMS_INTEGRATION_TOKEN are not set",
    });
  }

  const { fields } = req.body;
  if (!fields) {
    return res
      .status(400)
      .json({ error: "Bad request", message: "fields is required" });
  }

  try {
    const cmsUrl = `${CMS_CONFIG.baseUrl}/api/${CMS_CONFIG.workspaceId}/projects/${CMS_CONFIG.projectId}/models/${CMS_CONFIG.modelId}/items`;
    const response = await fetch(cmsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CMS_CONFIG.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields: convertFieldsToApiFormat(fields) }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        error: "CMS API error",
        status: response.status,
        message: responseText,
      });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("[API] Error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
});

// Delete a facility item from Re:Earth CMS
app.delete("/api/facilities/:itemId", async (req, res) => {
  if (!CMS_CONFIG.workspaceId || !CMS_CONFIG.projectId || !CMS_CONFIG.token) {
    return res.status(500).json({
      error: "Server configuration error",
      message:
        "CMS_WORKSPACE_ID, CMS_PROJECT_ID, CMS_INTEGRATION_TOKEN are not set",
    });
  }
  const { itemId } = req.params;

  const cmsUrl = `${CMS_CONFIG.baseUrl}/api/${CMS_CONFIG.workspaceId}/projects/${CMS_CONFIG.projectId}/models/${CMS_CONFIG.modelId}/items/${itemId}`;

  try {
    const response = await fetch(cmsUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${CMS_CONFIG.token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      return res.status(response.status).json({
        error: "CMS API error",
        status: response.status,
        message: responseText,
      });
    }

    res.status(200).json({ success: true, id: itemId });
  } catch (error) {
    console.error("[API] Error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
});

// Upload a single image asset to Re:Earth CMS
app.post("/api/assets", upload.single("file"), async (req, res) => {
  if (!CMS_CONFIG.workspaceId || !CMS_CONFIG.projectId || !CMS_CONFIG.token) {
    return res.status(500).json({
      error: "Server configuration error",
      message:
        "CMS_WORKSPACE_ID, CMS_PROJECT_ID, CMS_INTEGRATION_TOKEN are not set",
    });
  }

  if (!req.file) {
    return res
      .status(400)
      .json({ error: "Bad request", message: "No file provided" });
  }

  try {
    const cmsUrl = `${CMS_CONFIG.baseUrl}/api/${CMS_CONFIG.workspaceId}/projects/${CMS_CONFIG.projectId}/assets`;

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname,
    );
    formData.append("skipDecompression", "true");

    const response = await fetch(cmsUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${CMS_CONFIG.token}` },
      body: formData,
    });

    const responseText = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        error: "CMS API error",
        status: response.status,
        message: responseText,
      });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    res.status(201).json({
      success: true,
      data: {
        id: data.id,
        url: data.url,
        fileName: data.fileName || req.file.originalname,
        contentType: data.contentType || req.file.mimetype,
        ...data,
      },
    });
  } catch (error) {
    console.error("[API] Error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
});

// Upload multiple image assets (up to 10) to Re:Earth CMS
app.post(
  "/api/assets/multiple",
  upload.array("files", 10),
  async (req, res) => {
    if (!CMS_CONFIG.workspaceId || !CMS_CONFIG.projectId || !CMS_CONFIG.token) {
      return res.status(500).json({
        error: "Server configuration error",
        message:
          "CMS_WORKSPACE_ID, CMS_PROJECT_ID, CMS_INTEGRATION_TOKEN are not set",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ error: "Bad request", message: "No files provided" });
    }

    const results = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const cmsUrl = `${CMS_CONFIG.baseUrl}/api/${CMS_CONFIG.workspaceId}/projects/${CMS_CONFIG.projectId}/assets`;

        const formData = new FormData();
        formData.append(
          "file",
          new Blob([file.buffer], { type: file.mimetype }),
          file.originalname,
        );
        formData.append("skipDecompression", "true");

        const response = await fetch(cmsUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${CMS_CONFIG.token}` },
          body: formData,
        });

        if (!response.ok) {
          errors.push({
            fileName: file.originalname,
            status: response.status,
            message: await response.text(),
          });
          continue;
        }

        const data = await response.json();
        results.push({
          id: data.id,
          url: data.url,
          fileName: data.fileName || file.originalname,
          contentType: data.contentType || file.mimetype,
          ...data,
        });

      } catch (error) {
        errors.push({ fileName: file.originalname, message: error.message });
      }
    }

    res.status(errors.length === req.files.length ? 500 : 201).json({
      success: errors.length < req.files.length,
      uploaded: results,
      errors: errors.length > 0 ? errors : undefined,
    });
  },
);

// Convert flat fields object to Re:Earth CMS Integration API array format:
function convertFieldsToApiFormat(fields) {
  const apiFields = [];

  if (fields.name)
    apiFields.push({ key: "name", type: "text", value: fields.name });

  if (fields.description)
    apiFields.push({
      key: "description",
      type: "textArea",
      value: fields.description,
    });

  if (fields.category)
    apiFields.push({ key: "category", type: "select", value: fields.category });

  if (fields.latitude !== undefined && fields.longitude !== undefined)
    apiFields.push({
      key: "location",
      type: "geometryObject",
      value: JSON.stringify({
        type: "Point",
        coordinates: [fields.longitude, fields.latitude],
      }),
    });

  if (fields.address)
    apiFields.push({ key: "address", type: "text", value: fields.address });

  if (fields.phone)
    apiFields.push({ key: "phone", type: "text", value: fields.phone });

  if (typeof fields.isEmergency === "boolean")
    apiFields.push({
      key: "isEmergency",
      type: "boolean",
      value: fields.isEmergency,
    });

  if (typeof fields.is24Hours === "boolean")
    apiFields.push({
      key: "is24Hours",
      type: "boolean",
      value: fields.is24Hours,
    });

  if (fields.status)
    apiFields.push({ key: "status", type: "select", value: fields.status });

  if (Array.isArray(fields.services) && fields.services.length > 0)
    apiFields.push({ key: "services", type: "select", value: fields.services });

  if (Array.isArray(fields.assetIds) && fields.assetIds.length > 0)
    apiFields.push({ key: "photos", type: "asset", value: fields.assetIds });

  return apiFields;
}

// Serve index.html for all unmatched routes (SPA fallback)
app.get("/*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log("========================================");
  console.log("  Health Services Map Server");
  console.log("========================================");
  console.log(`  http://localhost:${PORT}`);
  console.log("");
  checkConfig();
  console.log("");
  console.log("Endpoints:");
  console.log("  GET  /api/health           Health check");
  console.log("  GET  /api/config/status    CMS config status");
  console.log("  POST /api/assets           Upload single image");
  console.log("  POST /api/assets/multiple  Upload multiple images");
  console.log("  POST   /api/facilities         Create facility item");
  console.log("  DELETE /api/facilities/:id     Delete facility item");
  console.log("========================================");
});
