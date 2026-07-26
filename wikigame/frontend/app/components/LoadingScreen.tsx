"use client";
import { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

const loadingTips = [
  '💡 Did you know? Wikipedia has over 6 million articles in English!',
  '🎯 Click on blue links to navigate between articles.',
  '🏆 The goal is to reach the target article in the fewest clicks.',
  '⏱️ Your time starts when the host clicks "Start Race"!',
  '🔍 Use Ctrl+F to search within an article.',
  '💡 Use hints if you get stuck (costs points though!).',
  '📚 Wikipedia articles are written by volunteers worldwide.',
  '🚀 The shortest path is often through broad categories first.',
  '🌍 Wikipedia is available in over 300 languages!',
  '🏅 The player with the fewest clicks wins the race!',
];

interface LoadingScreenProps {
  isConnected?: boolean;
}

export function LoadingScreen({ isConnected = false }: LoadingScreenProps) {
  const [tipIndex, setTipIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % loadingTips.length);
    }, 4000);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 10;
      });
    }, 500);

    return () => {
      clearInterval(tipInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 font-sans px-6 text-center bg-grid-pattern">
      {/* Animated Wikipedia Globe */}
      <div className="relative mb-8">
        <div className="w-32 h-32 rounded-full border-4 border-blue-500/20 animate-spin-slow">
          <div className="w-full h-full rounded-full border-4 border-blue-500/40 border-t-blue-500 animate-spin" style={{ animationDuration: '3s' }}></div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-2xl animate-float flex items-center justify-center">
            <span className="text-white font-bold text-3xl">W</span>
          </div>
        </div>
        {/* Pulsing rings */}
        <div className="absolute inset-[-20px] rounded-full border-2 border-blue-400/10 animate-ping"></div>
        <div className="absolute inset-[-40px] rounded-full border-2 border-purple-400/5 animate-ping" style={{ animationDelay: '0.5s' }}></div>
      </div>
      
      <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent mb-2">
        Getting Your Race Ready
      </h2>
      
      <p className="text-slate-500 dark:text-slate-400 mb-4">
        Connecting to the game server...
      </p>
      
      {/* Progress bar */}
      <div className="w-64 max-w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-6 overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(progress, 90)}%` }}
        />
      </div>
      
      {/* Loading dots */}
      <div className="flex gap-2 mb-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
            style={{
              animation: 'bounce 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      
      {/* Connection status */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white/60 dark:bg-slate-800/60 rounded-full backdrop-blur-sm border border-slate-200 dark:border-slate-700 mb-4">
        {isConnected ? (
          <>
            <Wifi size={16} className="text-green-500" />
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">Connected</span>
          </>
        ) : (
          <>
            <WifiOff size={16} className="text-amber-500" />
            <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">Connecting...</span>
          </>
        )}
      </div>
      
      {/* Tips */}
      <div className="max-w-md w-full">
        <div className="bg-white/70 dark:bg-slate-800/70 rounded-xl p-4 backdrop-blur-sm border border-slate-200/50 dark:border-slate-700/50 shadow-lg transition-all duration-500 min-h-[80px] flex items-center justify-center">
          <p className="text-sm text-slate-600 dark:text-slate-300 animate-fade-in text-center">
            {loadingTips[tipIndex]}
          </p>
        </div>
      </div>
    </div>
  );
}