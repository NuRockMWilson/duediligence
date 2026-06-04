"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Logo from "@/components/logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // No emailRedirectTo: tells Supabase to expect OTP verification, not link click.
    });

    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setStep("code");
      toast.success("Check your email for the 6-digit code.");
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setLoading(false);
    if (error) {
      toast.error(error.message);
      setCode("");
    } else {
      router.push("/deals");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-nurock-gray p-4">
      <div className="w-full max-w-sm bg-white p-8 rounded-lg shadow-sm border border-nurock-border">
        <div className="flex items-center gap-3 mb-8">
          <div className="bg-nurock-navy rounded-md p-2">
            <Logo className="h-7 w-auto" />
          </div>
          <div>
            <div className="font-display text-base uppercase tracking-wider text-nurock-navy font-semibold">
              NuRock
            </div>
            <div className="text-[10px] uppercase tracking-wider text-nurock-slate-light">
              Development Management
            </div>
          </div>
        </div>

        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <h1 className="font-display text-xl text-nurock-black mb-1">
                Sign in
              </h1>
              <p className="text-sm text-nurock-slate-light">
                We&apos;ll email you a 6-digit code.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@nurock.com"
                autoComplete="email"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-nurock-navy hover:bg-nurock-navy-dark"
            >
              {loading ? "Sending…" : "Send code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <div>
              <h1 className="font-display text-xl text-nurock-black mb-1">
                Enter code
              </h1>
              <p className="text-sm text-nurock-slate-light">
                We sent a 6-digit code to{" "}
                <span className="font-medium text-nurock-black">{email}</span>.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                className="text-center text-lg tracking-[0.5em] font-mono"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-nurock-navy hover:bg-nurock-navy-dark"
            >
              {loading ? "Verifying…" : "Verify"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs text-nurock-slate-light"
              onClick={() => {
                setStep("email");
                setCode("");
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
