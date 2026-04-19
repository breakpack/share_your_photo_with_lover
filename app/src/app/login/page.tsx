'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, password }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          const body = await res.json().catch(() => null);
          const retryAfterSec =
            typeof body?.retryAfterSec === 'number' ? Math.max(1, Math.floor(body.retryAfterSec)) : null;
          setError(
            retryAfterSec
              ? `로그인 시도 제한: ${retryAfterSec}초 후 다시 시도하세요.`
              : '로그인 시도 제한: 잠시 후 다시 시도하세요.',
          );
          return;
        }
        setError('이름 또는 비밀번호가 올바르지 않습니다.');
        return;
      }
      window.location.href = '/';
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <form
        onSubmit={submit}
        className="w-[320px] bg-neutral-900 rounded-2xl p-6 space-y-4 border border-neutral-800"
      >
        <h1 className="text-xl font-semibold text-center">PhotoShare</h1>
        <input
          type="text"
          placeholder="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-neutral-800 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-neutral-800 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          autoComplete="current-password"
          required
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg py-2 font-medium transition"
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
