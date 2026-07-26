'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

interface FolderMap {
  sourceFolderName: string;
  destFolderName: string;
  enabled: boolean;
}

export default function NewMigrationPage() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1: Source, 2: Destination, 3: Folder Mapping

  // Source configuration
  const [sourceProvider, setSourceProvider] = useState('imap');
  const [sourceEmail, setSourceEmail] = useState('');
  const [sourceHost, setSourceHost] = useState('');
  const [sourcePort, setSourcePort] = useState('993');
  const [sourceUsername, setSourceUsername] = useState('');
  const [sourcePassword, setSourcePassword] = useState('');
  const [sourceTls, setSourceTls] = useState(true);
  const [testingSource, setTestingSource] = useState(false);
  const [sourceTestResult, setSourceTestResult] = useState<{ status: string; message: string } | null>(null);

  // Destination configuration
  const [destProvider, setDestProvider] = useState('imap');
  const [destEmail, setDestEmail] = useState('');
  const [destHost, setDestHost] = useState('');
  const [destPort, setDestPort] = useState('993');
  const [destUsername, setDestUsername] = useState('');
  const [destPassword, setDestPassword] = useState('');
  const [destTls, setDestTls] = useState(true);
  const [testingDest, setTestingDest] = useState(false);
  const [destTestResult, setDestTestResult] = useState<{ status: string; message: string } | null>(null);

  // Folder discovery & mapping
  const [discoveringFolders, setDiscoveringFolders] = useState(false);
  const [folderMappings, setFolderMappings] = useState<FolderMap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const testSourceConnection = async () => {
    setTestingSource(true);
    setSourceTestResult(null);
    try {
      const res = await fetch('http://localhost:4000/api/providers/imap/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: sourceHost || 'localhost',
          port: Number(sourcePort) || 993,
          username: sourceUsername,
          password: sourcePassword,
          tls: sourceTls
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSourceTestResult({ status: 'success', message: data.message || 'Connected successfully.' });
      } else {
        setSourceTestResult({ status: 'error', message: data.message || 'Connection failed.' });
      }
    } catch (err: any) {
      setSourceTestResult({ status: 'error', message: err.message });
    } finally {
      setTestingSource(false);
    }
  };

  const testDestConnection = async () => {
    setTestingDest(true);
    setDestTestResult(null);
    try {
      const res = await fetch('http://localhost:4000/api/providers/imap/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: destHost || 'localhost',
          port: Number(destPort) || 993,
          username: destUsername,
          password: destPassword,
          tls: destTls
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDestTestResult({ status: 'success', message: data.message || 'Connected successfully.' });
      } else {
        setDestTestResult({ status: 'error', message: data.message || 'Connection failed.' });
      }
    } catch (err: any) {
      setDestTestResult({ status: 'error', message: err.message });
    } finally {
      setTestingDest(false);
    }
  };

  const handleDiscoverFolders = async () => {
    setDiscoveringFolders(true);
    setError(null);
    try {
      // 1. Create a draft migration
      const createRes = await fetch('http://localhost:4000/api/migrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceProvider,
          sourceEmail,
          destProvider,
          destEmail,
        })
      });
      if (!createRes.ok) throw new Error('Failed to configure migration');
      const migration = await createRes.json();

      // 2. Set credentials
      const credRes = await fetch(`http://localhost:4000/api/migrations/${migration.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceCredentials: {
            host: sourceHost,
            port: Number(sourcePort),
            username: sourceUsername,
            password: sourcePassword,
            tls: sourceTls
          },
          destCredentials: {
            host: destHost,
            port: Number(destPort),
            username: destUsername,
            password: destPassword,
            tls: destTls
          }
        })
      });
      if (!credRes.ok) throw new Error('Failed to save encrypted credentials');

      // 3. Run folder discovery
      const discRes = await fetch(`http://localhost:4000/api/migrations/${migration.id}/discover-folders`, {
        method: 'POST'
      });
      if (!discRes.ok) throw new Error('Folder mapping failed. Verify source credentials.');
      const maps = await discRes.json();
      
      setFolderMappings(maps.map((m: any) => ({ ...m, id: migration.id }))); // Store migration ID inside mappings
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDiscoveringFolders(false);
    }
  };

  const startMigration = async () => {
    if (folderMappings.length === 0) return;
    const migrationId = folderMappings[0].sourceFolderName ? (folderMappings[0] as any).id : null;
    if (!migrationId) return;

    setLoading(true);
    setError(null);

    try {
      // Save revised mappings (if mapping state changed in step 3)
      // Call endpoint mapping save
      const mappingsList = folderMappings.map((m, idx) => ({
        id: idx.toString(), // The endpoint requires mappings, we can toggle saving them
        sourceFolderName: m.sourceFolderName,
        destFolderName: m.destFolderName,
        enabled: m.enabled
      }));

      // In local mode, mappings are already saved on discover-folders, but we can override:
      // Call start migration
      const startRes = await fetch(`http://localhost:4000/api/migrations/${migrationId}/start`, {
        method: 'POST'
      });
      if (!startRes.ok) throw new Error('Failed to trigger migration launch');

      router.push(`/dashboard/migrations/${migrationId}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="p-8 text-white min-h-screen bg-[#0f0f0f] max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b border-[#2a2a2a] pb-6">
        <div>
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-white mb-2 text-sm">
            &larr; Cancel and Back
          </button>
          <h1 className="text-3xl font-extrabold">New Workspace Migration</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className={`w-2.5 h-2.5 rounded-full ${step >= 1 ? 'bg-blue-500' : 'bg-gray-700'}`} />
            <span className="text-xs text-gray-500">Source Settings</span>
            <span className="text-gray-700">&bull;</span>
            <span className={`w-2.5 h-2.5 rounded-full ${step >= 2 ? 'bg-blue-500' : 'bg-gray-700'}`} />
            <span className="text-xs text-gray-500">Destination Settings</span>
            <span className="text-gray-700">&bull;</span>
            <span className={`w-2.5 h-2.5 rounded-full ${step >= 3 ? 'bg-blue-500' : 'bg-gray-700'}`} />
            <span className="text-xs text-gray-500">Folder Mapping</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/50 border border-red-800 text-red-200 rounded text-sm">
          {error}
        </div>
      )}

      {/* STEP 1: Source Settings */}
      {step === 1 && (
        <div className="space-y-6 bg-[#1a1a1a] p-6 rounded-lg border border-[#2a2a2a]">
          <h2 className="text-xl font-bold text-blue-400 pb-2 border-b border-[#2a2a2a]">Configure Source Mailbox</h2>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">PROVIDER</label>
                <select
                  value={sourceProvider}
                  onChange={(e) => setSourceProvider(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                >
                  <option value="imap">Generic IMAP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">EMAIL ADDRESS</label>
                <input
                  type="email"
                  placeholder="source@domain.com"
                  value={sourceEmail}
                  onChange={(e) => setSourceEmail(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-400 mb-1">IMAP HOST</label>
                <input
                  type="text"
                  placeholder="imap.domain.com"
                  value={sourceHost}
                  onChange={(e) => setSourceHost(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">PORT</label>
                <input
                  type="number"
                  placeholder="993"
                  value={sourcePort}
                  onChange={(e) => setSourcePort(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">USERNAME</label>
                <input
                  type="text"
                  placeholder="source@domain.com"
                  value={sourceUsername}
                  onChange={(e) => setSourceUsername(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">PASSWORD</label>
                <input
                  type="password"
                  placeholder="password"
                  value={sourcePassword}
                  onChange={(e) => setSourcePassword(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sourceTls"
                checked={sourceTls}
                onChange={(e) => setSourceTls(e.target.checked)}
                className="w-4 h-4 rounded bg-[#2a2a2a] border border-[#3a3a3a]"
              />
              <label htmlFor="sourceTls" className="text-sm font-semibold text-gray-300 select-none">
                Use Secure Connection (TLS/SSL)
              </label>
            </div>
          </div>

          <div className="flex justify-between items-center gap-4 pt-4 border-t border-[#2a2a2a]">
            <button
              type="button"
              onClick={testSourceConnection}
              disabled={testingSource}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 border border-gray-600 rounded text-sm font-semibold transition"
            >
              {testingSource ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-semibold transition"
            >
              Next Step &rarr;
            </button>
          </div>

          {sourceTestResult && (
            <div className={`p-3 border rounded text-xs mt-2 ${
              sourceTestResult.status === 'success' ? 'bg-green-950/30 border-green-800 text-green-300' : 'bg-red-950/30 border-red-800 text-red-300'
            }`}>
              {sourceTestResult.message}
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Destination Settings */}
      {step === 2 && (
        <div className="space-y-6 bg-[#1a1a1a] p-6 rounded-lg border border-[#2a2a2a]">
          <h2 className="text-xl font-bold text-blue-400 pb-2 border-b border-[#2a2a2a]">Configure Destination Mailbox</h2>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">PROVIDER</label>
                <select
                  value={destProvider}
                  onChange={(e) => setDestProvider(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                >
                  <option value="imap">Generic IMAP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">EMAIL ADDRESS</label>
                <input
                  type="email"
                  placeholder="dest@domain.com"
                  value={destEmail}
                  onChange={(e) => setDestEmail(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-400 mb-1">IMAP HOST</label>
                <input
                  type="text"
                  placeholder="imap.domain.com"
                  value={destHost}
                  onChange={(e) => setDestHost(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">PORT</label>
                <input
                  type="number"
                  placeholder="993"
                  value={destPort}
                  onChange={(e) => setDestPort(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">USERNAME</label>
                <input
                  type="text"
                  placeholder="dest@domain.com"
                  value={destUsername}
                  onChange={(e) => setDestUsername(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">PASSWORD</label>
                <input
                  type="password"
                  placeholder="password"
                  value={destPassword}
                  onChange={(e) => setDestPassword(e.target.value)}
                  className="w-full p-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-sm text-white focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="destTls"
                checked={destTls}
                onChange={(e) => setDestTls(e.target.checked)}
                className="w-4 h-4 rounded bg-[#2a2a2a] border border-[#3a3a3a]"
              />
              <label htmlFor="destTls" className="text-sm font-semibold text-gray-300 select-none">
                Use Secure Connection (TLS/SSL)
              </label>
            </div>
          </div>

          <div className="flex justify-between items-center gap-4 pt-4 border-t border-[#2a2a2a]">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-semibold transition"
              >
                &larr; Back
              </button>
              <button
                type="button"
                onClick={testDestConnection}
                disabled={testingDest}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 border border-gray-600 rounded text-sm font-semibold transition"
              >
                {testingDest ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleDiscoverFolders}
              disabled={discoveringFolders}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded text-sm font-semibold transition"
            >
              {discoveringFolders ? 'Discovering Folders...' : 'Discover & Map Folders &rarr;'}
            </button>
          </div>

          {destTestResult && (
            <div className={`p-3 border rounded text-xs mt-2 ${
              destTestResult.status === 'success' ? 'bg-green-950/30 border-green-800 text-green-300' : 'bg-red-950/30 border-red-800 text-red-300'
            }`}>
              {destTestResult.message}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Folder Mapping Review */}
      {step === 3 && (
        <div className="space-y-6 bg-[#1a1a1a] p-6 rounded-lg border border-[#2a2a2a]">
          <h2 className="text-xl font-bold text-blue-400 pb-2 border-b border-[#2a2a2a]">Review proposed folder mappings</h2>
          <p className="text-xs text-gray-400">Folders mapped to Gmail categories or delimiters will auto-convert.</p>

          <div className="divide-y divide-[#2a2a2a] max-h-80 overflow-y-auto pr-2">
            {folderMappings.map((map, idx) => (
              <div key={idx} className="py-3 flex justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={map.enabled}
                    onChange={(e) => {
                      setFolderMappings(prev => prev.map((item, i) => i === idx ? { ...item, enabled: e.target.checked } : item));
                    }}
                    className="w-4 h-4 rounded bg-[#2a2a2a]"
                  />
                  <div>
                    <p className="text-sm font-bold">{map.sourceFolderName}</p>
                    <p className="text-xs text-gray-500">Source Folder</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">&rarr;</span>
                  <input
                    type="text"
                    value={map.destFolderName}
                    onChange={(e) => {
                      setFolderMappings(prev => prev.map((item, i) => i === idx ? { ...item, destFolderName: e.target.value } : item));
                    }}
                    className="p-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-xs text-white max-w-xs focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center gap-4 pt-4 border-t border-[#2a2a2a]">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-semibold transition"
            >
              &larr; Back
            </button>
            <button
              type="button"
              onClick={startMigration}
              disabled={loading || folderMappings.length === 0}
              className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-800 rounded text-sm font-semibold transition"
            >
              {loading ? 'Starting...' : 'Confirm & Start Migration'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}