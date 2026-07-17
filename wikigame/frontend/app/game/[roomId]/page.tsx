// frontend\app\game\[roomId]\page.tsx
"use client";
import React, { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import io, { Socket } from 'socket.io-client'; // Consolidated socket.io import
import { ExternalLink, Loader2, Trophy, Search, Info, X } from 'lucide-react'; // Consolidated lucide-react import
import { Menu } from 'lucide-react'; // Import Menu icon for mobile sidebar toggle

interface Player {
  id: string;
  username: string;
  currentArticle: string;
  history: string[];
  clicks: number;
  hintCount: number;
  points: number;
  finished: boolean;
  lost?: boolean;
  time?: number;
}

interface RoomData {
  players: { [key: string]: Player };
  startArticle: string;
  goalArticle: string;
  status: 'waiting' | 'playing' | 'finished';
  startTime?: number;
  hostId: string | null; // New: ID of the room host
}

interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
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

const serverUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function Game({ params }: { params: { roomId: string } }) {
  // FIX: Unwrap 'params' with React.use() as advised by the error message.
  // This is necessary because in your experimental Next.js version, 'params'
  // is treated as a Promise that must be resolved before accessing its properties.
  const resolvedParams = use(params);
  const roomId = resolvedParams.roomId;
  
  const searchParams = useSearchParams();
  const username = searchParams.get('user');
  
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [html, setHtml] = useState<string>("");
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [articleFetchError, setArticleFetchError] = useState<string | null>(null);
  const [failedNavigationTarget, setFailedNavigationTarget] = useState<string | null>(null);
  const [goalArticleSummary, setGoalArticleSummary] = useState<ArticleSummary | null>(null);
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false); // New: State for mobile sidebar visibility
  const [hints, setHints] = useState<string[]>([]);
  const [loadingHint, setLoadingHint] = useState(false);
  const [searchQuery, setSearchQuery] = useState(''); // New: Search query for article
  const [showGoalModal, setShowGoalModal] = useState(false); // New: Goal description modal

  const chatDisplayRef = React.useRef<HTMLDivElement>(null); // New: Ref for chat auto-scrolling
  const headerRef = React.useRef<HTMLDivElement>(null); // Ref for header to measure its height
  const [headerHeight, setHeaderHeight] = useState(0); // State to store header height

  // 1. Initialize socket connection and emit joinRoom
  useEffect(() => {
    if (!username || !roomId) { // Ensure username and roomId are available before connecting
        return;
    }

    const newSocket = io(serverUrl);
    setSocketInstance(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('joinRoom', { roomId, username });
    });

    newSocket.on('articleNavigationError', ({ message, failedTargetTitle }) => {
      console.error("Server reported navigation error:", message);
      setArticleFetchError(message);
      setFailedNavigationTarget(failedTargetTitle);
      setLoadingArticle(false);
    });

    // New: Listen for chat messages
    newSocket.on('chatMessage', (message: ChatMessage) => {
      setChatMessages((prevMessages) => [...prevMessages, message]);
    });

    // New: Listen for room left confirmation to redirect
    newSocket.on('roomLeftConfirmation', () => {
      alert("You have left the room.");
      // Redirect to home page
      window.location.href = '/'; 
    });

    return () => {
        newSocket.disconnect();
    };
  }, [roomId, username]); // Dependencies for useEffect

  // 2. Setup socket listeners for room updates
  useEffect(() => {
    if (!socketInstance) { // Ensure socket is initialized before adding listeners
      return;
    }

    const handleRoomUpdate = (data: RoomData) => {
      // Detect game reset (transition from playing/finished back to waiting)
      if (data.status === 'waiting' && roomData?.status && roomData.status !== 'waiting') {
        setHtml("");
        setHints([]);
        setGoalArticleSummary(null);
        setArticleFetchError(null);
        setFailedNavigationTarget(null);
        setSearchQuery('');
      }

      setRoomData(data);

      // Clear error states if current player successfully navigated
      const myId = socketInstance?.id;
      if (myId) {
        const me = data.players[myId];
        const oldMe = roomData?.players[myId];
        if (me && oldMe && me.currentArticle !== oldMe.currentArticle) {
          setArticleFetchError(null);
          setFailedNavigationTarget(null);
        }
      }
    };
    
    socketInstance.on('roomUpdate', handleRoomUpdate);

    return () => {
      socketInstance.off('roomUpdate', handleRoomUpdate);
    };
  }, [socketInstance, roomData]); // Depend on socketInstance and roomData for comparison logic

  // Effect to measure header height on component mount and whenever roomData or other layout affecting states change
  useEffect(() => {
    if (headerRef.current) {
      setHeaderHeight(headerRef.current.offsetHeight);
    }
    // Re-measure on window resize to handle responsiveness
    const handleResize = () => {
      if (headerRef.current) {
        setHeaderHeight(headerRef.current.offsetHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [roomData, showMobileSidebar]); // Also re-measure if sidebar visibility changes which might affect main layout or header rendering

  // Fetch current article content (only triggered when roomData.players[me.id].currentArticle changes)
  useEffect(() => {
    const fetchContent = async () => {
      // Safely get 'me' using optional chaining on socketInstance
      const me = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined; 
      
      // Only fetch if we are playing, the player is not finished, and we have an article to display
      if (me && !me.finished && roomData?.status === 'playing' && me.currentArticle) {
        setLoadingArticle(true); // Set loading ON for content fetch
        setArticleFetchError(null); 
        setFailedNavigationTarget(null);
        try {
            const res = await fetch(`${serverUrl}/api/wiki/${encodeURIComponent(me.currentArticle)}`);
            if (!res.ok) { 
                const errorData = await res.json(); 
                throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
            }
            const data = await res.json();
            setHtml(data.html); 
            window.scrollTo(0, 0); 
            setLoadingArticle(false); // Set loading OFF on success
        } catch (e: any) { 
            console.error("Frontend: Error fetching article content for display:", e.message);
            setArticleFetchError(`Failed to load article content for "${me.currentArticle.replace(/_/g, ' ')}": ${e.message}. You can try retrying.`);
            setFailedNavigationTarget(me.currentArticle); 
            setHtml(`<div class="text-red-500 font-semibold text-center mt-8">
                      <p>${articleFetchError || `Error fetching content for ${me.currentArticle.replace(/_/g, ' ')}.`}</p>
                      <p class="text-sm mt-2">The server acknowledges you are on this page, but your browser couldn't load its content. Try again.</p>
                     </div>`);
            setLoadingArticle(false); // Set loading OFF on error
        }
      }
    };
    fetchContent();
  }, [roomData?.players?.[socketInstance?.id || '']?.currentArticle, roomData?.status, socketInstance?.id]); // Re-fetch if article or status changes, or socket id becomes available

  // Fetch goal article summary
  useEffect(() => {
    const fetchSummary = async () => {
      // Fetch if we have a goal article and don't have a summary for it yet
      // This is triggered by roomData.goalArticle changing or goalArticleSummary being reset to null
      if (roomData?.goalArticle && !goalArticleSummary) {
        try {
          const res = await fetch(`${serverUrl}/api/wiki-summary/${encodeURIComponent(roomData.goalArticle)}`);
          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
          }
          const summary = await res.json();
          setGoalArticleSummary(summary);
        } catch (e: any) {
          console.error("Fetch goal summary error:", e.message);
        }
      }
    };
    fetchSummary();
  }, [roomData?.goalArticle, goalArticleSummary]);


  // New: Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatDisplayRef.current) {
      chatDisplayRef.current.scrollTop = chatDisplayRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery) {
      // @ts-ignore
      window.find(searchQuery, false, false, true, false, true, false);
    }
  };

  const handleWikiClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    
    // Only proceed if it's a valid link and game is in a playable state
    // Use optional chaining for socketInstance and provide a fallback empty string for the key access
    const myPlayer = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined;

    if (anchor && roomData?.status === 'playing' && myPlayer && !myPlayer.finished) {
      const dataTitle = anchor.getAttribute('data-title');

      if (dataTitle) { 
        e.preventDefault(); 
        if (!loadingArticle && socketInstance) { 
          setArticleFetchError(null);
          setFailedNavigationTarget(null);
          setLoadingArticle(true); // Set loading ON immediately on click
          socketInstance.emit('navigate', { roomId, targetTitle: dataTitle });
        }
      }
    }
  };

  const handleRetry = () => {
    if (socketInstance && failedNavigationTarget) {
      setArticleFetchError(null);
      setFailedNavigationTarget(null);
      setLoadingArticle(true); // Set loading ON for retry
      socketInstance.emit('navigate', { roomId, targetTitle: failedNavigationTarget });
    } else {
        const me = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined;
        if (socketInstance && me?.currentArticle) {
            setArticleFetchError(null);
            setLoadingArticle(true); // Set loading ON for retry even if target unknown
            // This will trigger a re-fetch via the useEffect for currentArticle
            socketInstance.emit('navigate', { roomId, targetTitle: me.currentArticle.replace(/_/g, ' ') });
        }
    }
  };

  const handleGoBack = () => {
    setArticleFetchError(null);
    setFailedNavigationTarget(null);
    setLoadingArticle(false); // Ensure loading is OFF when going back from an error
    
    // If player has history, navigate to the previous article
    const me = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined;
    if (me && me.history.length > 1) {
        const previousArticle = me.history[me.history.length - 2];
        socketInstance.emit('navigate', { roomId, targetTitle: previousArticle.replace(/_/g, ' ') });
    } else {
        // If no history, or only start article, just clear the error and display start article again
        // (the useEffect for currentArticle will re-trigger and fetch the same article if it's still current)
        console.log("No previous article to go back to.");
    }
  };

  // New: Handle leaving the room
  const handleLeaveRoom = () => {
    if (socketInstance && roomId && confirm("Are you sure you want to leave this room? Your progress will be lost.")) {
      socketInstance.emit('leaveRoom', { roomId });
    }
  };

  // New: Handle sending chat messages
  const handleSendMessage = () => {
    if (socketInstance && chatInput.trim() && username && roomId) {
      socketInstance.emit('chatMessage', { 
        roomId, 
        username, 
        message: chatInput 
      });
      setChatInput(''); // Clear input after sending
    }
  };

  const getWikiHint = async () => {
    if (!me || me.finished || !roomData || !socketInstance) return;
    
    // Notify server to deduct points and increment hint count
    socketInstance.emit('requestHint', { roomId });

    setLoadingHint(true);
    try {
      const res = await fetch(`${serverUrl}/api/wiki-hint/${encodeURIComponent(me.currentArticle)}/${encodeURIComponent(roomData.goalArticle)}`);
      
      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType || !contentType.includes("application/json")) {
        throw new Error(`Server error: ${res.status}`);
      }

      const data = await res.json();
      const newHints = data.hints && data.hints.length > 0 ? data.hints : ["Try looking for broader topics related to the goal."];
      setHints(newHints);

      // Scroll to the first hinted link if it exists in the article
      setTimeout(() => {
        for (const hint of newHints) {
          const escapedHint = hint.replace(/'/g, "\\'");
          const element = document.querySelector(`a[data-title='${escapedHint}']`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('hint-highlight');
            setTimeout(() => element.classList.remove('hint-highlight'), 5000);
            break;
          }
        }
      }, 100);

    } catch (e: any) {
      console.error("Hint error:", e.message);
      setHints(["Hint currently unavailable"]);
    } finally {
      setLoadingHint(false);
    }
  };


  if (!roomData || !socketInstance) return ( // Add check for socketInstance here
    <div className="flex flex-col items-center justify-center h-screen bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-sans text-xl">
      <Loader2 className="animate-spin mb-4 text-blue-500" size={32} />
      <p>Connecting to the room...</p>
      <p className="text-sm mt-2 opacity-50">If this takes long, ensure the backend is running.</p>
    </div>
  );

  // Use socketInstance.id to get the current player's data
  const me = roomData.players[socketInstance.id];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 font-sans relative">
      {/* Goal Summary Modal */}
      {showGoalModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                  {roomData.goalArticle.replace(/_/g, ' ')}
                </h3>
                <button 
                  onClick={() => setShowGoalModal(false)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                >
                  <X size={24} className="text-slate-500" />
                </button>
              </div>
              <div className="prose prose-sm dark:prose-invert max-h-60 overflow-y-auto mb-6">
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {goalArticleSummary?.extract || "Loading summary..."}
                </p>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowGoalModal(false)}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
                >
                  Got it!
                </button>
                {goalArticleSummary?.content_urls?.desktop?.page && (
                  <a 
                    href={goalArticleSummary.content_urls.desktop.page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 flex items-center justify-center bg-slate-100 dark:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    <ExternalLink size={20} />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div ref={headerRef} className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white p-4 flex flex-col md:flex-row justify-between items-center sticky top-0 z-50 shadow-lg dark:from-slate-800 dark:to-slate-900">
        <div className="text-center md:text-left mb-2 md:mb-0 max-w-full md:max-w-[40%]">
          <div className="flex items-center gap-2 justify-center md:justify-start">
            <div className="p-1.5 bg-yellow-400 rounded-lg text-blue-900 shadow-sm hidden md:block">
              <Trophy size={18} />
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-blue-200 uppercase font-black tracking-widest leading-none mb-1">Target Goal</p>
              <div className="flex items-center justify-center md:justify-start gap-1.5">
                <h1 className="text-lg md:text-2xl font-black text-yellow-300 leading-tight truncate max-w-[200px] md:max-w-none">
                  {roomData.goalArticle.replace(/_/g, ' ')}
                </h1>
                <button 
                  onClick={() => setShowGoalModal(true)}
                  className="text-yellow-300 hover:text-white transition-colors bg-white/10 p-1 rounded"
                  title="Goal Info"
                >
                  <Info size={16} />
                </button>
                {goalArticleSummary?.content_urls?.desktop?.page && (
                  <a 
                    href={goalArticleSummary.content_urls.desktop.page} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-yellow-300 hover:text-white transition-colors"
                    aria-label={`Open ${roomData.goalArticle} on Wikipedia`}
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-blue-800/40 dark:bg-slate-700/50 px-6 py-2 rounded-2xl backdrop-blur-sm border border-white/10 flex flex-row md:flex-col items-center gap-3 md:gap-0">
          <p className="text-[10px] text-blue-200 uppercase font-black tracking-widest mb-0 md:mb-1">Clicks</p>
          <p className="text-2xl md:text-3xl font-black leading-none text-white drop-shadow-sm">{me?.clicks || 0}</p>
        </div>

        <div className="flex flex-row md:flex-row items-center gap-2 md:gap-4 mt-2 md:mt-0">
            {roomData.status === 'waiting' && socketInstance?.id === roomData.hostId && (
                <button 
                    onClick={() => socketInstance?.emit('startGame', roomId)} 
                    className="bg-green-500 text-white px-5 py-2 rounded-xl font-black text-sm shadow-lg hover:bg-green-600 transition-all hover:scale-105 active:scale-95 uppercase"
                >
                    Start Race
                </button>
            )}
            
            {roomData.status === 'playing' && !me?.finished && (
              <button 
                onClick={getWikiHint}
                disabled={loadingHint}
                className="bg-amber-400 text-blue-900 px-5 py-2 rounded-xl font-black text-sm shadow-lg hover:bg-amber-500 transition-all hover:scale-105 active:scale-95 uppercase flex items-center gap-2"
              >
                {loadingHint ? <Loader2 size={16} className="animate-spin" /> : 'Get Hint'}
              </button>
            )}

            <button 
                onClick={handleLeaveRoom}
                className="bg-white/10 hover:bg-red-500/80 text-white px-4 py-2 rounded-xl font-bold transition-all text-xs border border-white/20 uppercase"
            >
                Exit
            </button>

            <button
                className="md:hidden bg-blue-500 text-white p-2 rounded-xl shadow-lg border border-white/20"
                onClick={() => setShowMobileSidebar(!showMobileSidebar)}
            >
                <Menu size={20} />
            </button>
        </div>
      </div>

      {/* Real-time Path Breadcrumbs */}
      {roomData.status === 'playing' && !me?.finished && (
        <div className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 overflow-x-auto whitespace-nowrap shadow-inner">
          <div className="flex items-center gap-2 px-4 text-[10px] md:text-xs">
            <span className="font-bold text-slate-500 dark:text-slate-400 uppercase">Your Path:</span>
            {me?.history.map((step, i) => (
              <React.Fragment key={i}>
                <span className="px-2 py-0.5 bg-white dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 font-medium text-slate-700 dark:text-slate-200">
                  {step.replace(/_/g, ' ')}
                </span>
                {i < (me?.history.length - 1) && <span className="text-slate-400">→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Leaderboard & Chat Sidebar */}
        <aside 
          id="mobile-sidebar"
          className={`
            w-72 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 p-5 overflow-y-auto shadow-2xl md:shadow-inner
            fixed left-0 bottom-0 z-40 transform transition-transform duration-300 ease-in-out md:static
            ${showMobileSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}
          style={{ top: `${headerHeight}px` }} // Apply dynamic top position
        >
          <h2 className="font-bold text-lg mb-4 pb-2 border-b border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">Players</h2>
          <div className="space-y-3">
            {Object.values(roomData.players)
              .filter((p): p is Player => p !== undefined && p !== null)
              .sort((a,b) => (a.finished === b.finished ? 0 : a.finished ? -1 : 1) || (a.clicks || 0) - (b.clicks || 0))
              .map((p: Player) => (
                <div 
                  key={p.id}
                  className={`p-3 rounded-lg shadow-sm transition-all duration-200 
                              ${p.id === socketInstance?.id 
                                  ? 'bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800' 
                                  : 'bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600'}
                              ${p.finished ? 'ring-2 ring-green-400 dark:ring-green-600' : ''}
                              ${p.id === roomData.hostId ? 'ring-2 ring-yellow-400 dark:ring-yellow-600' : ''}` }
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold text-sm truncate mr-2 ${p.id === socketInstance?.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                      {p.username} {p.id === socketInstance?.id && '(You)'} {p.id === roomData.hostId && '(Host)'}
                    </span>
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-mono bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200 px-2 py-0.5 rounded-full">
                        {p.clicks} clicks
                      </span>
                      <span className={`text-[10px] font-bold mt-1 ${p.points < 0 ? 'text-red-500' : 'text-green-500'}`}>
                        Score: {p.points}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 italic truncate mb-1">
                    {p.currentArticle.replace(/_/g, ' ')}
                  </div>
                  <div className="text-[10px] text-slate-400">Hints: {p.hintCount || 0}</div>
                  {p.finished && (
                    <div className={`flex items-center font-bold text-xs mt-2 ${p.lost ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                      {p.lost ? 'ELIMINATED' : <><Trophy className="mr-1" size={12} /> FINISHED! ({Math.floor(p.time || 0)}s)</>}
                    </div>
                  )}
                  {/* Path Preview */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.history.slice(-3).map((h, i) => (
                      <span key={i} className="text-[9px] bg-slate-200 dark:bg-slate-600 px-1 rounded opacity-70">
                        {h.length > 10 ? h.substring(0, 10) + '...' : h}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>

          {/* Chat Section */}
          <div className="mt-8">
            <h2 className="font-bold text-lg mb-4 pb-2 border-b border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">Room Chat</h2>
            <div ref={chatDisplayRef} className="bg-slate-50 dark:bg-slate-700 h-60 overflow-y-auto p-3 rounded-lg border border-slate-200 dark:border-slate-600 mb-3 flex flex-col space-y-2 text-sm">
              {chatMessages.map((msg, index) => (
                <div key={index} className="flex items-start">
                  <span className="font-semibold text-blue-600 dark:text-blue-300 mr-1 flex-shrink-0">{msg.username}:</span>
                  <span className="text-slate-800 dark:text-slate-100 break-words">{msg.message}</span> 
                </div>
              ))}
            </div>
            <div className="flex">
              <input
                type="text"
                placeholder="Type a message..."
                className="flex-1 min-w-0 p-2 border border-slate-300 rounded-l-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none dark:bg-slate-600 dark:border-slate-500 dark:text-white text-sm"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <button
                onClick={handleSendMessage}
                className="bg-blue-600 text-white px-4 py-2 rounded-r-lg font-semibold hover:bg-blue-700 transition-colors text-sm"
                disabled={!chatInput.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-10 bg-white dark:bg-slate-900 relative">
          {/* Overlay to close sidebar on mobile when main content is clicked */}
          {showMobileSidebar && (
            <div 
              className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-30" 
              onClick={() => setShowMobileSidebar(false)}
            ></div>
          )}

          {roomData.status === 'waiting' ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
              <Loader2 className="animate-spin text-blue-500 dark:text-blue-400 mb-4" size={48} />
              <p className="text-2xl font-semibold">Waiting for host to start the race...</p>
              <p className="text-sm mt-2">Current Start Article: <span className="font-bold text-slate-600 dark:text-slate-300">{roomData.startArticle.replace(/_/g, ' ')}</span></p>
              <p className="text-sm">Current Goal Article: <span className="font-bold text-slate-600 dark:text-slate-300">{roomData.goalArticle.replace(/_/g, ' ')}</span></p>
            </div>
          ) : me?.finished || roomData.status === 'finished' ? (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-4xl mx-auto py-6 md:py-10 px-4">
              {roomData.status === 'playing' ? (
                <div className="mb-8 animate-in fade-in zoom-in duration-500 bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-2xl border border-blue-100 dark:border-slate-700">
                  {me?.lost ? (
                    <h2 className="text-4xl md:text-5xl font-black text-red-500 mb-2">Race Over for You</h2>
                  ) : (
                    <>
                      <div className="relative mb-6">
                        <Trophy className="text-yellow-500 mx-auto animate-bounce" size={80} />
                        <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-1">
                          {[1,2,3].map(i => <div key={i} className="w-2 h-2 rounded-full bg-yellow-400 animate-ping" style={{animationDelay: `${i*0.2}s`}} />)}
                        </div>
                      </div>
                      <h2 className="text-4xl md:text-5xl font-black text-green-600 dark:text-green-400 mb-2">Victory!</h2>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-4">Goal Reached!</p>
                    </>
                  )}
                  <div className="space-y-4">
                    <p className="text-lg text-slate-600 dark:text-slate-400 font-medium">
                      {me?.lost ? "You've been eliminated by a faster player." : "Great job! You've reached the target article."}
                    </p>
                    <div className="flex items-center justify-center gap-3 py-3 px-6 bg-blue-50 dark:bg-slate-900/50 rounded-2xl border border-blue-100 dark:border-slate-700">
                      <Loader2 className="animate-spin text-blue-500" size={24} />
                      <p className="text-base text-slate-500 dark:text-slate-400 font-bold uppercase tracking-tight">Waiting for others to finish...</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-8 animate-in fade-in zoom-in duration-500">
                  <h2 className="text-5xl md:text-6xl font-black text-blue-600 dark:text-blue-400 mb-2 uppercase tracking-tighter">Race Over</h2>
                  <p className="text-lg text-slate-500 dark:text-slate-400">Final Results for Room {roomId}</p>
                </div>
              )}

              <div className="w-full bg-slate-50 dark:bg-slate-800 rounded-3xl p-6 md:p-8 shadow-xl mb-10 border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Race Path Analysis</h3>
                  <div className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-bold">
                    {me?.history.length} Steps
                  </div>
                </div>
                <div className="flex flex-wrap justify-start gap-3 items-center">
                  {me?.history.map((step, i) => (
                    <React.Fragment key={i}>
                      <div className="flex items-center group">
                        <span className={`px-4 py-2 rounded-xl shadow-sm border transition-all duration-300 text-xs md:text-sm font-bold
                          ${i === 0 ? 'bg-indigo-600 text-white border-indigo-500' : 
                            i === (me?.history.length - 1) ? 'bg-green-600 text-white border-green-500' : 
                            'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600'}`}>
                          {step.replace(/_/g, ' ')}
                        </span>
                        {i < (me?.history.length - 1) && (
                          <div className="mx-2 text-slate-300 dark:text-slate-600">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="w-full">
                <h3 className="text-2xl font-bold mb-6 text-slate-800 dark:text-slate-200">Leaderboard</h3>
                <div className="grid gap-4">
                  {Object.values(roomData.players)
                    .sort((a, b) => {
                      if (a.lost && !b.lost) return 1;
                      if (!a.lost && b.lost) return -1;
                      if (a.finished && !b.finished) return -1;
                      if (!a.finished && b.finished) return 1;
                      return a.clicks - b.clicks || (a.time || 0) - (b.time || 0);
                    })
                    .map((p, idx) => (
                      <div key={p.id} className={`flex items-center justify-between p-4 md:p-5 rounded-2xl border-2 transition-all duration-300 ${idx === 0 ? 'bg-yellow-50 border-yellow-400 scale-105 shadow-yellow-100 dark:bg-yellow-900/20 dark:border-yellow-700' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 shadow-sm'}`}>
                        <div className="flex items-center gap-3 md:gap-5">
                          <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center font-black text-lg ${idx === 0 ? 'bg-yellow-400 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
                            {idx + 1}
                          </div>
                          <div className="text-left">
                            <span className="font-bold text-lg block leading-tight">{p.username} {p.id === socketInstance?.id && '(You)'}</span>
                            {p.time && <span className="text-xs text-slate-500 dark:text-slate-400">{Math.floor(p.time)}s total time</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-baseline gap-1 justify-end">
                            <span className="font-mono font-black text-2xl text-blue-600 dark:text-blue-400">{p.clicks}</span>
                            <span className="text-xs font-bold text-slate-400 uppercase">Clicks</span>
                          </div>
                          <span className={`text-xs font-black px-2 py-0.5 rounded uppercase ${p.lost ? 'bg-red-100 text-red-600' : p.finished ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                            {p.lost ? 'Eliminated' : p.finished ? 'Finished' : 'Racing'}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="mt-12 flex flex-col md:flex-row gap-4 w-full justify-center">
                {(roomData.status === 'finished' || me?.finished) && socketInstance?.id === roomData.hostId && (
                  <button 
                    onClick={() => {
                        if (roomData.status !== 'finished' && !confirm("Some players are still racing. Reset game for everyone?")) return;
                        socketInstance.emit('playAgain', roomId);
                    }} 
                    className="px-10 py-4 bg-green-600 text-white rounded-2xl font-bold text-xl shadow-xl hover:bg-green-700 transition-all hover:-translate-y-1 active:translate-y-0"
                  >
                    Play Again
                  </button>
                )}
                <button 
                  onClick={() => window.location.href = '/'} 
                  className="px-10 py-4 bg-slate-800 dark:bg-slate-700 text-white rounded-2xl font-bold text-xl shadow-xl hover:bg-slate-900 transition-all hover:-translate-y-1 active:translate-y-0"
                >
                  Exit Game
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Search Bar for Article */}
              {roomData.status === 'playing' && !me?.finished && !loadingArticle && !articleFetchError && (
                <div className="mb-6 sticky top-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md pb-2">
                  <form onSubmit={handleSearch} className="flex gap-2 max-w-xl mx-auto">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text" 
                        placeholder="Search in article..." 
                        className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm dark:text-white"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <button 
                      type="submit"
                      className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                    >
                      Find
                    </button>
                  </form>
                </div>
              )}

              {hints.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 rounded-lg mb-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600 font-bold text-sm uppercase">Hints:</span>
                    <div className="flex gap-2">
                      {hints.map((h, i) => (
                        <span key={i} className="bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-amber-200 text-xs font-semibold">{h}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setHints([])} className="text-amber-500 hover:text-amber-700 text-xs font-bold">Close</button>
                </div>
              )}
              {loadingArticle && (
                <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-70 dark:bg-slate-900 dark:bg-opacity-70 z-10">
                  <Loader2 className="animate-spin text-blue-500 dark:text-blue-400" size={48} />
                </div>
              )}
              {articleFetchError && (
                <div className="text-red-500 bg-red-50 dark:bg-red-950 p-4 rounded-lg mb-4 border border-red-200 dark:border-red-800 text-center mx-auto max-w-lg">
                  <p className="font-semibold text-lg mb-2">Error!</p>
                  <p className="text-base">{articleFetchError}</p>
                  <div className="flex justify-center space-x-4 mt-4">
                    {failedNavigationTarget && ( // Show retry button if we know which article failed to load
                        <button
                            onClick={handleRetry}
                            className="bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 transition-colors"
                        >
                            Retry Loading Article
                        </button>
                    )}
                    <button
                      onClick={handleGoBack}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                    >
                      Go Back to Previous Page
                    </button>
                  </div>
                </div>
              )}
              {/* Wrap the prose content in a div to handle table overflow */}
              <div className="article-content-wrapper">
                <div 
                  className={`prose transition-all duration-300 ${loadingArticle ? 'opacity-50 blur-sm pointer-events-none' : 'opacity-100'} ${articleFetchError ? 'hidden' : ''}`}
                  onClick={handleWikiClick}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {/* When there's an error, display current article name for context */}
                {articleFetchError && (
                    <div className="text-center text-slate-500 dark:text-slate-400 mt-6">
                        <p>Currently viewing: <span className="font-semibold">{me?.currentArticle.replace(/_/g, ' ') || 'Unknown'}</span></p>
                    </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}