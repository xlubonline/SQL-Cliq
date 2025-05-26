import { SqlCliComponent } from '@/components/sql-cli/sql-cli-component';

export default function HomePage() {
  return (
    <main className="h-full w-full flex flex-col">
      <SqlCliComponent />
    </main>
  );
}
