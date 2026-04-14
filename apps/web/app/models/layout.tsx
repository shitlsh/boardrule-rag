import { StaffLayout } from "@/components/staff-layout";
import { ModelsSubNav } from "@/components/models-sub-nav";

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffLayout>
      <div className="mx-auto w-full max-w-5xl space-y-8 px-1 pb-12">
        <ModelsSubNav />
        {children}
      </div>
    </StaffLayout>
  );
}
