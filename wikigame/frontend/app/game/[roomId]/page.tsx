// frontend\app\game\[roomId]\page.tsx
"use client";
import React, { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import io, { Socket } from 'socket.io-client'; // Consolidated socket.io import
import { ExternalLink, Loader2, Trophy } from 'lucide-react'; // Consolidated lucide-react import
import { Menu } from 'lucide-react'; // Import Menu icon for mobile sidebar toggle

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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]); // New: State for chat messages
  const [chatInput, setChatInput] = useState(''); // New: State for chat input

  // 1. Initialize socket connection and emit joinRoom
  useEffect(() => {
    if (!username || !roomId) { // Ensure username and roomId are available before connecting
        return;
    }

    const newSocket = io('http://localhost:3001');
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
      setRoomData(data);
      // Clear error states if room update indicates successful navigation
      // (i.e., if currentArticle has changed and there was a previous error)
      const me = socketInstance?.id ? data?.players[socketInstance.id] : undefined;
      if (me && me.currentArticle !== roomData?.players[socketInstance.id]?.currentArticle) {
        setArticleFetchError(null);
        setFailedNavigationTarget(null);
      }
    };
    
    socketInstance.on('roomUpdate', handleRoomUpdate);

    return () => {
      socketInstance.off('roomUpdate', handleRoomUpdate);
    };
  }, [socketInstance, roomData]); // Depend on socketInstance and roomData for comparison logic

  // Fetch current article content (only triggered when roomData.players[me.id].currentArticle changes)
  useEffect(() => {
    const fetchContent = async () => {
      // Safely get 'me' using optional chaining on socketInstance
      const me = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined; 
      
      // Only fetch if we are playing, the player is not finished, and we have an article to display
      if (me && !me.finished && roomData?.status === 'playing' && me.currentArticle) {
        setLoadingArticle(true);
        setArticleFetchError(null); // Clear previous errors (e.g., from a failed navigation attempt)
        setFailedNavigationTarget(null);
        try {
            const res = await fetch(`http://localhost:3001/api/wiki/${encodeURIComponent(me.currentArticle)}`);
            if (!res.ok) { 
                const errorData = await res.json(); 
                throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
            }
            const data = await res.json();
            setHtml(data.html); 
            window.scrollTo(0, 0); // Scroll to top when new article content is loaded
        } catch (e: any) { // Removed window.scrollTo(0,0) from here
            console.error("Frontend: Error fetching article content for display:", e.message);
            // This error means the article's HTML couldn't be fetched *after* the server confirmed it exists.
            // This is different from a navigation failure.
            setArticleFetchError(`Failed to load article content for "${me.currentArticle.replace(/_/g, ' ')}": ${e.message}. You can try retrying.`);
            setFailedNavigationTarget(me.currentArticle); // Allow retrying the current article's display
            setHtml(`<div class="text-red-500 font-semibold text-center mt-8">
                      <p>${articleFetchError || `Error fetching content for ${me.currentArticle.replace(/_/g, ' ')}.`}</p>
                      <p class="text-sm mt-2">The server acknowledges you are on this page, but your browser couldn't load its content. Try again.</p>
                     </div>`);
        }
        setLoadingArticle(false);
      }
    };
    fetchContent();
  }, [roomData?.players?.[socketInstance?.id || '']?.currentArticle, roomData?.status, socketInstance?.id]); // Re-fetch if article or status changes, or socket id becomes available

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
    
    // Only proceed if it's a valid link and game is in a playable state
    // Use optional chaining for socketInstance and provide a fallback empty string for the key access
    const myPlayer = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined;

    if (anchor && roomData?.status === 'playing' && myPlayer && !myPlayer.finished) {
      const dataTitle = anchor.getAttribute('data-title');

      if (dataTitle) { // This link has a data-title, meaning it's an internal game navigation link
        e.preventDefault(); // Prevent default browser navigation for this link
        if (!loadingArticle && socketInstance) { // Only navigate if not currently loading another article AND socket is available
          // Clear any previous error states before attempting a new navigation
          setArticleFetchError(null);
          setFailedNavigationTarget(null);
          setLoadingArticle(true); // Set loading explicitly here, as server might take time to respond
          socketInstance.emit('navigate', { roomId, targetTitle: dataTitle });
        }
      }
      // If the link does NOT have a data-title attribute (e.g., an external link with target="_blank"),
      // we do NOT call e.preventDefault(), allowing the browser to handle its default behavior.
    }
  };

  const handleRetry = () => {
    if (socketInstance && failedNavigationTarget) {
      // Clear current error state and re-emit the navigation for the failed target
      setArticleFetchError(null);
      setFailedNavigationTarget(null);
      setLoadingArticle(true);
      socketInstance.emit('navigate', { roomId, targetTitle: failedNavigationTarget });
    } else {
        // Fallback for when failedNavigationTarget is not set, but an error is present
        // This might happen if the *display* of the current page failed, not navigation.
        const me = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined;
        if (socketInstance && me?.currentArticle) {
            setArticleFetchError(null);
            setLoadingArticle(true);
            // This will trigger a re-fetch via the useEffect for currentArticle
            socketInstance.emit('navigate', { roomId, targetTitle: me.currentArticle.replace(/_/g, ' ') });
        }
    }
  };

  const handleGoBack = () => {
    setArticleFetchError(null);
    setFailedNavigationTarget(null);
    setLoadingArticle(false);
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


  if (!roomData || !socketInstance) return ( // Add check for socketInstance here
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-sans text-xl">
      <Loader2 className="animate-spin mr-3 text-blue-500" size={24} /> Connecting to lobby...
    </div>
  );

  // Use socketInstance.id to get the current player's data
  const me = roomData.players[socketInstance.id];

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

        <div className="flex flex-col items-center md:items-end space-y-2">
            {roomData.status === 'waiting' && socketInstance?.id === roomData.hostId ? (
                <button 
                    onClick={() => socketInstance?.emit('startGame', roomId)} 
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
            <button 
                onClick={handleLeaveRoom}
                className="bg-red-500 text-white px-4 py-2 rounded-full font-bold shadow-md hover:bg-red-600 transition-colors text-sm"
            >
                Exit Room
            </button>
            {/* Mobile-only button to hint at sidebar content (players/chat) */}
            <button
                className="md:hidden bg-blue-500 text-white px-3 py-1.5 rounded-full font-bold shadow-md hover:bg-blue-600 transition-colors text-xs flex items-center gap-1 mt-2"
                // onClick={() => { /* Implement mobile sidebar toggle logic here (e.g., open a modal/drawer) */ }}
            >
                <Menu size={16} /> Info
            </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Leaderboard Sidebar */}
        <aside className="w-64 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 p-4 overflow-y-auto hidden md:block shadow-inner">
          <h2 className="font-bold text-lg mb-4 pb-2 border-b border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">Players</h2>
          <div className="space-y-3">
            {Object.values(roomData.players)
              .filter((p): p is Player => p !== undefined && p !== null) // Defensively filter out any potential undefined/null entries
              .sort((a,b) => (a.finished === b.finished ? 0 : a.finished ? -1 : 1) || (a.clicks || 0) - (b.clicks || 0))
              .map((p: Player) => (
                <div 
                  key={p.id}
                  className={`p-3 rounded-lg shadow-sm transition-all duration-200 
                              ${p.id === socketInstance?.id 
                                  ? 'bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800' 
                                  : 'bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600'}
                              ${p.finished ? 'ring-2 ring-green-400 dark:ring-green-600' : ''}
                              ${p.id === roomData.hostId ? 'ring-2 ring-yellow-400 dark:ring-yellow-600' : ''}` /* Highlight host */ }
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold text-sm truncate mr-2 ${p.id === socketInstance?.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                      {p.username} {p.id === socketInstance?.id && '(You)'} {p.id === roomData.hostId && '(Host)'}
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

          {/* Chat Section */}
          <div className="mt-8">
            <h2 className="font-bold text-lg mb-4 pb-2 border-b border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">Room Chat</h2>
            <div className="bg-slate-50 dark:bg-slate-700 h-60 overflow-y-auto p-3 rounded-lg border border-slate-200 dark:border-slate-600 mb-3 flex flex-col space-y-2 text-sm" id="chatDisplay">
              {chatMessages.map((msg, index) => (
                <div key={index} className="flex items-start">
                  <span className="font-semibold text-blue-600 dark:text-blue-300 mr-1 flex-shrink-0">{msg.username}:</span>
                  {/* Add break-words for proper message wrapping */}
                  <span className="text-slate-800 dark:text-slate-100 break-words">{msg.message}</span> 
                </div>
              ))}
            </div>
            <div className="flex">
              <input
                type="text"
                placeholder="Type a message..."
                className="flex-1 min-w-0 p-2 border border-slate-300 rounded-l-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none dark:bg-slate-600 dark:border-slate-500 dark:text-white text-sm" // Added min-w-0
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