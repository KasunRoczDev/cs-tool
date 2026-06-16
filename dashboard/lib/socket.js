import { io } from 'socket.io-client';

const BASE = process.env.NEXT_PUBLIC_API_BASE || undefined;
let socket;

export function getSocket() {
  if (typeof window === 'undefined') return null;
  if (!socket) {
    socket = io(BASE, { transports: ['websocket'], autoConnect: true });
  }
  return socket;
}
