# 🌐 The Wiki Game - Frontend

This is the frontend for **The Wiki Game**, built with Next.js and Tailwind CSS.

## 🚀 Features

- **Dynamic Wiki Rendering**: Custom-styled Wikipedia articles with intercepted links.
- **Real-time Updates**: Live leaderboard and chat using Socket.io.
- **Responsive Design**: Fully playable on mobile and desktop.
- **Game Logic**: Handles navigation, click counting, and win conditions.

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **State Management**: React Hooks & Socket.io
- **Text Highlighting**: [mark.js](https://markjs.io/) (for search/hints)

## 🚦 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file in this directory:
```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to see the app.

## 🏗️ Build for Production
```bash
npm run build
npm start
```

---

**Part of [The Wiki Game](https://github.com/sOuL2000s/The-Wiki-Game)**
