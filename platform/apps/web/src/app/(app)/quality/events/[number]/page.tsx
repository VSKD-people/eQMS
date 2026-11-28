import { ClosurePage } from '../../ClosurePage';

export default async function EventPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ a0?: string; ok?: string; err?: string }> }) {
  return <ClosurePage kind="quality-events" number={(await params).number} sp={await searchParams} />;
}
