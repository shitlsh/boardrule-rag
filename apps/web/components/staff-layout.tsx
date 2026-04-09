import { MobileNav } from '@/components/mobile-nav'
import { SidebarNav } from '@/components/sidebar-nav'
import { UserMenu } from '@/components/user-menu'

export function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="hidden lg:block">
        <SidebarNav />
      </div>
      <MobileNav />
      <div className="flex min-h-screen flex-col lg:ml-64">
        <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center justify-end gap-2 border-b border-border bg-card/90 px-8 backdrop-blur supports-[backdrop-filter]:bg-card/75 lg:flex">
          <UserMenu />
        </header>
        <main className="flex-1">
          <div className="p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
