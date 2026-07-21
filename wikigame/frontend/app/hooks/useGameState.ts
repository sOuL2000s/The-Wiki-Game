// frontend/app/hooks/useGameState.ts
import { useState, useEffect, useCallback, useRef } from 'react';

interface GameState {
  roomId: string;
  username: string;
  lastActivity: number;
  currentArticle: string;
  history: string[];
  clicks: number;
  points: number;
}

export function useGameState(roomId: string, username: string) {
  const [state, setState] = useState<GameState | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // Load state from session storage only on initial mount
    if (isInitialMount.current) {
      const saved = sessionStorage.getItem(`game_state_${roomId}_${username}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Check if state is still valid (not too old)
          if (Date.now() - parsed.lastActivity < 300000) { // 5 minutes
            setState(parsed);
          }
        } catch (e) {
          console.error('Failed to load game state:', e);
        }
      }
      isInitialMount.current = false;
    }
  }, [roomId, username]); // Only re-run if roomId or username changes

  const saveState = useCallback((newState: Partial<GameState>) => {
    setState(prev => {
      const current = prev || {
        roomId,
        username,
        lastActivity: Date.now(),
        currentArticle: '',
        history: [],
        clicks: 0,
        points: 0
      };
      
      const updated = { ...current, ...newState, lastActivity: Date.now() };
      sessionStorage.setItem(`game_state_${roomId}_${username}`, JSON.stringify(updated));
      return updated;
    });
  }, [roomId, username]);

  return { state, saveState };
}