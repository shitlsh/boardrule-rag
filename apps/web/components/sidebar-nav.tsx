'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Gamepad2, List, MessageCircle, Settings, Moon, Sun, Sparkles, Users, Layers } from 'lucide-react'

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
  {
    title: 'AI 运行时',
    href: '/settings/ai-runtime',
    icon: Layers,
  },
]

export function SidebarNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const [gamesNav, ...navAfterGames] = navItems
  const settingsExact = pathname === '/settings'
  const usersActive = pathname === '/users'

  const itemLinkClass = (href: string) => {
    const isActive =
      pathname === href || (href !== '/settings' && pathname.startsWith(`${href}/`))
    return cn(
      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )
  }

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-border px-6">
          <Gamepad2 className="h-6 w-6 text-primary" />
          <span className="font-semibold text-lg">boardrule-rag</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <Link href={gamesNav.href} className={itemLinkClass(gamesNav.href)}>
            <gamesNav.icon className="h-5 w-5" />
            {gamesNav.title}
          </Link>

          {isAdmin ? (
            <Link
              href="/users"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                usersActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Users className="h-5 w-5" />
              用户管理
            </Link>
          ) : null}

          {navAfterGames.map((item) => (
            <Link key={item.href} href={item.href} className={itemLinkClass(item.href)}>
              <item.icon className="h-5 w-5" />
              {item.title}
            </Link>
          ))}

          <Link
            href="/settings"
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              settingsExact
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Settings className="h-5 w-5" />
            系统设置
          </Link>
        </nav>

        <div className="border-t border-border p-4">
          {mounted && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="ml-5">切换主题</span>
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
