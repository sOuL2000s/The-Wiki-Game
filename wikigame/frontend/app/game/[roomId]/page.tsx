"use client";
import React, { useEffect, useState, use } from 'react'; // Added 'use'
import { useSearchParams } from 'next/navigation';
import io from 'socket.io-client';

let socket: any;

export default function Game({ params }: { params: Promise<{ roomId: string }> }) {
  // Unwrap params for Next.js 15
  const resolvedParams = use(params);
  const roomId = resolvedParams.roomId;
  
  const searchParams = useSearchParams();
  const username = searchParams.get('user');
  
  const [roomData, setRoomData] = useState<any>(null);
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    socket = io('http://localhost:3001');
    socket.emit('joinRoom', { roomId, username });

    socket.on('roomUpdate', (data: any) => {
      setRoomData(data);
    });

    return () => {
        socket.disconnect();
    };
  }, [roomId, username]);

  useEffect(() => {
    const fetchContent = async () => {
      const me = roomData?.players[socket.id];
      if (me && !me.finished) {
        setLoading(true);
        try {
            const res = await fetch(`http://localhost:3001/api/wiki/${encodeURIComponent(me.currentArticle)}`);
            const data = await res.json();
            setHtml(data.html);
        } catch (e) {
            console.error("Fetch error", e);
        }
        setLoading(false);
        window.scrollTo(0, 0);
      }
    };
    fetchContent();
  }, [roomData?.players?.[socket?.id]?.currentArticle]);

  const handleWikiClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('/wiki/')) {
        const title = anchor.getAttribute('title') || href.replace('/wiki/', '');
        socket.emit('navigate', { roomId, targetTitle: title });
      }
    }
  };

  if (!roomData) return <div className="p-10 font-sans text-slate-500">Connecting to lobby...</div>;

  const me = roomData.players[socket.id];

  return (
    <div className="flex flex-col h-screen bg-white font-sans">
      <div className="bg-slate-900 text-white p-4 flex justify-between items-center sticky top-0 z-50">
        <div>
          <p className="text-[10px] text-slate-400 uppercase font-bold">Goal Article</p>
          <p className="text-lg font-bold text-yellow-400 leading-tight">{roomData.goalArticle.replace(/_/g, ' ')}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-400 uppercase font-bold">Clicks</p>
          <p className="text-2xl font-mono leading-none">{me?.clicks || 0}</p>
        </div>
        <div>
            {roomData.status === 'waiting' ? (
                <button 
                    onClick={() => socket.emit('startGame', roomId)}
                    className="bg-green-500 px-6 py-2 rounded-lg font-bold hover:bg-green-600 transition-colors"
                >
                    Start Race
                </button>
            ) : (
                <div className="text-right">
                    <p className="text-[10px] text-slate-400 uppercase font-bold">You are at</p>
                    <p className="truncate max-w-[150px] font-medium italic">{me?.currentArticle.replace(/_/g, ' ')}</p>
                </div>
            )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 bg-slate-50 border-r p-4 overflow-y-auto hidden md:block">
          <h2 className="font-bold mb-4 border-b pb-2 text-slate-700">Leaderboard</h2>
          {Object.values(roomData.players).map((p: any) => (
            <div key={p.id} className={`mb-4 p-2 rounded ${p.id === socket.id ? 'bg-blue-50 border border-blue-100' : ''}`}>
              <div className="flex justify-between items-center">
                <span className="font-bold text-sm truncate mr-2">{p.username}</span>
                <span className="text-xs bg-slate-200 px-2 py-0.5 rounded-full">{p.clicks} clicks</span>
              </div>
              <div className="text-[11px] text-slate-500 truncate mt-1">{p.currentArticle}</div>
              {p.finished && <div className="text-green-600 font-bold text-xs mt-1">WINNER! ({Math.floor(p.time)}s)</div>}
            </div>
          ))}
        </aside>

        <main className="flex-1 overflow-y-auto p-4 md:p-10 bg-white">
          {roomData.status === 'waiting' ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <p className="text-xl">Waiting for host to click start...</p>
            </div>
          ) : me?.finished ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <h2 className="text-6xl font-black text-green-600 mb-4">GG!</h2>
              <p className="text-2xl text-slate-700">Goal Reached in <span className="font-bold">{me.clicks}</span> clicks!</p>
              <button onClick={() => window.location.href = '/'} className="mt-8 text-blue-600 underline">Play Again</button>
            </div>
          ) : (
            <div 
              className={`prose prose-slate max-w-4xl mx-auto transition-all ${loading ? 'blur-sm opacity-50' : 'opacity-100'}`}
              onClick={handleWikiClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
