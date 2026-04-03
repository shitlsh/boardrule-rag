import { Cpu, Database, Info, Server, Settings } from "lucide-react";

import { SettingsLimitsForm } from "@/components/settings-limits-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const versionInfo = {
  app: "1.0.0",
  api: "1.0.0",
  build: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
  environment: process.env.NODE_ENV || "development",
};

const systemInfo = [
  {
    icon: Server,
    label: "应用版本",
    value: versionInfo.app,
  },
  {
    icon: Cpu,
    label: "API 版本",
    value: versionInfo.api,
  },
  {
    icon: Database,
    label: "构建标识",
    value: versionInfo.build,
  },
  {
    icon: Info,
    label: "运行环境",
    value: versionInfo.environment === "production" ? "生产环境" : "开发环境",
    badge: versionInfo.environment === "production" ? "default" : "secondary",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">系统设置</h1>
        <p className="text-muted-foreground">查看系统信息和配置</p>
      </div>

      <div className="grid max-w-2xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              系统信息
            </CardTitle>
            <CardDescription>当前系统版本和运行环境信息</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {systemInfo.map((item, index) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-muted-foreground">{item.value}</span>
                      {"badge" in item && item.badge ? (
                        <Badge variant={item.badge as "default" | "secondary"}>
                          {item.badge === "default" ? "生产" : "开发"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {index < systemInfo.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <SettingsLimitsForm />
      </div>
    </div>
  );
}
