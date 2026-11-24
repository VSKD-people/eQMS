import { ClosurePage } from '../../ClosurePage';

export default async function CapaPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ a0?: string; ok?: string; err?: string }> }) {
  return <ClosurePage kind="capas" number={(await params).number} sp={await searchParams} />;
}
