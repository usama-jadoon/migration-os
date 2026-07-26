import { io } from '../index';

export const emitProgress = (migrationId: string, data: any) => {
  io.emit('migration:progress', { migrationId, ...data });
};