# Trạm Đọc v1.2 (Audiobook)

A premium web-based ebook and audiobook reader with high-quality Vietnamese Text-to-Speech (TTS) integration. Designed for a cinematic reading and listening experience.

![Dashboard Preview](https://via.placeholder.com/800x450?text=Tram+Doc+Dashboard)

## ✨ Features

- **Cinematic Reader**: Custom-built EPUB reader with beautiful typography (Amazon Bookerly support) and smooth transitions.
- **High-Quality TTS**: Integrated Google Cloud Text-to-Speech with a curated selection of natural-sounding Vietnamese voices.
- **Dynamic Audio Generation**: Segments are generated on-demand with intelligent lookahead caching for seamless playback.
- **Multi-Theme Support**: Midnight, OLED, Sepia, and more to suit any lighting condition.
- **Offline Mode**: Save your books and generated audio locally using IndexedDB and Cache API for reading anywhere.
- **Progress Sync**: Automatic synchronization of your reading progress and bookmarks across devices.
- **Cinematic UI**: Vibrant visuals, glassmorphism effects, and premium micro-animations.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, TailwindCSS, Framer Motion, Axios, Chart.js.
- **Backend**: Node.js, Express, Prisma ORM, JWT Authentication, Passport.js (Google OAuth).
- **Database**: SQLite (default) / PostgreSQL support.
- **Storage**: Local filesystem for audio/covers, with automatic cleanup.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or later)
- Google Cloud Platform account with Text-to-Speech API enabled.

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/audiobook.git
   cd audiobook
   ```

2. **Setup Server**:
   ```bash
   cd server
   npm install
   cp .env.example .env
   # Fill in your GOOGLE_CLOUD_API_KEY and other credentials in .env
   npx prisma db push
   ```

3. **Setup Client**:
   ```bash
   cd ../client
   npm install
   cp .env.example .env
   ```

### Running Locally

1. **Start the server**:
   ```bash
   cd server
   npm run dev
   ```

2. **Start the client**:
   ```bash
   cd client
   npm run dev
   ```

The application will be available at `http://localhost:5173`.

## 📂 Project Structure

- `/client`: Frontend React application.
- `/server`: Node.js backend API.
  - `/lib`: Core singletons (TTS, EPUB, Prisma).
  - `/routes`: Modular route handlers.
  - `/services`: Heavy-duty logic (EPUB processing, TTS synthesis).
  - `/prisma`: Database schema and migrations.

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---
Developed by [Phong Nguyen](https://github.com/phongalahan)
