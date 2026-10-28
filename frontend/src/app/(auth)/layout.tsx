import { Building2, ShieldCheck, TrendingUp } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

const POINTS = [
  { icon: Building2, text: 'Tüm firmalarınızı tek panelden yönetin' },
  { icon: TrendingUp, text: 'Sipariş, stok ve pazaryeri modülleri yolda' },
  { icon: ShieldCheck, text: 'Kurumsal güvenlik ve işlem kaydı' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-brand-navy p-12 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="absolute -top-32 -right-32 size-96 rounded-full bg-brand-orange/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-20 size-96 rounded-full bg-white/5 blur-2xl"
        />
        <BrandLogo inverted className="relative" />
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl leading-tight font-semibold">
            E-ticaret operasyonunuz{' '}
            <span className="text-brand-orange">tek merkezde.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/85">
                <span className="grid size-9 place-items-center rounded-lg bg-white/10">
                  <Icon className="size-4.5 text-brand-orange" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <main className="flex items-center justify-center bg-white px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <BrandLogo className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
