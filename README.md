# SmartPark Frontend Web Client

<p align="center">
  <img src="https://img.shields.io/badge/UI-Bootstrap%205.3-7952B3.svg" alt="Bootstrap 5" />
  <img src="https://img.shields.io/badge/JavaScript-Vanilla%20ES6+-F7DF1E.svg" alt="JavaScript ES6+" />
  <img src="https://img.shields.io/badge/Charts-Chart.js%204.4-FF6384.svg" alt="Chart.js" />
  <img src="https://img.shields.io/badge/Deployment-Vercel-black.svg" alt="Vercel" />
  <img src="https://img.shields.io/badge/Proxy-Rewrites%20Enabled-success.svg" alt="Vercel Proxy" />
</p>

> **SmartPark – Smart Parking Management System Client**  
> *Tagline: Park Smarter | Save Time | Move Better*

The responsive Single-Page Application (SPA) web interface for SmartPark. Connects Drivers, Parking Operators, and Administrators with the backend service. Designed for zero-latency user flows, interactive occupancy grids, real-time bay search, digital QR pass rendering, and executive analytics.

---

## 🎨 Design & Palette System

- **Primary Brand Theme:** Deep Navy Blue (`#1e3a8a`) & Vibrant Emerald Green (`#10b981`)
- **Accents:** Warning Amber (`#f59e0b`) & Neutral Slate (`#f8fafc`)
- **Typography:** Inter (via Google Fonts) with high-legibility tabular monospace fonts for license plates and codes.
- **Icons:** Bootstrap Icons 1.11+

---

## 🚀 Key Client Modules

### 🚗 Driver Portal
- **Instant Search:** Filter slots by Floor, Zone, and Vehicle Type (Car, Bike, EV, Truck).
- **One-Click Reservation:** Calculate duration charges and lock in slots.
- **Digital Pass Modal:** Scannable Base64 QR code with booking references.
- **Multi-Vehicle Garage:** Register and switch between owned vehicles.

### 👷 Operator Console
- **Visual Occupancy Bay Grid:** Color-coded status tiles (Green = Available, Amber = Reserved, Red = Occupied).
- **Gate Check-In & Check-Out:** Direct gate arrival validation and automatic duration checkout billing.

### 🛡️ Admin Dashboard
- **Chart.js Visualizations:** 7-Day revenue trends and zone occupancy distributions.
- **User Governance:** Inspect active users, roles, and toggle access states.

---

## ⚡ Quick Start (Local Development)

You can serve this frontend with any static HTTP server:

```bash
# Option 1: Python 3
python -m http.server 3000

# Option 2: Node.js (npx serve)
npx serve . -p 3000
```
Open **http://localhost:3000** in your browser.  
In local dev mode, requests automatically route to `http://localhost:8080/api`.

---

## ☁️ Deployment on Vercel

### Method 1: GitHub Integration (Recommended)
1. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New...** ➔ **Project**.
2. Select your repository: `suraj718549-cmyk/smartpark-frontend`.
3. In **Project Settings**:
   - Framework Preset: **Other**
   - Root Directory: `./` (root of this repository)
4. Click **Deploy**.
5. Vercel automatically reads `vercel.json`, sets up CORS headers, and proxies `/api/*` requests to your Render backend with zero CORS friction!

---

## ⚙️ Environment / Backend Proxy Configuration

In `vercel.json`, the `/api` proxy rule forwards all requests to the Render backend:

```json
{
  "version": 2,
  "cleanUrls": true,
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "https://smartpark-backend.onrender.com/api/:match*"
    }
  ]
}
```

*To connect to a custom backend, open the web app, click **Backend API** in the navigation bar, paste your custom URL, and click **Test**.*

---

## 📄 License
Distributed under the MIT License.