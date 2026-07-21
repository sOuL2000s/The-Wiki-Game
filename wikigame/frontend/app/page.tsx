// frontend\app\page.tsx
"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('');
  const [userError, setUserError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const router = useRouter();

  const validateUser = (u: string) => {
    const userRegex = /^[a-zA-Z0-9]{3,15}$/;
    if (u.length > 0 && !userRegex.test(u)) {
      if (u.length < 3) setUserError('Username must be at least 3 characters.');
      else setUserError('Only alphanumeric characters allowed.');
      return false;
    }
    setUserError(null);
    return true;
  };

  const validateRoom = (r: string) => {
    const roomRegex = /^[0-9]{3,10}$/;
    if (r.length > 0 && !roomRegex.test(r)) {
      if (r.length < 3) setRoomError('Room code must be at least 3 digits.');
      else setRoomError('Room code must be numbers only.');
      return false;
    }
    setRoomError(null);
    return true;
  };

  const handleJoin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const isUserValid = validateUser(username) && username.length >= 3;
    const isRoomValid = validateRoom(room) && room.length >= 3;

    if (isUserValid && isRoomValid) {
      setIsJoining(true);
      router.push(`/game/${room}?user=${username}`);
    } else {
      if (!isUserValid && username.length < 3) setUserError('Username is too short.');
      if (!isRoomValid && room.length < 3) setRoomError('Room code is too short.');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4 dark:from-slate-900 dark:to-slate-800">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.svg" alt="WikiRace Logo" className="w-20 h-20 mb-4 drop-shadow-md" />
          <h1 className="text-4xl font-bold text-center text-blue-600 dark:text-blue-400 tracking-tight">WikiRace</h1>
        </div>
        <p className="text-center text-slate-600 dark:text-slate-300 mb-8 font-medium">Race to the goal article in the fewest clicks!</p>
        
        <form onSubmit={handleJoin} className="space-y-6">
          <div className="space-y-1">
            <input
              type="text"
              placeholder="Your Username"
              className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 dark:bg-slate-700 dark:text-white ${userError ? 'border-red-400 bg-red-50 dark:bg-red-900/10' : 'border-slate-300 dark:border-slate-600'}`}
              value={username}
              onChange={(e) => {
                const val = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
                setUsername(val);
                validateUser(val);
              }}
              maxLength={15}
            />
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${userError ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0'}`}>
              <p className="text-red-500 text-xs font-semibold px-1">{userError}</p>
            </div>
          </div>

          <div className="space-y-1">
            <input
              type="text"
              placeholder="Room Code (Numbers only)"
              className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 dark:bg-slate-700 dark:text-white ${roomError ? 'border-red-400 bg-red-50 dark:bg-red-900/10' : 'border-slate-300 dark:border-slate-600'}`}
              value={room}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '');
                setRoom(val);
                validateRoom(val);
              }}
              maxLength={10}
            />
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${roomError ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0'}`}>
              <p className="text-red-500 text-xs font-semibold px-1">{roomError}</p>
            </div>
          </div>
          <button
            type="submit"
            disabled={!username.trim() || !room.trim() || isJoining}
            className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {isJoining ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="animate-spin" size={18} />
                Joining Race...
              </span>
            ) : (
              'Enter Race'
            )}
          </button>
        </form>
      </div>
    </main>
  );
}