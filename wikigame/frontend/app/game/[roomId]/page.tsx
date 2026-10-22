// frontend/app/game/[roomId]/page.tsx
"use client";
import React, { useEffect, useState, use, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import { ExternalLink, Loader2, Trophy, Search, Info, X, ChevronUp, ChevronDown, Menu, Home } from 'lucide-react';
import Mark from 'mark.js';
import { useGameState } from '@/app/hooks/useGameState';
import { LoadingScreen } from '@/app/components/LoadingScreen';

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
  disconnected?: boolean;
}

interface AiSolution {
  path: string[];
  clicks: number;
  timeMs: number;
  found: boolean;
}

interface FinalRank {
  id: string;
  username: string;
  clicks: number;
  finished: boolean;
  lost: boolean;
  time: number | null;
  closeness: number;
}

interface RoomData {
  players: { [key: string]: Player };
  startArticle: string;
  goalArticle: string;
  status: 'waiting' | 'playing' | 'finished';
  startTime?: number;
  roundEndsAt?: number | null;
  hostId: string | null;
  aiSolution?: AiSolution | null;
  aiSolving?: boolean;
  finalRanking?: FinalRank[] | null;
  endReason?: string | null;
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

const WikiArticle = React.memo(({
  html,
  loading,
  error,
  onClick
}: {
  html: string,
  loading: boolean,
  error: boolean,
  onClick: (e: React.MouseEvent) => void
}) => {
  return (
    <div
      className={`wiki-article-container transition-all duration-300 ${loading ? 'opacity-50 blur-sm pointer-events-none' : 'opacity-100'} ${error ? 'hidden' : ''}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

WikiArticle.displayName = 'WikiArticle';

function CountdownTimer({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, endsAt - now);
  const totalSec = Math.ceil(remaining / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const urgent = remaining < 30000;
  return (
    <div className={`flex flex-col items-center px-4 py-2 rounded-2xl backdrop-blur-sm border ${urgent ? 'bg-red-600/40 border-red-300/40 animate-pulse' : 'bg-blue-800/40 dark:bg-slate-700/50 border-white/10'}`}>
      <p className="text-[10px] text-blue-200 uppercase font-black tracking-widest mb-0 md:mb-1">Time Left</p>
      <p className={`text-2xl md:text-3xl font-black leading-none ${urgent ? 'text-red-100' : 'text-white'} drop-shadow-sm tabular-nums`}>
        {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </p>
    </div>
  );
}

function ConfettiBurst({ trigger }: { trigger: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (trigger <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#fde047'];
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;

    type Particle = {
      x: number; y: number; vx: number; vy: number;
      size: number; color: string; rot: number; vrot: number;
      life: number; ttl: number; shape: 'rect' | 'circle';
    };

    const particles: Particle[] = [];
    const spawn = (originX: number, originY: number, count: number, spreadPower: number) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 2);
        const power = spreadPower * (0.6 + Math.random() * 0.8);
        particles.push({
          x: originX, y: originY,
          vx: Math.cos(angle) * power + (Math.random() - 0.5) * 4,
          vy: Math.sin(angle) * power - Math.random() * 4,
          size: 6 + Math.random() * 8,
          color: colors[Math.floor(Math.random() * colors.length)],
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 0.3,
          life: 0,
          ttl: 220 + Math.random() * 80,
          shape: Math.random() < 0.6 ? 'rect' : 'circle',
        });
      }
    };

    spawn(W() * 0.1, H() * 0.85, 90, 16);
    spawn(W() * 0.9, H() * 0.85, 90, 16);
    spawn(W() * 0.5, H() * 0.55, 70, 14);

    let raf = 0;
    const gravity = 0.35;
    const drag = 0.992;

    const tick = () => {
      ctx.clearRect(0, 0, W(), H());
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        p.life++;

        const t = p.life / p.ttl;
        const alpha = Math.max(0, 1 - t * t);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        if (p.life >= p.ttl || p.y > H() + 40) {
          particles.splice(i, 1);
        }
      }
      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [trigger]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[90]"
      aria-hidden="true"
    />
  );
}

const serverUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

type GameParams = {
  roomId: string;
};

export default function Game({ params }: { params: Promise<GameParams> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.roomId;

  const searchParams = useSearchParams();
  const username = searchParams.get('user');

  const { saveState } = useGameState(roomId, username || '');

  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [html, setHtml] = useState<string>("");
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [articleFetchError, setArticleFetchError] = useState<string | null>(null);
  const [failedNavigationTarget, setFailedNavigationTarget] = useState<string | null>(null);
  const [goalArticleSummary, setGoalArticleSummary] = useState<ArticleSummary | null>(null);
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [hints, setHints] = useState<string[]>([]);
  const [loadingHint, setLoadingHint] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchStats, setSearchStats] = useState({ current: 0, total: 0 });
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [confettiTrigger, setConfettiTrigger] = useState(0);

  const chatDisplayRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const markInstance = useRef<Mark | null>(null);
  const markedNodeRef = useRef<HTMLElement | null>(null);
  const searchTokenRef = useRef(0);

  const roomDataRef = useRef<RoomData | null>(roomData);
  const loadingArticleRef = useRef(false);
  const lastSavedStateRef = useRef<string>('');
  const celebratedRef = useRef(false);

  useEffect(() => { roomDataRef.current = roomData; }, [roomData]);
  useEffect(() => { loadingArticleRef.current = loadingArticle; }, [loadingArticle]);

  const [headerHeight, setHeaderHeight] = useState(0);

  const handleSearchFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  }, []);

  // 1. Initialize socket
  useEffect(() => {
    if (!username || !roomId) return;

    const newSocket = io(serverUrl);
    setSocketInstance(newSocket);

    const onConnect = () => {
      newSocket.emit('joinRoom', { roomId, username });
    };

    const onArticleNavigationError = ({ message, failedTargetTitle }: { message: string, failedTargetTitle: string }) => {
      console.error("Server reported navigation error:", message);
      setArticleFetchError(message);
      setFailedNavigationTarget(failedTargetTitle);
      setLoadingArticle(false);
    };

    const onChatMessage = (message: ChatMessage) => {
      setChatMessages((prevMessages) => [...prevMessages, message]);
    };

    const onRoomLeftConfirmation = () => {
      alert("You have left the room.");
      window.location.href = '/';
    };

    newSocket.on('connect', onConnect);
    newSocket.on('articleNavigationError', onArticleNavigationError);
    newSocket.on('chatMessage', onChatMessage);
    newSocket.on('roomLeftConfirmation', onRoomLeftConfirmation);

    return () => {
      newSocket.off('connect', onConnect);
      newSocket.off('articleNavigationError', onArticleNavigationError);
      newSocket.off('chatMessage', onChatMessage);
      newSocket.off('roomLeftConfirmation', onRoomLeftConfirmation);
      newSocket.disconnect();
    };
  }, [roomId, username]);

  // 2. Room update listener
  useEffect(() => {
    if (!socketInstance) return;

    const handleRoomUpdate = (data: RoomData) => {
      if (data.status === 'waiting' && roomData?.status && roomData.status !== 'waiting') {
        setHtml("");
        setHints([]);
        setGoalArticleSummary(null);
        setArticleFetchError(null);
        setFailedNavigationTarget(null);
        setSearchQuery('');
        celebratedRef.current = false;
      }

      setRoomData(data);

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
  }, [socketInstance, roomData]);

  // Confetti on genuine win
  useEffect(() => {
    if (!socketInstance?.id || !roomData) return;
    const me = roomData.players[socketInstance.id];
    const isWinner = !!me && me.finished && !me.lost;
    if (isWinner && !celebratedRef.current) {
      celebratedRef.current = true;
      setConfettiTrigger(Date.now());
    }
  }, [roomData, socketInstance?.id]);

  // Measure header height
  useEffect(() => {
    if (headerRef.current) {
      setHeaderHeight(headerRef.current.offsetHeight);
    }
    const handleResize = () => {
      if (headerRef.current) {
        setHeaderHeight(headerRef.current.offsetHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [roomData, showMobileSidebar]);

  // Fetch current article content
  useEffect(() => {
    const fetchContent = async () => {
      const socketId = socketInstance?.id;
      if (!socketId) return;

      const me = roomData?.players[socketId];

      if (me && !me.finished && roomData?.status === 'playing' && me.currentArticle) {
        setLoadingArticle(true);
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
          if (mainContainerRef.current) {
            mainContainerRef.current.scrollTop = 0;
          }
          setLoadingArticle(false);
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Unknown error';
          console.error("Frontend: Error fetching article content:", errorMessage);
          setArticleFetchError(`Failed to load article content for "${me.currentArticle.replace(/_/g, ' ')}": ${errorMessage}. You can try retrying.`);
          setFailedNavigationTarget(me.currentArticle);
          setHtml(`<div class="text-red-500 font-semibold text-center mt-8">
                      <p>Error fetching content for ${me.currentArticle.replace(/_/g, ' ')}.</p>
                      <p class="text-sm mt-2">The server acknowledges you are on this page, but your browser couldn't load its content. Try again.</p>
                     </div>`);
          setLoadingArticle(false);
        }
      }
    };
    fetchContent();
  }, [roomData?.status, socketInstance?.id, roomData?.players]);

  // Fetch goal summary
  useEffect(() => {
    const fetchSummary = async () => {
      if (roomData?.goalArticle && !goalArticleSummary) {
        try {
          const res = await fetch(`${serverUrl}/api/wiki-summary/${encodeURIComponent(roomData.goalArticle)}`);
          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
          }
          const summary = await res.json();
          setGoalArticleSummary(summary);
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Unknown error';
          console.error("Fetch goal summary error:", errorMessage);
        }
      }
    };
    fetchSummary();
  }, [roomData?.goalArticle, goalArticleSummary]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatDisplayRef.current) {
      chatDisplayRef.current.scrollTop = chatDisplayRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const scrollToMatch = useCallback((index: number) => {
    const matches = articleRef.current?.querySelectorAll('.search-highlight');
    if (!matches || matches.length === 0) return;
    const safeIndex = Math.min(Math.max(index, 0), matches.length - 1);
    matches.forEach(m => m.classList.remove('current-search-highlight'));
    const el = matches[safeIndex];
    if (!el) return;
    el.classList.add('current-search-highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const performSearch = useCallback(() => {
    if (!articleRef.current) return;

    if (!markInstance.current || markedNodeRef.current !== articleRef.current) {
      markInstance.current = new Mark(articleRef.current);
      markedNodeRef.current = articleRef.current;
    }

    const token = ++searchTokenRef.current;

    markInstance.current.unmark({
      done: () => {
        if (token !== searchTokenRef.current) return;

        if (!debouncedSearchQuery.trim()) {
          setSearchStats({ current: 0, total: 0 });
          return;
        }
        markInstance.current?.mark(debouncedSearchQuery, {
          className: 'search-highlight',
          acrossElements: true,
          separateWordSearch: false,
          done: (totalMatches: number) => {
            if (token !== searchTokenRef.current) return;

            setSearchStats(prev => {
              const nextCurrent = totalMatches === 0
                ? 0
                : Math.min(Math.max(prev.current || 1, 1), totalMatches);

              if (totalMatches > 0) {
                requestAnimationFrame(() => {
                  if (token === searchTokenRef.current) {
                    scrollToMatch(nextCurrent - 1);
                  }
                });
              }
              return { total: totalMatches, current: nextCurrent };
            });
          }
        });
      }
    });
  }, [debouncedSearchQuery, scrollToMatch]);

  useEffect(() => {
    performSearch();
  }, [performSearch, html]);

  const findNext = useCallback(() => {
    setSearchStats(prev => {
      if (prev.total === 0) return prev;
      const nextIndex = (prev.current % prev.total) + 1;
      // Defer the scroll so it runs after React commits the new count.
      const token = searchTokenRef.current;
      requestAnimationFrame(() => {
        if (token === searchTokenRef.current) scrollToMatch(nextIndex - 1);
      });
      return { ...prev, current: nextIndex };
    });
  }, [scrollToMatch]);

  const findPrevious = useCallback(() => {
    setSearchStats(prev => {
      if (prev.total === 0) return prev;
      const prevIndex = prev.current === 1 ? prev.total : prev.current - 1;
      const token = searchTokenRef.current;
      requestAnimationFrame(() => {
        if (token === searchTokenRef.current) scrollToMatch(prevIndex - 1);
      });
      return { ...prev, current: prevIndex };
    });
  }, [scrollToMatch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (e.key === 'Escape') {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
      if (e.target === searchInputRef.current && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) findPrevious();
        else findNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [findNext, findPrevious]);

  const handleWikiClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');

    const currentRoomData = roomDataRef.current;
    const isLoading = loadingArticleRef.current;

    const myPlayer = socketInstance?.id ? currentRoomData?.players[socketInstance.id] : undefined;

    if (anchor && currentRoomData?.status === 'playing' && myPlayer && !myPlayer.finished) {
      if (currentRoomData.roundEndsAt && Date.now() >= currentRoomData.roundEndsAt) return;

      const dataTitle = anchor.getAttribute('data-title');
      if (dataTitle) {
        e.preventDefault();
        if (!isLoading && socketInstance) {
          setArticleFetchError(null);
          setFailedNavigationTarget(null);
          setLoadingArticle(true);
          socketInstance.emit('navigate', { roomId, targetTitle: dataTitle });
        }
      }
    }
  }, [socketInstance, roomId]);

  // FIXED: retry uses dedicated event, no click penalty if it was the same load
  const handleRetry = () => {
    if (socketInstance && failedNavigationTarget) {
      setArticleFetchError(null);
      setFailedNavigationTarget(null);
      setLoadingArticle(true);
      socketInstance.emit('retryNavigation', { roomId, targetTitle: failedNavigationTarget });
    } else {
      const me = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined;
      if (socketInstance && me?.currentArticle) {
        // Re-fetch current article without moving
        setArticleFetchError(null);
        setLoadingArticle(true);
        (async () => {
          try {
            const res = await fetch(`${serverUrl}/api/wiki/${encodeURIComponent(me.currentArticle)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setHtml(data.html);
            setLoadingArticle(false);
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            setArticleFetchError(`Still can't load "${me.currentArticle.replace(/_/g, ' ')}": ${msg}`);
            setLoadingArticle(false);
          }
        })();
      }
    }
  };

  // FIXED: goBack emits dedicated event; server does NOT increment clicks
  const handleGoBack = () => {
    setArticleFetchError(null);
    setFailedNavigationTarget(null);
    setLoadingArticle(false);

    const me = socketInstance?.id ? roomData?.players[socketInstance.id] : undefined;
    if (me && me.history.length > 1 && socketInstance) {
      socketInstance.emit('goBack', { roomId });
    }
  };

  const handleLeaveRoom = () => {
    if (socketInstance && roomId && confirm("Are you sure you want to leave this room? Your progress will be lost.")) {
      socketInstance.emit('leaveRoom', { roomId });
    }
  };

  // FIXED: no longer sends username (server ignores it anyway)
  const handleSendMessage = () => {
    if (socketInstance && chatInput.trim() && username && roomId) {
      socketInstance.emit('chatMessage', { roomId, message: chatInput });
      setChatInput('');
    }
  };

  const getWikiHint = async () => {
    if (!me || me.finished || !roomData || !socketInstance) return;

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
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error("Hint error:", errorMessage);
      setHints(["Hint currently unavailable"]);
    } finally {
      setLoadingHint(false);
    }
  };

  useEffect(() => {
    if (roomData && socketInstance?.id) {
      const me = roomData.players[socketInstance.id];
      if (me) {
        const stateToSave = {
          currentArticle: me.currentArticle,
          history: me.history,
          clicks: me.clicks,
          points: me.points
        };
        const stateString = JSON.stringify(stateToSave);
        if (stateString !== lastSavedStateRef.current) {
          lastSavedStateRef.current = stateString;
          saveState(stateToSave);
        }
      }
    }
  }, [roomData, socketInstance?.id, saveState]);

  if (!roomData || !socketInstance) {
    return <LoadingScreen isConnected={socketInstance?.connected || false} />;
  }

  const me = roomData.players[socketInstance.id];
  const isWinner = !!me && me.finished && !me.lost;
  const isEliminated = !!me && me.finished && !!me.lost;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 font-sans relative">
      <ConfettiBurst trigger={confettiTrigger} />

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
      <div ref={headerRef} className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white p-3 sm:p-4 flex flex-col md:flex-row justify-between items-center gap-3 md:gap-0 sticky top-0 z-50 shadow-lg dark:from-slate-800 dark:to-slate-900">
        <div className="text-center md:text-left mb-2 md:mb-0 max-w-full md:max-w-[40%]">
          <div className="flex items-center gap-2 justify-center md:justify-start">
            <div className="p-1.5 bg-yellow-400 rounded-lg text-blue-900 shadow-sm hidden md:block">
              <Trophy size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] md:text-xs text-blue-200 uppercase font-black tracking-widest leading-none mb-1">Target Goal</p>
              <div className="flex items-center justify-center md:justify-start gap-1.5 min-w-0">
                <h1 className="text-sm sm:text-base md:text-xl lg:text-2xl font-black text-yellow-300 leading-tight truncate">
                  {roomData.goalArticle.replace(/_/g, ' ')}
                </h1>
                <button
                  onClick={() => setShowGoalModal(true)}
                  className="text-yellow-300 hover:text-white transition-colors bg-white/10 p-1 rounded flex-shrink-0"
                  title="Goal Info"
                >
                  <Info size={14} />
                </button>
                {goalArticleSummary?.content_urls?.desktop?.page && (
                  <a
                    href={goalArticleSummary.content_urls.desktop.page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-yellow-300 hover:text-white transition-colors flex-shrink-0"
                    aria-label={`Open ${roomData.goalArticle} on Wikipedia`}
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4">
          {roomData.status === 'playing' && roomData.roundEndsAt && (
            <CountdownTimer endsAt={roomData.roundEndsAt} />
          )}
          <div className="bg-blue-800/40 dark:bg-slate-700/50 px-6 py-2 rounded-2xl backdrop-blur-sm border border-white/10 flex flex-row md:flex-col items-center gap-3 md:gap-0">
            <p className="text-[10px] text-blue-200 uppercase font-black tracking-widest mb-0 md:mb-1">Clicks</p>
            <p className="text-2xl md:text-3xl font-black leading-none text-white drop-shadow-sm">{me?.clicks || 0}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4 mt-3 md:mt-0">
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
            className="md:hidden bg-blue-500 text-white p-2 rounded-xl shadow-lg border border-white/20 hover:bg-blue-600 transition-colors"
            onClick={() => setShowMobileSidebar(!showMobileSidebar)}
            aria-label="Toggle sidebar"
          >
            {showMobileSidebar ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      {roomData.status === 'playing' && me && !me.finished && (
        <div className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 overflow-x-auto whitespace-nowrap shadow-inner">
          <div className="flex items-center gap-2 px-4 text-[10px] md:text-xs">
            <span className="font-bold text-slate-500 dark:text-slate-400 uppercase">Your Path:</span>
            {me.history.map((step: string, i: number) => (
              <React.Fragment key={i}>
                <span className="px-2 py-0.5 bg-white dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 font-medium text-slate-700 dark:text-slate-200">
                  {step.replace(/_/g, ' ')}
                </span>
                {i < (me.history.length - 1) && <span className="text-slate-400">→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          id="mobile-sidebar"
          className={`
            w-72 max-w-[85vw] bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 p-4 sm:p-5 overflow-y-auto shadow-2xl md:shadow-inner
            fixed right-0 bottom-0 z-40 transform transition-transform duration-300 ease-in-out md:static md:translate-x-0 md:w-72
            ${showMobileSidebar ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
          `}
          style={{
            top: `${headerHeight}px`,
            height: `calc(100vh - ${headerHeight}px)`
          }}
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
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1">
                        <span className={`font-semibold text-sm truncate ${p.id === socketInstance?.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                          {p.username}
                        </span>
                        {p.id === socketInstance?.id && (
                          <span className="text-[10px] bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200 px-1.5 py-0.5 rounded whitespace-nowrap">You</span>
                        )}
                        {p.id === roomData.hostId && (
                          <span className="text-[10px] bg-yellow-100 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-200 px-1.5 py-0.5 rounded whitespace-nowrap">Host</span>
                        )}
                        {p.disconnected && (
                          <span className="text-[10px] text-amber-500 font-normal whitespace-nowrap">· reconnecting…</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {p.currentArticle.replace(/_/g, ' ')}
                      </div>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0 ml-2">
                      <span className="text-xs font-mono bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {p.clicks} clicks
                      </span>
                      <span className={`text-[10px] font-bold mt-0.5 ${p.points < 0 ? 'text-red-500' : 'text-green-500'}`}>
                        Score: {p.points}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-400">Hints: {p.hintCount || 0}</span>
                    {p.finished && (
                      <div className={`flex items-center font-bold text-xs ${p.lost ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                        {p.lost ? (
                          <span className="text-[10px]">ELIMINATED</span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px]">
                            <Trophy size={12} /> FINISHED! ({Math.floor(p.time || 0)}s)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {p.history.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.history.slice(-3).map((h: string, i: number) => (
                        <span key={i} className="text-[8px] bg-slate-200 dark:bg-slate-600 px-1.5 py-0.5 rounded opacity-70 truncate max-w-[60px]">
                          {h.length > 8 ? h.substring(0, 8) + '…' : h.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>

          {/* Chat */}
          <div className="mt-8">
            <h2 className="font-bold text-lg mb-4 pb-2 border-b border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">Room Chat</h2>
            <div ref={chatDisplayRef} className="bg-slate-50 dark:bg-slate-700 h-60 overflow-y-auto p-3 rounded-lg border border-slate-200 dark:border-slate-600 mb-3 flex flex-col space-y-2 text-sm">
              {chatMessages.map((msg, index) => (
                <div key={index} className="flex items-start">
                  <span className="font-semibold text-blue-600 dark:text-blue-300 mr-1 shrink-0">{msg.username}:</span>
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

        {/* Main content */}
        <main
          ref={mainContainerRef}
          className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 relative"
        >
          {showMobileSidebar && (
            <div
              className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
              onClick={() => setShowMobileSidebar(false)}
            ></div>
          )}

          {roomData.status === 'waiting' ? (
            <div className="flex flex-col items-center justify-center min-h-full p-6 text-slate-400 dark:text-slate-500 text-center">
              <Loader2 className="animate-spin text-blue-500 dark:text-blue-400 mb-4" size={48} />
              <p className="text-2xl font-semibold">Waiting for host to start the race...</p>
              <p className="text-sm mt-2">Start: <span className="font-bold text-slate-600 dark:text-slate-300">{roomData.startArticle.replace(/_/g, ' ')}</span></p>
              <p className="text-sm">Goal: <span className="font-bold text-slate-600 dark:text-slate-300">{roomData.goalArticle.replace(/_/g, ' ')}</span></p>
              {roomData.aiSolving && (
                <p className="text-xs text-amber-500 font-semibold mt-3 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  AI is computing the optimal path...
                </p>
              )}
              {!roomData.aiSolving && roomData.aiSolution?.found && (
                <p className="text-xs text-emerald-500 font-semibold mt-3">
                  🤖 AI solved it in {roomData.aiSolution.clicks} clicks ({(roomData.aiSolution.timeMs / 1000).toFixed(1)}s)
                </p>
              )}
            </div>
          ) : (roomData.status === 'finished' || (me && me.finished)) ? (
            <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10 space-y-6">

              <div className={`rounded-3xl p-6 sm:p-8 lg:p-10 text-center shadow-2xl border-2 relative overflow-hidden
                ${isWinner
                  ? 'bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 dark:from-emerald-950 dark:via-green-950 dark:to-teal-950 border-emerald-300 dark:border-emerald-700'
                  : isEliminated
                    ? 'bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-950 dark:to-orange-950 border-red-300 dark:border-red-700'
                    : roomData.status === 'finished'
                      ? 'bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-blue-300 dark:border-blue-700'
                      : 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-slate-300 dark:border-slate-700'}`}
              >
                {isWinner ? (
                  <>
                    <div className="text-6xl sm:text-7xl mb-3">🏆</div>
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent mb-2">
                      Victory!
                    </h2>
                    <p className="text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-300 mb-1">
                      You reached the goal!
                    </p>
                    <div className="flex flex-wrap justify-center gap-3 sm:gap-4 mt-6">
                      <Stat label="Clicks" value={me?.clicks ?? 0} accent="emerald" />
                      <Stat label="Time" value={`${Math.floor(me?.time ?? 0)}s`} accent="emerald" />
                      <Stat label="Score" value={me?.points ?? 0} accent="emerald" />
                    </div>
                    {roomData.status === 'playing' && (
                      <div className="mt-6 inline-flex items-center gap-2 py-2 px-4 bg-white/70 dark:bg-slate-900/60 rounded-xl border border-emerald-200 dark:border-emerald-800">
                        <Loader2 className="animate-spin text-emerald-500" size={16} />
                        <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Waiting for others to finish…</span>
                      </div>
                    )}
                  </>
                ) : isEliminated ? (
                  <>
                    <div className="text-6xl sm:text-7xl mb-3">⏱️</div>
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-red-600 dark:text-red-400 mb-2">
                      Eliminated
                    </h2>
                    <p className="text-base sm:text-lg font-bold text-red-600/80 dark:text-red-300/80">
                      A faster player beat your click count. Still a great run!
                    </p>
                    <div className="flex flex-wrap justify-center gap-3 sm:gap-4 mt-6">
                      <Stat label="Clicks" value={me?.clicks ?? 0} accent="red" />
                      <Stat label="Score" value={me?.points ?? 0} accent="red" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-6xl sm:text-7xl mb-3">🏁</div>
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-blue-700 dark:text-blue-300 mb-2">
                      Race Over
                    </h2>
                    <p className="text-base sm:text-lg font-semibold text-slate-600 dark:text-slate-400">
                      {roomData.endReason === 'timeout' ? "⏰ Time expired!" : "Round complete"} · Room {roomId}
                    </p>
                  </>
                )}
              </div>

              {me && me.history.length > 0 && (
                <SectionCard title="Your Path" badge={`${me.history.length - 1} clicks`} accent="blue">
                  <PathFlow path={me.history.map(s => s.replace(/_/g, ' '))} />
                </SectionCard>
              )}

              <SectionCard
                title="🤖 AI Optimal Path"
                accent="indigo"
                badge={
                  roomData.aiSolving ? (
                    <span className="flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> Solving…
                    </span>
                  ) : roomData.aiSolution?.found ? (
                    <span>{roomData.aiSolution.clicks} clicks · {(roomData.aiSolution.timeMs / 1000).toFixed(1)}s</span>
                  ) : (
                    <span className="text-red-500">No path found</span>
                  )
                }
              >
                {roomData.aiSolution?.found && roomData.aiSolution.path.length > 0 ? (
                  <>
                    <PathFlow path={roomData.aiSolution.path} variant="ai" />
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <CompareStat label="You" value={me?.clicks ?? 0} color="blue" />
                      <CompareStat label="AI" value={roomData.aiSolution.clicks} color="indigo" />
                    </div>
                    <p className="mt-4 text-center text-sm font-bold text-slate-600 dark:text-slate-400">
                      {(me?.clicks ?? 0) <= roomData.aiSolution.clicks
                        ? "🎉 You matched or beat the AI!"
                        : `You were ${(me?.clicks ?? 0) - roomData.aiSolution.clicks} click(s) over the optimal path.`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                    {roomData.aiSolving ? "The AI is still computing the optimal route…" : "The AI couldn't find a path within the depth limit."}
                  </p>
                )}
              </SectionCard>

              {roomData.finalRanking && roomData.finalRanking.length > 0 && (
                <SectionCard
                  title="🏆 Final Standings"
                  accent="amber"
                  badge={roomData.endReason === 'timeout' ? 'Time expired' : undefined}
                >
                  <ol className="space-y-2">
                    {roomData.finalRanking.map((r, i) => (
                      <li
                        key={r.id}
                        className={`flex items-center justify-between gap-3 rounded-xl p-3 border transition-colors
                          ${i === 0 && r.finished && !r.lost
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}
                          ${r.id === socketInstance?.id ? 'ring-2 ring-blue-400/60' : ''}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`text-lg font-black w-6 shrink-0 ${i === 0 && r.finished && !r.lost ? 'text-amber-500' : 'text-slate-400'}`}>
                            {i + 1}
                          </span>
                          <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{r.username}</span>
                          {r.id === socketInstance?.id && (
                            <span className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded shrink-0">You</span>
                          )}
                          {r.finished && !r.lost && <span className="text-[10px] font-black text-green-600 shrink-0">✓ DONE</span>}
                          {r.lost && <span className="text-[10px] font-black text-red-500 shrink-0">OUT</span>}
                        </div>
                        <div className="text-right text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">
                          <div>{r.clicks} clicks</div>
                          {r.closeness >= 0 && !r.finished && (
                            <div className="text-[10px] text-slate-400">{r.closeness} hop(s) from goal</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </SectionCard>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                {(roomData.status === 'finished' || me?.finished) && socketInstance?.id === roomData.hostId && (
                  <button
                    onClick={() => {
                      if (roomData.status !== 'finished' && !confirm("Some players are still racing. Reset game for everyone?")) return;
                      socketInstance.emit('playAgain', roomId);
                    }}
                    className="px-8 py-3.5 bg-green-600 text-white rounded-xl font-bold text-base shadow-xl hover:bg-green-700 transition-all hover:-translate-y-0.5 active:translate-y-0"
                  >
                    Play Again
                  </button>
                )}
                <button
                  onClick={() => window.location.href = '/'}
                  className="px-8 py-3.5 bg-slate-800 dark:bg-slate-700 text-white rounded-xl font-bold text-base shadow-xl hover:bg-slate-900 transition-all hover:-translate-y-0.5 active:translate-y-0 inline-flex items-center justify-center gap-2"
                >
                  <Home size={18} /> Exit Game
                </button>
              </div>
            </div>
          ) : (
            <>
              {roomData.status === 'playing' && !me?.finished && !loadingArticle && !articleFetchError && (
                <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-sm mb-6">
                  <div className="max-w-4xl mx-auto px-4 py-3">
                    <div className="relative flex items-center gap-3">
                      <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                          ref={searchInputRef}
                          type="text"
                          placeholder="Search within this article (Ctrl+F)"
                          className="w-full pl-12 pr-32 py-3 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-900/30 outline-none text-base dark:text-white transition-all duration-200"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onFocus={handleSearchFocus}
                          aria-label="Search article content"
                        />
                        {searchQuery && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-white dark:bg-slate-700 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600">
                            <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300" aria-live="polite">
                              {searchStats.total > 0 ? `${searchStats.current}/${searchStats.total}` : '0 matches'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSearchQuery('')}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={findPrevious}
                          disabled={searchStats.total === 0}
                          className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 transition-all shadow-sm border border-slate-200 dark:border-slate-700"
                          title="Previous match (Shift+Enter)"
                        >
                          <ChevronUp size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={findNext}
                          disabled={searchStats.total === 0}
                          className="p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-30 transition-all shadow-sm"
                          title="Next match (Enter)"
                        >
                          <ChevronDown size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {hints.length > 0 && (
                <div className="mx-3 sm:mx-4 md:mx-6 mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 rounded-lg mb-4 flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-amber-600 font-bold text-sm uppercase">Hints:</span>
                    <div className="flex gap-2 flex-wrap">
                      {hints.map((h, i) => (
                        <span key={i} className="bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-amber-200 text-xs font-semibold">{h}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setHints([])} className="text-amber-500 hover:text-amber-700 text-xs font-bold shrink-0">Close</button>
                </div>
              )}

              {loadingArticle && (
                <div className="fixed inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-50">
                  <div className="glass rounded-2xl p-8 text-center animate-in fade-in zoom-in duration-300">
                    <Loader2 className="animate-spin text-blue-400 mx-auto mb-4" size={48} />
                    <p className="text-white font-medium">Loading article...</p>
                    <p className="text-white/40 text-sm mt-1">Getting the latest content</p>
                  </div>
                </div>
              )}

              {articleFetchError && (
                <div className="text-red-500 bg-red-50 dark:bg-red-950 p-4 rounded-lg mx-3 sm:mx-4 md:mx-6 mt-4 mb-4 border border-red-200 dark:border-red-800 text-center max-w-lg md:mx-auto">
                  <p className="font-semibold text-lg mb-2">Error!</p>
                  <p className="text-base">{articleFetchError}</p>
                  <div className="flex flex-wrap justify-center gap-3 mt-4">
                    {failedNavigationTarget && (
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
                      Go Back
                    </button>
                  </div>
                </div>
              )}

              <div className="px-3 sm:px-4 md:px-6 lg:px-8 pb-8">
                <div className="article-content-wrapper max-w-4xl mx-auto" ref={articleRef}>
                  <WikiArticle
                    html={html}
                    loading={loadingArticle}
                    error={!!articleFetchError}
                    onClick={handleWikiClick}
                  />
                  {articleFetchError && (
                    <div className="text-center text-slate-500 dark:text-slate-400 mt-6">
                      <p>Currently viewing: <span className="font-semibold">{me?.currentArticle.replace(/_/g, ' ') || 'Unknown'}</span></p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: 'emerald' | 'red' | 'blue' | 'indigo' }) {
  const colorMap = {
    emerald: 'text-emerald-700 dark:text-emerald-300',
    red: 'text-red-600 dark:text-red-400',
    blue: 'text-blue-700 dark:text-blue-300',
    indigo: 'text-indigo-700 dark:text-indigo-300',
  } as const;
  return (
    <div className="min-w-[90px] bg-white/80 dark:bg-slate-900/60 rounded-xl px-4 py-2 border border-slate-200 dark:border-slate-700 shadow-sm">
      <p className="text-[10px] uppercase font-black text-slate-400 tracking-wider">{label}</p>
      <p className={`text-xl sm:text-2xl font-black ${colorMap[accent]}`}>{value}</p>
    </div>
  );
}

function CompareStat({ label, value, color }: { label: string; value: number; color: 'blue' | 'indigo' }) {
  const colorMap = {
    blue: 'text-blue-600 dark:text-blue-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
  } as const;
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700">
      <p className="text-[10px] uppercase font-black text-slate-400">{label}</p>
      <p className={`text-2xl font-black ${colorMap[color]}`}>{value}</p>
      <p className="text-[10px] text-slate-400">clicks</p>
    </div>
  );
}

function SectionCard({
  title,
  badge,
  accent,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  accent: 'blue' | 'indigo' | 'amber';
  children: React.ReactNode;
}) {
  const accentMap = {
    blue: 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20',
    indigo: 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20',
    amber: 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20',
  } as const;
  const titleColor = {
    blue: 'text-blue-700 dark:text-blue-300',
    indigo: 'text-indigo-700 dark:text-indigo-300',
    amber: 'text-amber-700 dark:text-amber-300',
  } as const;
  return (
    <div className={`rounded-2xl border p-4 sm:p-6 shadow-sm ${accentMap[accent]}`}>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className={`text-xs sm:text-sm font-black uppercase tracking-widest ${titleColor[accent]}`}>{title}</h3>
        {badge && <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{badge}</div>}
      </div>
      {children}
    </div>
  );
}

function PathFlow({ path, variant = 'player' }: { path: string[]; variant?: 'player' | 'ai' }) {
  if (!path || path.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-2">No path recorded.</p>;
  }
  const startColor = variant === 'ai' ? 'bg-indigo-600 border-indigo-500' : 'bg-blue-600 border-blue-500';
  const endColor = variant === 'ai' ? 'bg-purple-600 border-purple-500' : 'bg-green-600 border-green-500';
  const arrowColor = variant === 'ai' ? 'text-indigo-300 dark:text-indigo-700' : 'text-slate-300 dark:text-slate-600';

  return (
    <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center">
      {path.map((step, i) => (
        <React.Fragment key={i}>
          <span
            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border text-xs sm:text-sm font-bold whitespace-nowrap shadow-sm
              ${i === 0 ? `${startColor} text-white` :
                i === path.length - 1 ? `${endColor} text-white` :
                'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600'}`}
            title={step}
          >
            {step}
          </span>
          {i < path.length - 1 && (
            <span className={`text-sm ${arrowColor}`}>→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}