# health-facilities-map

An Express.js server that serves a frontend map app and proxies requests to **Re:Earth CMS** for managing health facility data (create/delete items, upload images).

---

## Setup & Run

**1. Install dependencies:**
```bash
npm install
```

**2. Configure environment variables**

Copy the example and fill in your values:
```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3000                                    # optional, defaults to 3000
CMS_BASE_URL=https://api.cms.reearth.io     # optional, this is the default
CMS_WORKSPACE_ID=<your workspace id>
CMS_PROJECT_ID=<your project id>
CMS_MODEL_ID=<your model id>
CMS_INTEGRATION_TOKEN=<your integration token>
```

**3. Start the server:**
```bash
npm start
```

The app will be available at **http://localhost:3000**

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/config/status` | Check which CMS env vars are set |
| `POST` | `/api/assets` | Upload a single image (form field: `file`) |
| `POST` | `/api/assets/multiple` | Upload up to 10 images (form field: `files`) |
| `POST` | `/api/facilities` | Create a facility item in Re:Earth CMS |
| `DELETE` | `/api/facilities/:id` | Delete a facility item |

The frontend (`public/index.html`) is served as a SPA at `/`.
