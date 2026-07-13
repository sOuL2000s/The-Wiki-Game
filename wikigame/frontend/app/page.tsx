"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('');
  const router = useRouter();

  const handleJoin = () => {
    if (username && room) {
      router.push(`/game/${room}?user=${username}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg border border-slate-200">
        <h1 className="text-4xl font-bold text-center mb-8 text-blue-600 tracking-tight">WikiRace</h1>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-400 outline-none transition-all"
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="text"
            placeholder="Room Code (e.g. 123)"
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-400 outline-none transition-all"
            onChange={(e) => setRoom(e.target.value)}
          />
          <button
            onClick={handleJoin}
            className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Enter Race
          </button>
        </div>
      </div>
    </main>
  );
}
