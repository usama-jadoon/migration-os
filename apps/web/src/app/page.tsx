export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f0f0f] text-white">
      <h1 className="text-4xl font-bold mb-6">Welcome to MigrationOS</h1>
      <a href="/dashboard" className="px-6 py-3 bg-[#3b82f6] rounded-md font-semibold">Start Migration</a>
    </div>
  );
}