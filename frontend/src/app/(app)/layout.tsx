'use client';

import { Menu } from 'lucide-react';
import { CompanySelector } from '@/components/shell/company-selector';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { UserMenu } from '@/components/shell/user-menu';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { useUi } from '@/stores/ui';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { mobileNavOpen, setMobileNavOpen } = useUi();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <SidebarNav />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-72 border-none p-0"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Menü</SheetTitle>
          <SheetDescription className="sr-only">Ana menü</SheetDescription>
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-white/90 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Menüyü aç"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <CompanySelector />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
