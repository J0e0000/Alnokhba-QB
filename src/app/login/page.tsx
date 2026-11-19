'use client';

// ============================================================
// ALNOKHBA QB — /login (shared-password gate, Arabic RTL)
// Matches the app's Tajawal/slate design language.
// ============================================================

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        const msg = data?.error ?? 'فشل تسجيل الدخول';
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success('تم تسجيل الدخول — أهلًا بك');
      // ?next=<path> set by the proxy redirect; fall back to the app root.
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      router.replace(next && next.startsWith('/') ? next : '/');
      router.refresh();
    } catch {
      const msg = 'تعذر الاتصال بالخادم — أعد المحاولة';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-100/60 p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(15,23,42,0.06),transparent)]"
      />
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="pb-4 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" aria-hidden />
          </div>
          <CardTitle className="text-xl font-bold">النخبة QB</CardTitle>
          <CardDescription className="text-sm">
            بنك الأسئلة والتصحيح الآلي — أدخل كلمة مرور التطبيق للمتابعة
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="text-left"
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
              />
            </div>
            {error && (
              <p id="login-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !password}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  جارٍ التحقق…
                </>
              ) : (
                'دخول'
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          الجلسة صالحة ٧ أيام على هذا الجهاز
        </CardFooter>
      </Card>
    </main>
  );
}
