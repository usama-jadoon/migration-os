import { createContext } from 'react';
import { io, Socket } from 'socket.io-client';

export const socket = io('http://localhost:4000');
export const SocketContext = createContext(socket);
