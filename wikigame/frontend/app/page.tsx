// frontend/app/page.tsx
"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, Trophy, Users } from 'lucide-react';

export default function Home() {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('');
  const [userError, setUserError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [particles, setParticles] = useState<Array<{
    left: string;
    animationDelay: string;
    animationDuration: string;
    width: string;
    height: string;
  }>>([]);
  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();

  // Generate particles only on client side
  useEffect(() => {
    setIsMounted(true);
    const newParticles = Array.from({ length: 30 }, () => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 20}s`,
      animationDuration: `${15 + Math.random() * 20}s`,
      width: `${2 + Math.random() * 4}px`,
      height: `${2 + Math.random() * 4}px`,
    }));
    setParticles(newParticles);

    // Generate username suggestions here as well, since they also involve Math.random()
    const suggestions = [
      'WikiRacer',
      'SpeedReader',
      'LinkHunter',
      'ArticleExplorer',
      'KnowledgeSeeker',
      'PageNavigator',
      'InfoGatherer',
      'FactFinder',
      'LinkJumper',
      'RaceMaster'
    ];
    const shuffled = suggestions.sort(() => Math.random() - 0.5);
    setUsernameSuggestions(shuffled.slice(0, 3));
  }, []); // Empty dependency array means this runs once on client mount

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

  // Don't render particles on server, only on client
  const renderParticles = () => {
    if (!isMounted) return null; // Only render particles after client mount
    return particles.map((particle, i) => (
      <div
        key={i}
        className="particle"
        style={{
          left: particle.left,
          animationDelay: particle.animationDelay,
          animationDuration: particle.animationDuration,
          width: particle.width,
          height: particle.height,
        }}
      />
    ));
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      {/* Background particles - only render on client */}
      <div className="particles-container">
        {renderParticles()}
      </div>

      <div className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="glass rounded-3xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="relative">
              <div className="pulse-ring rounded-full">
                <img src="/logo.svg" alt="WikiRace Logo" className="w-24 h-24 mb-4 drop-shadow-2xl" />
              </div>
              <Sparkles className="absolute -top-2 -right-2 text-yellow-400 animate-pulse" size={24} />
            </div>
            <h1 className="text-5xl font-black text-center bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent tracking-tight">
              WikiRace
            </h1>
            <p className="text-center text-white/60 mt-2 text-sm font-medium">
              Race through Wikipedia in the fewest clicks!
            </p>
          </div>
          
          <form onSubmit={handleJoin} className="space-y-5">
            <div className="space-y-1">
              <label className="text-sm font-medium text-white/70 block mb-1">
                Choose your racer name
              </label>
              <input
                type="text"
                placeholder="Enter username..."
                className={`w-full p-3.5 rounded-xl glass transition-all duration-200 outline-none text-white placeholder-white/30
                  ${userError ? 'border-red-400 ring-2 ring-red-400/30' : 'focus:ring-2 focus:ring-blue-400/50'}`}
                value={username}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
                  setUsername(val);
                  validateUser(val);
                }}
                maxLength={15}
              />
              {isMounted && usernameSuggestions.length > 0 && !username && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <span className="text-xs text-white/40">Try:</span>
                  {usernameSuggestions.map(suggestion => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setUsername(suggestion)}
                      className="text-xs px-2 py-1 rounded-full glass hover:bg-white/10 transition-colors text-white/60 hover:text-white"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              <div className={`overflow-hidden transition-all duration-300 ease-in-out ${userError ? 'max-h-10 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                <p className="text-red-400 text-xs font-semibold px-1">{userError}</p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-white/70 block mb-1">
                Room Code
              </label>
              <input
                type="text"
                placeholder="Enter 3-10 digit room code..."
                className={`w-full p-3.5 rounded-xl glass transition-all duration-200 outline-none text-white placeholder-white/30
                  ${roomError ? 'border-red-400 ring-2 ring-red-400/30' : 'focus:ring-2 focus:ring-blue-400/50'}`}
                value={room}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  setRoom(val);
                  validateRoom(val);
                }}
                maxLength={10}
              />
              <div className={`overflow-hidden transition-all duration-300 ease-in-out ${roomError ? 'max-h-10 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                <p className="text-red-400 text-xs font-semibold px-1">{roomError}</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={!username.trim() || !room.trim() || isJoining}
              className="w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 relative overflow-hidden group
                disabled:opacity-50 disabled:cursor-not-allowed
                bg-gradient-to-r from-blue-500 to-purple-500 hover:shadow-lg hover:shadow-blue-500/30"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {isJoining ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Joining Race...
                  </>
                ) : (
                  <>
                    <Users size={18} />
                    Enter Race
                    <Trophy className="text-yellow-300" size={16} />
                  </>
                )}
              </span>
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-white/30">
              🏁 Race against others to reach the goal article first!
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}