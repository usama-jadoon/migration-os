'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { socket } from '../../../../lib/socket';

interface Folder {
  id: string;
  sourceFolderName: string;
  destFolderName: string;
  status: string;
  totalMessages: number;
  migratedMessages: number;
  enabled: boolean;
}

interface Log {
  id: string;
  level: string;
  message: string;
  createdAt: string;
}

interface Migration {
  id: string;
  status: string;
  sourceProvider: string;
  sourceEmail: string;
  destProvider: string;
  destEmail: string;
  totalMessages: number;
  migratedMessages: number;
  failedMessages: number;
  totalSizeBytes: string;
  migratedSizeBytes: string;
  startedAt: string | null;
  completedAt: string | null;
  folderMappings: Folder[];
  logs: Log[];
}

export default function MigrationProgressPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [migration, setMigration] = useState<Migration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial migration details
  const fetchDetails = async () => {
    try {
      const res = await fetch(`http://localhost:4000/api/migrations/${id}`);
      if (!res.ok) throw new Error('Migration not found');
      const data = await res.json();
      setMigration(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();

    // Subscribe to Socket.io events
    socket.emit('subscribe:migration', { migrationId: id });

    socket.on('migration:progress', (data: any) => {
      if (data.migrationId === id) {
        setMigration((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            migratedMessages: data.migratedMessages,
            totalMessages: data.totalMessages,
            status: 'running',
            folderMappings: prev.folderMappings.map(f => {
              if (f.sourceFolderName === data.currentFolder) {
                return { ...f, status: 'running', migratedMessages: data.migratedMessages % f.totalMessages || f.totalMessages };
              }
              return f;
            })
          };
        });
      }
    });

    socket.on('migration:completed', (data: any) => {
      if (data.migrationId === id) {
        fetchDetails();
      }
    });

    socket.on('migration:paused', (data: any) => {
      if (data.migrationId === id) {
        setMigration((prev) => prev ? { ...prev, status: 'paused' } : null);
      }
    });

    socket.on('migration:resumed', (data: any) => {
      if (data.migrationId === id) {
        setMigration((prev) => prev ? { ...prev, status: 'running' } : null);
      }
    });

    socket.on('migration:error', (data: any) => {
      if (data.migrationId === id) {
        fetchDetails();
      }
    });

    return () => {
      socket.emit('unsubscribe:migration', { migrationId: id });
      socket.off('migration:progress');
      socket.off('migration:completed');
      socket.off('migration:paused');
      socket.off('migration:resumed');
      socket.off('migration:error');
    };
  }, [id]);

  const handleStart = async () => {
    try {
      await fetch(`http://localhost:4000/api/migrations/${id}/start`, { method: 'POST' });
      fetchDetails();
    } catch (err) {
      console.error(err);
    }
  };

  const handlePause = async () => {
    try {
      await fetch(`http://localhost:4000/api/migrations/${id}/pause`, { method: 'POST' });
      fetchDetails();
    } catch (err) {
      console.error(err);
    }
  };

  const handleResume = async () => {
    try {
      await fetch(`http://localhost:4000/api/migrations/${id}/resume`, { method: 'POST' });
      fetchDetails();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancel = async () => {
    try {
      await fetch(`http://localhost:4000/api/migrations/${id}/cancel`, { method: 'POST' });
      fetchDetails();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f0f0f] text-white">
        <p className="text-lg">Loading migration progress...</p>
      </div>
    );
  }

  if (error || !migration) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f0f0f] text-white">
        <p className="text-red-500 text-lg mb-4">{error || 'Migration not found'}</p>
        <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-blue-600 rounded">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const percentage = migration.totalMessages > 0
    ? Math.round((migration.migratedMessages / migration.totalMessages) * 100)
    : 0;

  const mappings = migration.folderMappings || [];

  return (
    <div className="p-8 text-white min-h-screen bg-[#0f0f0f] max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b border-[#2a2a2a] pb-6">
        <div>
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-white mb-2 text-sm">
            &larr; Back to Dashboard
          </button>
          <h1 className="text-3xl font-extrabold">Migration Progress</h1>
          <p className="text-gray-400 text-sm mt-1">ID: {migration.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${
            migration.status === 'completed' ? 'bg-green-900/50 text-green-400 border border-green-700/50' :
            migration.status === 'completed_with_errors' ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50' :
            migration.status === 'running' ? 'bg-blue-900/50 text-blue-400 border border-blue-700/50 animate-pulse' :
            migration.status === 'paused' ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50' :
            migration.status === 'failed' ? 'bg-red-900/50 text-red-400 border border-red-700/50' :
            'bg-gray-800 text-gray-400 border border-gray-700'
          }`}>
            {migration.status}
          </span>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex gap-4 p-4 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a]">
        {(migration.status === 'pending' || migration.status === 'ready' || migration.status === 'failed' || migration.status === 'draft') && (
          <button onClick={handleStart} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded font-semibold transition">
            Start Migration
          </button>
        )}
        {migration.status === 'running' && (
          <button onClick={handlePause} className="px-6 py-2 bg-yellow-600 hover:bg-yellow-500 rounded font-semibold transition">
            Pause
          </button>
        )}
        {migration.status === 'paused' && (
          <button onClick={handleResume} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded font-semibold transition">
            Resume
          </button>
        )}
        {(migration.status === 'running' || migration.status === 'paused' || migration.status === 'queued') && (
          <button onClick={handleCancel} className="px-6 py-2 bg-red-600 hover:bg-red-500 rounded font-semibold transition">
            Cancel
          </button>
        )}
      </div>

      {/* Progress Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a] space-y-2">
          <p className="text-gray-400 text-sm">Source Endpoint</p>
          <p className="text-lg font-bold truncate">{migration.sourceEmail}</p>
          <p className="text-xs text-blue-400 capitalize">{migration.sourceProvider}</p>
        </div>
        <div className="flex items-center justify-center text-2xl text-gray-500 hidden md:flex">&rarr;</div>
        <div className="p-6 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a] space-y-2">
          <p className="text-gray-400 text-sm">Destination Endpoint</p>
          <p className="text-lg font-bold truncate">{migration.destEmail}</p>
          <p className="text-xs text-blue-400 capitalize">{migration.destProvider}</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="p-6 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a] space-y-4">
        <div className="flex justify-between items-center text-sm font-semibold">
          <span>Overall Migration Progress</span>
          <span>{percentage}% ({migration.migratedMessages} / {migration.totalMessages} messages, {migration.failedMessages} failed)</span>
        </div>
        <div className="w-full bg-[#2a2a2a] h-4 rounded-full overflow-hidden">
          <div
            className="bg-blue-600 h-full transition-all duration-500 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Folders & Logs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Folders List */}
        <div className="p-6 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a] space-y-4">
          <h2 className="text-xl font-bold">Mapped Folders</h2>
          <div className="divide-y divide-[#2a2a2a]">
            {mappings.length === 0 ? (
              <p className="text-gray-500 py-2">No folders mapped yet.</p>
            ) : (
              mappings.map((folder) => {
                const folderPercent = folder.totalMessages > 0
                  ? Math.round((folder.migratedMessages / folder.totalMessages) * 100)
                  : 0;
                return (
                  <div key={folder.id} className="py-3 flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-sm">{folder.sourceFolderName} &rarr; {folder.destFolderName}</p>
                      <p className="text-xs text-gray-400">
                        {folder.migratedMessages} / {folder.totalMessages} emails
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{folderPercent}%</span>
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        folder.status === 'completed' ? 'bg-green-500' :
                        folder.status === 'running' ? 'bg-blue-500 animate-pulse' :
                        'bg-gray-600'
                      }`} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Logs */}
        <div className="p-6 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a] space-y-4">
          <h2 className="text-xl font-bold">Activity Logs</h2>
          <div className="bg-[#0f0f0f] p-4 rounded border border-[#2a2a2a] h-64 overflow-y-auto font-mono text-xs space-y-2">
            {migration.logs.length === 0 ? (
              <p className="text-gray-500">Waiting for migration to start...</p>
            ) : (
              migration.logs.map((log) => (
                <div key={log.id} className="flex gap-2">
                  <span className="text-gray-500">[{new Date(log.createdAt).toLocaleTimeString()}]</span>
                  <span className={log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-blue-400'}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="text-gray-300">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
