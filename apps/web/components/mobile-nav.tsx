'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { UserMenu } from '@/components/user-menu'
import { cn } from '@/lib/utils'
import { Gamepad2, List, MessageCircle, Settings, Moon, Sun, Menu, Sparkles, Users } from 'lucide-react'

const navItems = [
  {
    title: '游戏列表',
    href: '/games',
    icon: List,
  },
  {
    title: '聊天预览',
    href: '/chat',
    icon: MessageCircle,
  },
  {
    title: '模型管理',
    href: '/models',
    icon: Sparkles,
  },
]

export function MobileNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const settingsExact = pathname === '/settings'
  const usersActive = pathname === '/users'

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
      active
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:hidden">
      <div className="flex items-center gap-2">
        <Gamepad2 className="h-6 w-6 text-primary" />
        <span className="font-semibold">boardrule-rag</span>
      </div>

      <div className="flex items-center gap-1">
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">切换主题</span>
          </Button>
        )}

        <UserMenu />

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
              <span className="sr-only">打开菜单</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="border-b border-border p-4">
              <SheetTitle className="flex items-center gap-2">
                <Gamepad2 className="h-5 w-5 text-primary" />
                boardrule-rag
              </SheetTitle>
            </SheetHeader>
            <nav className="space-y-1 p-3">
              <Link
                href="/games"
                onClick={() => setOpen(false)}
                className={linkClass(
                  pathname === '/games' || pathname.startsWith('/games/'),
                )}
              >
                <List className="h-5 w-5" />
                游戏列表
              </Link>
              {isAdmin ? (
                <Link
                  href="/users"
                  onClick={() => setOpen(false)}
                  className={linkClass(usersActive)}
                >
                  <Users className="h-5 w-5" />
                  用户管理
                </Link>
              ) : null}
              {navItems.slice(1).map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={linkClass(isActive)}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.title}
                  </Link>
                )
              })}
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className={linkClass(settingsExact)}
              >
                <Settings className="h-5 w-5" />
                系统设置
              </Link>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
