export async function generateStaticParams(): Promise<{ path: string[] }[]> {
  return [{ path: ["__placeholder__"] }];
}

export default function DocumentPage() {
  return null;
}
