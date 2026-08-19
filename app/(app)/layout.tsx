import { Nav } from '@/components/nav';

/** The signed-in app shell: sidebar on wide screens, top bar on phones. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <Nav />
      <main className="flex-1 px-4 md:px-6 py-5 md:py-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
