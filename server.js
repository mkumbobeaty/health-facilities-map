require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB制限
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("画像ファイルのみアップロードできます"), false);
    }
  },
});

const CMS_CONFIG = {
  baseUrl: process.env.CMS_BASE_URL || "https://api.cms.reearth.io",
  workspaceId: process.env.CMS_WORKSPACE_ID,
  projectId: process.env.CMS_PROJECT_ID,
  modelId: process.env.CMS_MODEL_ID,
  token: process.env.CMS_INTEGRATION_TOKEN,
};

function checkConfig() {
  const missing = [];
  if (!CMS_CONFIG.workspaceId) missing.push("CMS_WORKSPACE_ID");
  if (!CMS_CONFIG.projectId) missing.push("CMS_PROJECT_ID");
  if (!CMS_CONFIG.modelId) missing.push("CMS_MODEL_ID");
  if (!CMS_CONFIG.token) missing.push("CMS_INTEGRATION_TOKEN");

  if (missing.length > 0) {
    console.warn("⚠️  環境変数が設定されていません:", missing.join(", "));
    console.warn("   .envファイルを作成するか、環境変数を設定してください。");
    console.warn("   POSTリクエストはエラーになります。");
  } else {
    console.log("✓ CMS設定: OK");
    console.log(`  - Base URL: ${CMS_CONFIG.baseUrl}`);
    console.log(`  - Workspace ID: ${CMS_CONFIG.workspaceId}`);
    console.log(`  - Project ID: ${CMS_CONFIG.projectId}`);
    console.log(`  - Model ID: ${CMS_CONFIG.modelId}`);
    console.log(`  - Token: ${CMS_CONFIG.token.substring(0, 10)}...`);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    config: {
      cmsConfigured: !!(CMS_CONFIG.modelId && CMS_CONFIG.token),
    },
  });
});

// 設定状態の確認
app.get("/api/config/status", (req, res) => {
  res.json({
    baseUrl: CMS_CONFIG.baseUrl,
    workspaceId: CMS_CONFIG.workspaceId ? "設定済み" : "未設定",
    projectId: CMS_CONFIG.projectId ? "設定済み" : "未設定",
    modelId: CMS_CONFIG.modelId ? "設定済み" : "未設定",
    token: CMS_CONFIG.token ? "設定済み" : "未設定",
    ready: !!(
      CMS_CONFIG.workspaceId &&
      CMS_CONFIG.projectId &&
      CMS_CONFIG.modelId &&
      CMS_CONFIG.token
    ),
  });
});

// 投稿作成 (Re:Earth CMS Integration APIへ転送)
app.post("/api/facilities", async (req, res) => {
  console.log("[API] POST /api/facilities");
  console.log("[API] Request body:", JSON.stringify(req.body, null, 2));

  // 設定チェック
  if (
    !CMS_CONFIG.workspaceId ||
    !CMS_CONFIG.projectId ||
    !CMS_CONFIG.modelId ||
    !CMS_CONFIG.token
  ) {
    return res.status(500).json({
      error: "Server configuration error",
      message:
        "CMS_WORKSPACE_ID, CMS_PROJECT_ID, CMS_MODEL_ID, CMS_INTEGRATION_TOKEN が設定されていません",
    });
  }

  try {
    const { fields } = req.body;

    if (!fields) {
      return res.status(400).json({
        error: "Bad request",
        message: "fields が必要です",
      });
    }

    // Re:Earth CMS Integration APIへリクエスト
    // エンドポイント: /api/<workspaceID>/projects/<projectID>/models/<modelID>/items
    const cmsUrl = `${CMS_CONFIG.baseUrl}/api/${CMS_CONFIG.workspaceId}/projects/${CMS_CONFIG.projectId}/models/${CMS_CONFIG.modelId}/items`;

    // フィールドをAPI形式に変換
    const apiFields = convertFieldsToApiFormat(fields);
    const requestBody = { fields: apiFields };

    const response = await fetch(cmsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CMS_CONFIG.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "CMS API error",
        status: response.status,
        message: responseText,
      });
    }

    // JSONとしてパース
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    console.log("[API] Item created successfully:", data);
    res.status(201).json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("[API] Error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// アセット（画像）アップロード
// POST /api/assets
app.post("/api/assets", upload.single("file"), async (req, res) => {
  console.log("[API] POST /api/assets");

  // 設定チェック
  if (!CMS_CONFIG.workspaceId || !CMS_CONFIG.projectId || !CMS_CONFIG.token) {
    return res.status(500).json({
      error: "Server configuration error",
      message:
        "CMS_WORKSPACE_ID, CMS_PROJECT_ID, CMS_INTEGRATION_TOKEN が設定されていません",
    });
  }

  // ファイルチェック
  if (!req.file) {
    return res.status(400).json({
      error: "Bad request",
      message: "ファイルがありません",
    });
  }

  console.log("[API] File received:", {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });

  try {
    // Re:Earth CMS Assets APIへリクエスト
    // POST /api/{workspaceId}/projects/{projectId}/assets
    const cmsUrl = `${CMS_CONFIG.baseUrl}/api/${CMS_CONFIG.workspaceId}/projects/${CMS_CONFIG.projectId}/assets`;
    console.log(`testing ${cmsUrl}`);

    // FormDataを作成
    const formData = new FormData();

    // ファイルをBlobとして追加
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    formData.append("file", blob, req.file.originalname);

    // skipDecompressionを追加（画像の場合は通常true）
    formData.append("skipDecompression", "true");

    const response = await fetch(cmsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CMS_CONFIG.token}`,
        // Content-Type は FormData を使用時は自動設定される
      },
      body: formData,
    });

    const responseText = await response.text();
    console.log("[CMS] Response body:", responseText);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "CMS API error",
        status: response.status,
        message: responseText,
      });
    }

    // JSONとしてパース
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    console.log("[API] Asset uploaded successfully:", data);

    // アセットIDとURLを返す
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
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 複数アセットアップロード
// POST /api/assets/multiple
app.post(
  "/api/assets/multiple",
  upload.array("files", 10),
  async (req, res) => {
    console.log("[API] POST /api/assets/multiple");

    // 設定チェック
    if (!CMS_CONFIG.workspaceId || !CMS_CONFIG.projectId || !CMS_CONFIG.token) {
      return res.status(500).json({
        error: "Server configuration error",
        message:
          "CMS_WORKSPACE_ID, CMS_PROJECT_ID, CMS_INTEGRATION_TOKEN が設定されていません",
      });
    }

    // ファイルチェック
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: "Bad request",
        message: "ファイルがありません",
      });
    }

    console.log(`[API] ${req.files.length} files received`);

    const results = [];
    const errors = [];

    // 各ファイルを順番にアップロード
    for (const file of req.files) {
      try {
        console.log(`[API] Uploading: ${file.originalname}`);

        const cmsUrl = `${CMS_CONFIG.baseUrl}/api/${CMS_CONFIG.workspaceId}/projects/${CMS_CONFIG.projectId}/assets`;

        const formData = new FormData();
        const blob = new Blob([file.buffer], { type: file.mimetype });
        formData.append("file", blob, file.originalname);
        formData.append("skipDecompression", "true");

        const response = await fetch(cmsUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${CMS_CONFIG.token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          errors.push({
            fileName: file.originalname,
            status: response.status,
            message: errorText,
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

        console.log(`[API] Uploaded: ${file.originalname} -> ${data.id}`);
      } catch (error) {
        errors.push({
          fileName: file.originalname,
          message: error.message,
        });
      }
    }

    res.status(errors.length === req.files.length ? 500 : 201).json({
      success: errors.length < req.files.length,
      uploaded: results,
      errors: errors.length > 0 ? errors : undefined,
    });
  },
);

// ============================================
// フィールド変換
// ============================================

/**
 * フロントエンドから受け取ったフィールドをRe:Earth CMS API形式に変換
 *
 * ⚠️ 注意: この変換はCMSのスキーマ設定に合わせて調整が必要です
 *
 * Re:Earth CMS Integration APIは以下の形式を受け付けます:
 * - 配列形式: [{ key: 'fieldId', type: 'text', value: '...' }, ...]
 * - オブジェクト形式: { fieldId: value, ... }
 *
 * スキーマに合わせてこの関数を修正してください。
 */
function convertFieldsToApiFormat(fields) {
  const apiFields = [];

  if (fields.name) {
    apiFields.push({ key: "name", type: "text", value: fields.name });
  }

  if (fields.description) {
    apiFields.push({
      key: "description",
      type: "textArea",
      value: fields.description,
    });
  }

  if (fields.category) {
    apiFields.push({ key: "category", type: "select", value: fields.category });
  }

  if (fields.latitude !== undefined && fields.longitude !== undefined) {
    apiFields.push({
      key: "location",
      type: "geometryObject",
      value: JSON.stringify({
        type: "Point",
        coordinates: [fields.longitude, fields.latitude],
      }),
    });
  }

  if (fields.address) {
    apiFields.push({ key: "address", type: "text", value: fields.address });
  }

  if (fields.phone) {
    apiFields.push({ key: "phone", type: "text", value: fields.phone });
  }

  if (typeof fields.isEmergency === "boolean") {
    apiFields.push({
      key: "isEmergency",
      type: "boolean",
      value: fields.isEmergency,
    });
  }

  if (typeof fields.is24Hours === "boolean") {
    apiFields.push({
      key: "is24Hours",
      type: "boolean",
      value: fields.is24Hours,
    });
  }

  if (fields.status) {
    apiFields.push({
      key: "status",
      type: "select",
      value: fields.status,
    });
  }

  if (Array.isArray(fields.services) && fields.services.length > 0) {
    apiFields.push({
      key: "services",
      type: "select",
      value: fields.services,
    });
  }

  if (
    fields.assetIds &&
    Array.isArray(fields.assetIds) &&
    fields.assetIds.length > 0
  ) {
    apiFields.push({
      key: "photos",
      type: "asset",
      value: fields.assetIds,
    });
  }

  return apiFields;
}

// ============================================
// フォールバック: 静的ファイル
// ============================================
app.get("/*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ============================================
// サーバー起動
// ============================================
app.listen(PORT, () => {
  console.log("");
  console.log("========================================");
  console.log("神戸市民投稿マップ サーバー");
  console.log("========================================");
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log("");
  checkConfig();
  console.log("");
  console.log("エンドポイント:");
  console.log(`  GET  /api/health          - ヘルスチェック`);
  console.log(`  GET  /api/config/status   - 設定状態確認`);
  console.log(`  POST /api/assets          - アセット（画像）アップロード`);
  console.log(`  POST /api/assets/multiple - 複数アセットアップロード`);
  console.log(`  POST /api/facilities         - 投稿作成（アセットID含む）`);
  console.log("========================================");
  console.log("");
});
