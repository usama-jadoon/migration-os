'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface Migration {
  id: string;
  status: string;
  sourceProvider: string;
  sourceEmail: string;
  destProvider: string;
  destEmail: string;
  totalMessages: number;
  migratedMessages: number;
  createdAt: string;
}

export default function DashboardPage() {
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMigrations = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/migrations');
      if (!res.ok) throw new Error('Failed to load migrations');
      const data = await res.json();
      setMigrations(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMigrations();
  }, []);

  return (
    <div className="p-8 text-white min-h-screen bg-[#0f0f0f] max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b border-[#2a2a2a] pb-6">
        <div>
          <h1 className="text-3xl font-extrabold">Migration Dashboard</h1>
          <p className="text-gray-400 mt-1">Manage and track your active workspace migrations.</p>
        </div>
        <Link
          href="/dashboard/new"
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded font-semibold text-sm transition"
        >
          New Migration
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-950 border border-red-700 text-red-200 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading your migrations...</p>
      ) : migrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg">
          <p className="text-gray-400 mb-4 text-center">No migrations found. Create your first email migration to start!</p>
          <Link
            href="/dashboard/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-semibold text-sm"
          >
            Get Started
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {migrations.map((m) => {
            const pct = m.totalMessages > 0 ? Math.round((m.migratedMessages / m.totalMessages) * 100) : 0;
            return (
              <Link href={`/dashboard/migrations/${m.id}`} key={m.id} className="block">
                <div className="p-6 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded-lg transition duration-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{m.sourceEmail}</span>
                      <span className="text-gray-500 text-xs">({m.sourceProvider})</span>
                      <span className="text-gray-500 text-sm">&rarr;</span>
                      <span className="font-bold text-lg">{m.destEmail}</span>
                      <span className="text-gray-500 text-xs">({m.destProvider})</span>
                    </div>
                    <p className="text-xs text-gray-500">Created: {new Date(m.createdAt).toLocaleString()}</p>
                  </div>

                  <div className="flex items-center gap-6 w-full md:w-auto">
                    <div className="flex flex-col items-end gap-1.5 w-full md:w-40">
                      <div className="flex justify-between w-full text-xs">
                        <span className="text-gray-400 font-semibold">{pct}%</span>
                        <span className="text-gray-400">{m.migratedMessages} / {m.totalMessages}</span>
                      </div>
                      <div className="w-full bg-[#2a2a2a] h-2 rounded-full overflow-hidden">
                        <div className="bg-blue-600 h-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase ${
                      m.status === 'completed' ? 'bg-green-950/50 text-green-400 border border-green-700/50' :
                      m.status === 'running' ? 'bg-blue-950/50 text-blue-400 border border-blue-700/50' :
                      m.status === 'paused' ? 'bg-yellow-950/50 text-yellow-400 border border-yellow-700/50' :
                      'bg-red-950/50 text-red-400 border border-red-700/50'
                    }`}>
                      {m.status}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}