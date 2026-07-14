// frontend\app\game\[roomId]\page.tsx
"use client";
import React, { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import io from 'socket.io-client';
import { ExternalLink, Loader2, Trophy } from 'lucide-react'; // Import icons

let socket: any;

interface Player {
  id: string;
  username: string;
  currentArticle: string;
  history: string[];
  clicks: number;
  finished: boolean;
  time?: number;
}

interface RoomData {
  players: { [key: string]: Player };
  startArticle: string;
  goalArticle: string;
  status: 'waiting' | 'playing' | 'finished'; // Added 'finished' for clarity
  startTime?: number;
}

interface ArticleSummary {
  title: string;
  extract: string;
  content_urls: {
    desktop: {
      page: string;
    };
  };
}

export default function Game({ params }: { params: Promise<{ roomId: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.roomId;
  
  const searchParams = useSearchParams();
  const username = searchParams.get('user');
  
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [html, setHtml] = useState<string>("");
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [articleFetchError, setArticleFetchError] = useState<string | null>(null);
  const [goalArticleSummary, setGoalArticleSummary] = useState<ArticleSummary | null>(null);

  // Initialize socket connection and join room
  useEffect(() => {
    socket = io('http://localhost:3001');
    socket.emit('joinRoom', { roomId, username });

    socket.on('roomUpdate', (data: RoomData) => {
      setRoomData(data);
    });

    return () => {
        socket.disconnect();
    };
  }, [roomId, username]);

  // Fetch current article content
  useEffect(() => {
    const fetchContent = async () => {
      const me = roomData?.players[socket.id];
      if (me && !me.finished && roomData?.status === 'playing') {
        setLoadingArticle(true);
        setArticleFetchError(null); // Clear previous errors
        try {
            const res = await fetch(`http://localhost:3001/api/wiki/${encodeURIComponent(me.currentArticle)}`);
            if (!res.ok) { // IMPORTANT: Check if response is OK
                const errorData = await res.json(); // Backend now sends JSON for errors
                throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
            }
            const data = await res.json();
            setHtml(data.html);
        } catch (e: any) {
            console.error("Fetch article content error:", e.message);
            setArticleFetchError(`Failed to load article: ${e.message}. Try another link.`);
            setHtml(`<div class="text-red-500 font-semibold text-center mt-8">${articleFetchError}</div>`);
        }
        setLoadingArticle(false);
        window.scrollTo(0, 0);
      }
    };
    fetchContent();
  }, [roomData?.players?.[socket?.id]?.currentArticle, roomData?.status]); // Re-fetch if status changes to playing

  // Fetch goal article summary
  useEffect(() => {
    const fetchSummary = async () => {
      if (roomData?.goalArticle && !goalArticleSummary) { // Fetch only once
        try {
          const res = await fetch(`http://localhost:3001/api/wiki-summary/${encodeURIComponent(roomData.goalArticle)}`);
          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
          }
          const summary = await res.json();
          setGoalArticleSummary(summary);
        } catch (e: any) {
          console.error("Fetch goal summary error:", e.message);
          // Optionally, set an error state for the goal summary display
        }
      }
    };
    fetchSummary();
  }, [roomData?.goalArticle, goalArticleSummary]);


  const handleWikiClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    
    // Only proceed if it's a valid link and not trying to navigate while finished or loading
    if (anchor && !loadingArticle && roomData?.status === 'playing' && !roomData.players[socket.id]?.finished) {
      e.preventDefault();
      const href = anchor.getAttribute('href');
      // Ensure it's an internal Wikipedia link by checking href and title
      if (href && href.startsWith('/wiki/')) {
        const title = anchor.getAttribute('title') || href.replace('/wiki/', '');
        socket.emit('navigate', { roomId, targetTitle: title });
      }
    }
  };

  if (!roomData) return (
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-sans text-xl">
      <Loader2 className="animate-spin mr-3 text-blue-500" size={24} /> Connecting to lobby...
    </div>
  );

  const me = roomData.players[socket.id];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 font-sans">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white p-4 flex flex-col md:flex-row justify-between items-center sticky top-0 z-50 shadow-lg dark:from-slate-800 dark:to-slate-900">
        <div className="text-center md:text-left mb-3 md:mb-0">
          <p className="text-xs text-blue-200 uppercase font-bold tracking-wider">Goal Article</p>
          <div className="flex items-center justify-center md:justify-start">
            <h1 className="text-xl md:text-2xl font-bold text-yellow-300 leading-tight mr-2">
              {roomData.goalArticle.replace(/_/g, ' ')}
            </h1>
            {goalArticleSummary?.content_urls?.desktop?.page && (
              <a 
                href={goalArticleSummary.content_urls.desktop.page} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-yellow-300 hover:text-yellow-200 transition-colors"
                aria-label={`Open ${roomData.goalArticle} on Wikipedia`}
              >
                <ExternalLink size={16} />
              </a>
            )}
          </div>
          {goalArticleSummary?.extract && (
            <p className="text-xs text-blue-100 italic max-w-sm mt-1 hidden md:block">
              {goalArticleSummary.extract.substring(0, 100)}...
            </p>
          )}
        </div>

        <div className="text-center mb-3 md:mb-0">
          <p className="text-xs text-blue-200 uppercase font-bold tracking-wider">Clicks</p>
          <p className="text-3xl font-mono leading-none text-yellow-300">{me?.clicks || 0}</p>
        </div>

        <div className="text-center md:text-right">
            {roomData.status === 'waiting' ? (
                <button 
                    onClick={() => socket.emit('startGame', roomId)}
                    className="bg-green-500 text-white px-6 py-2 rounded-full font-bold shadow-md hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Start Race
                </button>
            ) : (
                <div className="flex flex-col items-center md:items-end">
                    <p className="text-xs text-blue-200 uppercase font-bold tracking-wider">You are at</p>
                    <p className="text-base font-medium italic text-blue-100 truncate max-w-[150px]">{me?.currentArticle.replace(/_/g, ' ')}</p>
                </div>
            )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Leaderboard Sidebar */}
        <aside className="w-64 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 p-4 overflow-y-auto hidden md:block shadow-inner">
          <h2 className="font-bold text-lg mb-4 pb-2 border-b border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">Players</h2>
          <div className="space-y-3">
            {Object.values(roomData.players).sort((a,b) => (a.finished === b.finished ? 0 : a.finished ? -1 : 1) || (a.clicks || 0) - (b.clicks || 0)).map((p: Player) => (
              <div 
                key={p.id} 
                className={`p-3 rounded-lg shadow-sm transition-all duration-200 
                            ${p.id === socket.id 
                                ? 'bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800' 
                                : 'bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600'}
                            ${p.finished ? 'ring-2 ring-green-400 dark:ring-green-600' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-semibold text-sm truncate mr-2 ${p.id === socket.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                    {p.username} {p.id === socket.id && '(You)'}
                  </span>
                  <span className="text-xs font-mono bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200 px-2 py-0.5 rounded-full">
                    {p.clicks} clicks
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 italic truncate">{p.currentArticle.replace(/_/g, ' ')}</div>
                {p.finished && (
                  <div className="flex items-center text-green-600 dark:text-green-400 font-bold text-xs mt-2">
                    <Trophy className="mr-1" size={12} /> WINNER! ({Math.floor(p.time || 0)}s)
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-10 bg-white dark:bg-slate-900 relative">
          {roomData.status === 'waiting' ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
              <Loader2 className="animate-spin text-blue-500 dark:text-blue-400 mb-4" size={48} />
              <p className="text-2xl font-semibold">Waiting for host to start the race...</p>
              <p className="text-sm mt-2">Current Start Article: <span className="font-bold text-slate-600 dark:text-slate-300">{roomData.startArticle.replace(/_/g, ' ')}</span></p>
              <p className="text-sm">Current Goal Article: <span className="font-bold text-slate-600 dark:text-slate-300">{roomData.goalArticle.replace(/_/g, ' ')}</span></p>
            </div>
          ) : me?.finished ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Trophy className="text-green-500 mb-4" size={96} />
              <h2 className="text-6xl font-black text-green-600 dark:text-green-400 mb-4 animate-bounce">GG!</h2>
              <p className="text-3xl text-slate-700 dark:text-slate-200">
                You reached the goal in <span className="font-bold text-green-700 dark:text-green-300">{me.clicks}</span> clicks and <span className="font-bold text-green-700 dark:text-green-300">{Math.floor(me.time || 0)}</span> seconds!
              </p>
              <button 
                onClick={() => window.location.href = '/'} 
                className="mt-10 px-6 py-3 bg-blue-600 text-white rounded-full font-semibold text-lg shadow-md hover:bg-blue-700 transition-colors"
              >
                Play Again
              </button>
            </div>
          ) : (
            <>
              {loadingArticle && (
                <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-70 dark:bg-slate-900 dark:bg-opacity-70 z-10">
                  <Loader2 className="animate-spin text-blue-500 dark:text-blue-400" size={48} />
                </div>
              )}
              {articleFetchError && (
                <div className="text-red-500 bg-red-50 dark:bg-red-950 p-4 rounded-lg mb-4 border border-red-200 dark:border-red-800 text-center">
                  <p className="font-semibold">Error loading article:</p>
                  <p>{articleFetchError}</p>
                  <p className="text-sm mt-2">Please try navigating to a different link.</p>
                </div>
              )}
              <div 
                className={`prose max-w-4xl mx-auto transition-all duration-300 ${loadingArticle ? 'opacity-50 blur-sm pointer-events-none' : 'opacity-100'}`}
                onClick={handleWikiClick}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}