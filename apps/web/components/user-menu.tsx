'use client'

import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { CircleUser, KeyRound, LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function UserMenu() {
  const { data: session, status } = useSession()
  const user = session?.user
  const email = user?.email ?? '—'
  const name = user?.name?.trim() || null
  const role = user?.role === 'admin' ? '管理员' : '用户'

  if (status === 'loading') {
    return (
      <Button variant="ghost" size="sm" className="gap-2" disabled>
        <CircleUser className="h-5 w-5" />
        <span className="hidden sm:inline">…</span>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-2">
          <CircleUser className="h-5 w-5 shrink-0" />
          <span className="hidden max-w-[140px] truncate text-sm font-medium sm:inline">
            个人中心
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>个人信息</DropdownMenuLabel>
        <div className="space-y-1.5 px-2 py-2 text-sm">
          <p>
            <span className="text-muted-foreground">邮箱：</span>
            {email}
          </p>
          {name ? (
            <p>
              <span className="text-muted-foreground">名称：</span>
              {name}
            </p>
          ) : null}
          <p>
            <span className="text-muted-foreground">角色：</span>
            {role}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/change-password" className="cursor-pointer">
            <KeyRound className="mr-2 h-4 w-4" />
            修改密码
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void signOut({ callbackUrl: '/login' })}
          className="cursor-pointer"
        >
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
