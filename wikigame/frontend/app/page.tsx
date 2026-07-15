// frontend\app\page.tsx
"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('');
  const router = useRouter();

  const handleJoin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (username && room) {
      router.push(`/game/${room}?user=${username}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4 dark:from-slate-900 dark:to-slate-800">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700">
        <h1 className="text-4xl font-bold text-center mb-8 text-blue-600 dark:text-blue-400 tracking-tight">WikiRace</h1>
        <p className="text-center text-slate-600 dark:text-slate-300 mb-6">Race to the goal article in the fewest clicks!</p>
        <form onSubmit={handleJoin} className="space-y-4">
          <input
            type="text"
            placeholder="Your Username"
            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="text"
            placeholder="Room Code (e.g. 123)"
            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <button
            type="submit"
            disabled={!username || !room}
            className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            Enter Race
          </button>
        </form>
      </div>
    </main>
  );
}