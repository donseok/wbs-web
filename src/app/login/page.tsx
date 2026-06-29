'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

export default function Login() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState('')
  const router = useRouter()
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const sb = createBrowserClient()
    const { error } = await sb.auth.signInWithPassword({ email, password: pw })
    if (error) setErr('로그인 실패: ' + error.message)
    else router.push('/projects')
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-32 flex max-w-sm flex-col gap-3">
      <h1 className="text-xl font-bold">WBS 로그인</h1>
      <input className="border p-2" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} />
      <input className="border p-2" type="password" placeholder="비밀번호" value={pw} onChange={e => setPw(e.target.value)} />
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <button className="bg-black text-white p-2">로그인</button>
    </form>
  )
}
