# 🌐 The Wiki Game

A fast-paced, multiplayer web game where players race to navigate from a starting Wikipedia article to a target article using only internal links.

### 🎮 [Play the Live Demo](https://the-wiki-game.netlify.app/)

---

## 🚀 Features

- **Real-time Multiplayer**: Create private rooms and compete with friends using Socket.io.
- **Dynamic Content**: Fetches live articles directly from Wikipedia.
- **Optimized Reading**: Custom-cleaned Wikipedia pages that remove distractions (sidebars, ads, etc.) while keeping essential links and images.
- **Smart Hint System**: Stuck? Get AI-powered hints based on semantic overlap and article backlinks.
- **Live Leaderboard**: Track your opponents' progress, click counts, and current location in real-time.
- **Persistence**: Game rooms and states are saved, allowing players to reconnect if they lose their connection.
- **In-game Chat**: Coordinate or trash-talk with other players in your room.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Library**: [React 19](https://react.dev/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Real-time**: [Socket.io Client](https://socket.io/docs/v4/client-api/)

### Backend
- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express](https://expressjs.com/)
- **Real-time**: [Socket.io](https://socket.io/)
- **Web Scraping/Parsing**: [Cheerio](https://cheerio.js.org/) & [Axios](https://axios-http.com/)
- **Persistence**: Local JSON-based storage with auto-backup.

---

## 📦 Installation & Setup

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### 1. Clone the Repository
```bash
git clone https://github.com/sOuL2000s/The-Wiki-Game.git
cd The-Wiki-Game
```

### 2. Setup Backend
```bash
cd wikigame
npm install
npm start
```
The server will start on `http://localhost:3001` (or the port specified in your environment).

### 3. Setup Frontend
```bash
cd wikigame/frontend
npm install
npm run dev
```
The frontend will be available at `http://localhost:3000`.

---

## 📖 How to Play

1. **Create a Room**: Enter your name and create a new game room.
2. **Invite Friends**: Share the Room ID with your friends.
3. **Start the Race**: The host clicks "Start Game". Everyone starts at the same random Wikipedia article.
4. **Navigate**: Click on blue links within the article to move to other pages.
5. **Win**: Be the first to reach the target article!

---

## 🛠️ Development

### Project Structure
- `wikigame/server.js`: Main entry point for the Node.js server. Handles socket events, Wikipedia API fetching, and game logic.
- `wikigame/frontend/app/`: Next.js app directory containing the game UI and logic.
- `wikigame/rooms-data.json`: Local storage for active game sessions.

### Environment Variables
For the frontend, create a `.env` file in `wikigame/frontend/`:
```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

---

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

---

**Built with ❤️ by [sOuL2000s](https://github.com/sOuL2000s)**
