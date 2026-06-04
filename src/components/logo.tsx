/* eslint-disable @next/next/no-img-element */

export default function Logo({ className }: { className?: string }) {
  return <img src="/logo.png" alt="NuRock" className={className} draggable={false} />;
}
