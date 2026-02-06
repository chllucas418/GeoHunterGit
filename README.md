# GeoHunterGit

GeoHunterGit is a location-guessing game where players identify locations from images and map clues. Deployed on Cloudflare Workers with a D1 database backend, it leverages Google Gemini AI for advanced hint generation and evidence verification.

## 🚀 Features

-   **Interactive Game Mode**: Guess locations based on visual evidence and map clues.
-   **AI-Powered Hints**: Google Gemini analyzes game context to provide subtle, non-spoiler hints.
-   **Evidence Verification**: AI verifies user-submitted screenshots/evidence against database locations.
-   **Admin Dashboard**: Tools for adding locations, uploading images, and managing users.
-   **Leaderboards**: Track top players and scores globally.
-   **User Profiles**: View personal game history and statistics.
-   **Advanced Map Integration**: Seamless interaction with Google Maps for location pinpointing.

## � Tech Stack

-   **Framework**: [React Router v7](https://reactrouter.com/) (formerly Remix)
-   **Language**: TypeScript
-   **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
-   **Runtime**: Cloudflare Workers
-   **Database**: Cloudflare D1 (SQLite)
-   **AI**: Google Gemini (via `@google/generative-ai`)
-   **Maps**: Google Maps JavaScript API

## 📦 Prerequisites

-   Node.js (LTS recommended)
-   [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally or locally.

## ⚡ Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/chllucas418/GeoHunterGit.git
    cd GeoHunterGit
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Environment Setup:**
    Create a `.dev.vars` file in the root directory for local development secrets:
    ```ini
    GEMINI_API_KEY=your_gemini_api_key
    GOOGLE_MAPS_API_KEY=your_google_maps_api_key
    VALUE_FROM_CLOUDFLARE=Hello World
    ```

4.  **Database Migration:**
    Applies D1 migrations to the local database:
    ```bash
    npx wrangler d1 migrations apply geohunter-db --local
    ```

5.  **Start Development Server:**
    ```bash
    npm run dev
    ```
    The app will be available at `http://localhost:5173`.

## 🌐 Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

To deploy a preview version:
```bash
npx wrangler versions upload
```

## 📂 Project Structure

-   `app/routes`: Application routes (Game, Admin, Profile, etc.)
-   `app/lib`: Shared utilities (Gemini client, DB helpers)
-   `migrations`: D1 database migrations
-   `workers`: Cloudflare Worker entry point

---

Built with ❤️ by Lucas.
